## Resolves a [CardData] into gameplay effects.
##
## The counterpart to [CardData]: the Resource says what a card *is*, this class
## says what it *does*. Resolution is a **walk over the card's
## [member CardData.effects] array**, not a per-card branch.
##
## ## Why not one function per card
## The Web build's 47 Digger cards each carry a bespoke `play(ctx, card)`. Copying
## that shape into GDScript would mean 47 script files, none of it diffable as
## data, and every balance tweak needing a programmer. Instead each card is a
## list of [CardEffectStep]s and [method resolve] evaluates them through four
## orthogonal axes (kind / target / scale / ratio). Adding a card is adding a
## `.tres`.
##
## ## Amount evaluation happens exactly once per step, before anything applies
## [method _evaluate] computes the number first and [method _apply] acts second.
## That ordering is not cosmetic: 「液压冲击」 consumes the block it reads, so
## evaluating and applying interleaved would let step 2 of the same card see a
## block total the card had already spent.
##
## ## Deliberately narrow surface
## Everything an effect may touch is listed on [PlayContext]. The Web build's
## `ctx` handed cards the DOM, the run state and the engine at once, which is
## exactly why its tests needed a browser. Here the surface is small enough to
## unit-test with no scene tree.
class_name CardEffect
extends RefCounted

## Everything an effect is allowed to touch during resolution.
##
## An inner class of [CardEffect], so it cannot be instantiated from elsewhere
## and the resolution surface stays closed.
class PlayContext extends RefCounted:
	## Whoever plays the card. Typed as [Actor] so effects can use the shared
	## damage contract without knowing Player from Enemy.
	var source: Actor = null
	## The current target for single-enemy effects. Null is legal — a card with
	## no enemy-facing step still resolves (「防御」, 「配重校准」).
	var target: Actor = null
	## Every living enemy, for [constant CardEffectStep.TargetMode.ALL_ENEMIES].
	## Populated by the caller; an empty array makes an AOE step a legal no-op
	## rather than an error.
	var enemies: Array[Actor] = []
	## Current shaft depth, for steps that scale with DEPTH.
	var depth: int = 1
	## Attack / skill cards played earlier THIS turn. Does not include the card
	## being resolved — the Web build increments `turnPlays` only after `play`
	## returns (combat.js:294), and 「井底之锤」 is balanced against exactly that.
	var attacks_played: int = 0
	var skills_played: int = 0

	## Set to true if any enemy died while this card resolved. Read by steps with
	## [constant CardEffectStep.Condition.IF_TARGET_DIED] and
	## [constant CardEffectStep.Condition.IF_ANY_DIED].
	var killed_any: bool = false

	## How many cards the source drew, filled in by this resolution.
	var cards_drawn: int = 0
	## Block gained in total, for the UI and for tests.
	var gained_block: int = 0
	## Health restored in total.
	var healed: int = 0
	## Health lost by the source itself (a card's own price).
	var self_hurt: int = 0


## Resolves [param card] against [param context].
##
## Returns false when the card cannot be resolved at all — no source, no
## [CardEffectStep], or a card needing an enemy when none is in reach. The caller
## treats false as "unplayable" and keeps the card in hand; it is not an error.
func resolve(card: CardData, context: PlayContext) -> bool:
	if card == null or context == null or context.source == null:
		return false
	if not card.is_playable():
		return false

	var steps := card.effects
	if steps.is_empty():
		# A curse card: legal to hold, impossible to play. Reaching here means
		# something offered it as a playable button.
		return false

	var needs_victim := card.needs_target()
	if needs_victim and context.target == null and context.enemies.is_empty():
		return false

	_current_upgraded = card.upgraded
	for step in steps:
		if not _step_runs(step, context):
			continue
		var amount := _evaluate(step, context)
		_apply(step, amount, context)
	return true


## Whether [method _apply] should run this step at all.
##
## The gate is [member CardEffectStep.condition_replaces], and nothing else. That
## field is not a cosmetic flag on the bonus arithmetic — it IS the distinction
## between the two shapes a conditional step can take, and the only thing that
## tells them apart is which number the author put where.
##
## ## REPLACE: the step exists unconditionally, the condition renames its number
## 「撬棍」 reads "造成 9 点伤害。若本回合已获得格挡，改为 13 点。" The 9 is not a
## bonus and the 13 is not an extra — there is exactly one damage step and the
## condition picks which number it deals. Gating it would make 撬棍 deal **zero**
## without block, which is exactly backwards. So REPLACE steps always run.
##
## ## ADD: the whole step is the conditional clause
## 「撬棒连击」's "若击杀，抽 2 张牌" has no unconditional half at all, and
## 「安全帽」's "若已打出攻击牌，再获得 3 点" is a second grant that only exists
## under the condition. Unmet, these must do nothing at all.
##
## ## Why `value` cannot stand in for `condition_replaces`
## The tempting shortcut is "run it if it has a base value, skip it if it does
## not" — 安全帽's bonus really is authored as `value = 3` on its own step. But
## 撬棒连击 authors its bonus the same way (`value = 2` on a DRAW step), so that
## test says both are unconditional and 撬棒连击 draws 2 on a surviving target.
## The data carries no "this is the base half" flag, so the gate must come from
## the flag that does: replaces or not.
func _step_runs(step: CardEffectStep, context: PlayContext) -> bool:
	if step.condition == CardEffectStep.Condition.ALWAYS:
		return true
	if step.condition_replaces:
		# The step has an unconditional half; the condition only moves its number,
		# which [method _evaluate] handles.
		return true
	return _condition_met(step, context)


## Whether a step's [member CardEffectStep.condition] currently holds.
##
## IF_TARGET_DIED and IF_ANY_DIED both read [member PlayContext.killed_any]:
## there is one target, so "the target died" and "any enemy died" differ only for
## AOE cards, and 「连锁爆破」's own text says "if you kill any enemy". Keeping one
## flag means an AOE kill can never be double-counted as both.
func _condition_met(step: CardEffectStep, context: PlayContext) -> bool:
	match step.condition:
		CardEffectStep.Condition.ALWAYS:
			return true
		CardEffectStep.Condition.IF_BLOCKED:
			return context.source.has_block()
		CardEffectStep.Condition.IF_TARGET_DIED, CardEffectStep.Condition.IF_ANY_DIED:
			return context.killed_any
		CardEffectStep.Condition.IF_ATTACK_PLAYED:
			return context.attacks_played > 0
		CardEffectStep.Condition.IF_SKILL_PLAYED:
			return context.skills_played > 0
		_:
			return false


## Mirrors [member CardData.upgraded] for the duration of one [method resolve].
##
## A field rather than a parameter on every helper because the amount helpers
## nest four calls deep, and threading a bool through all of them would obscure
## the formula that is the whole point of [CardEffectStep].
var _current_upgraded: bool = false


## Folds a step's three scaling terms into one number.
##
##     amount = (value + scale x coef) + ratio term + per term
##
## This is exactly the order the card text reads in. Block consumption happens
## inside [method _block_term] before the value is returned, so a card that
## spends its block cannot spend it twice when a later step reads it again.
func _evaluate(step: CardEffectStep, context: PlayContext) -> int:
	var upgraded := _current_upgraded
	var amount := step.value_at(upgraded)

	# The conditional number only counts while its condition actually holds.
	# [method _step_runs] decides whether the STEP runs; this decides whether the
	# condition moves the number. 「撬棍」 runs either way: 9 without block, 13 with.
	if step.condition != CardEffectStep.Condition.ALWAYS \
			and _condition_met(step, context):
		var conditional := step.condition_value_at(upgraded)
		if step.condition_replaces:
			amount = conditional
		else:
			amount += conditional

	amount += _scale_term(step, context, upgraded)
	amount += _block_term(step, context, upgraded)
	return maxi(amount, 0)


## The additive term: depth / 力量 / cards-played-this-turn.
func _scale_term(step: CardEffectStep, context: PlayContext, upgraded: bool) -> int:
	var source := 0
	match step.scale_source:
		CardEffectStep.ScaleSource.DEPTH:
			source = context.depth
		CardEffectStep.ScaleSource.OWN_STRENGTH:
			source = context.source.status_stacks(StatusComponent.Kind.STRENGTH)
		CardEffectStep.ScaleSource.ATTACK_PLAYS:
			source = context.attacks_played
		CardEffectStep.ScaleSource.SKILL_PLAYS:
			source = context.skills_played
		_:
			return 0
	return source * step.scale_coef_at(upgraded)


## The block-derived term. This is the only place block is consumed.
##
## Both consuming sources eat the block BEFORE computing, because the number
## depends on what was there: 「液压冲击」 deals (block x 1.5) and 「压力阀」 turns
## every 5 spent block into 1 力量. Reading block after clearing it would make
## both cards deal nothing at all.
func _block_term(step: CardEffectStep, context: PlayContext, upgraded: bool) -> int:
	var actor := context.source
	var ratio := step.ratio_at(upgraded)
	var per := step.per_at(upgraded)
	match step.ratio_source:
		CardEffectStep.RatioSource.CONSUMED_BLOCK_TIMES:
			var spent := actor.consume_block()
			return int(floor(spent * ratio))
		CardEffectStep.RatioSource.OWN_BLOCK_RATIO:
			var available := actor.block.current if actor.block != null else 0
			return int(floor(available * ratio))
		_:
			pass
	match step.per_source:
		CardEffectStep.PerSource.CONSUMED_BLOCK_PER:
			var spent_per := actor.consume_block()
			return int(floor(spent_per / float(maxi(per, 1))))
		CardEffectStep.PerSource.OWN_BLOCK_PER:
			var held := actor.block.current if actor.block != null else 0
			return int(floor(held / float(maxi(per, 1))))
		_:
			return 0


## Performs one step [param amount] times against its targets.
func _apply(step: CardEffectStep, amount: int, context: PlayContext) -> void:
	match step.kind:
		CardEffectStep.EffectKind.DAMAGE:
			_deal_damage(step, amount, context, false)
		CardEffectStep.EffectKind.RAW_DAMAGE:
			_deal_damage(step, amount, context, true)
		CardEffectStep.EffectKind.BLOCK:
			_grant_block(amount, context)
		CardEffectStep.EffectKind.HEAL:
			context.healed += context.source.heal(amount)
		CardEffectStep.EffectKind.LOSE_HEALTH:
			context.self_hurt += context.source.lose_health(amount)
		CardEffectStep.EffectKind.DRAW:
			context.cards_drawn += _draw(amount, context)
		CardEffectStep.EffectKind.ENERGY:
			_grant_energy(amount, context)
		CardEffectStep.EffectKind.ADD_STATUS:
			_apply_status(step, amount, context)


## Deals [param amount] to every applicable target.
##
## Multi-hit repeats through [member CardEffectStep.times] and stops early once
## no living target remains, matching `attackTimes` (combat.js:411) — otherwise
## 「连环凿」 would waste two of its three hits on a corpse.
func _deal_damage(step: CardEffectStep, amount: int, context: PlayContext,
		ignore_block: bool) -> void:
	var targets := _targets_for(step, context)
	if targets.is_empty():
		return
	for _i in step.times:
		var hit_any := false
		for target in targets:
			if target == null or target.is_dead():
				continue
			hit_any = true
			target.take_damage_from(context.source, amount, ignore_block)
			if target.is_dead():
				context.killed_any = true
		if not hit_any:
			return


## Applies a status step. Negative amounts strip stacks, and a step whose amount
## is 0 is a deliberate no-op (「震地锤」 vs an enemy with no 力量 to strip).
func _apply_status(step: CardEffectStep, amount: int, context: PlayContext) -> void:
	for target in _targets_for(step, context):
		if target != null:
			target.add_status(step.status_kind, amount)


## Resolves [member CardEffectStep.target] into a concrete actor list.
func _targets_for(step: CardEffectStep, context: PlayContext) -> Array[Actor]:
	match step.target:
		CardEffectStep.TargetMode.SELF:
			return _one(context.source)
		CardEffectStep.TargetMode.ALL_ENEMIES:
			var living: Array[Actor] = []
			for enemy in context.enemies:
				if enemy != null and not enemy.is_dead():
					living.append(enemy)
			return living
		_:
			if context.target != null and not context.target.is_dead():
				return _one(context.target)
			return []


func _one(actor: Actor) -> Array[Actor]:
	var list: Array[Actor] = []
	if actor != null:
		list.append(actor)
	return list


## Grants block to the source, reporting the real total so a capped gain (敏捷,
## max_block) cannot be printed as the card's nominal number.
func _grant_block(amount: int, context: PlayContext) -> void:
	if amount <= 0:
		return
	var before := context.source.block.current if context.source.block != null else 0
	var after := context.source.gain_block(amount)
	context.gained_block += maxi(after - before, 0)


## Grants energy via a capability check, since only the player carries one.
func _grant_energy(amount: int, context: PlayContext) -> void:
	var player := context.source as Player
	if player == null or player.energy == null:
		return
	player.energy.gain(amount)


## Asks the source to draw. Delegated to [method Player.draw_cards] rather than
## reaching into a deck here: the draw pile, the reshuffle-from-discard rule and
## the hand size limit are deck concerns, and this class should not own them.
func _draw(amount: int, context: PlayContext) -> int:
	var player := context.source as Player
	if player == null:
		return 0
	return player.draw_cards(amount)