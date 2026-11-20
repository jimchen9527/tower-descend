## One resolvable step of a card.
##
## ## Why a card is an array of these
## The Web build gives every card a bespoke `play(ctx, card)` function, and its
## 47 Digger cards use more than a dozen distinct shapes: 「拆解」 deals damage
## *and* grants block, 「碎石」 scales off your own block, 「凿岩机」 hits three
## times, 「震波」 hits every enemy, 「应急护盾」 costs you health, 「井壁凿击」
## scales with depth. The prototype's previous model could hold exactly one
## effect and one number, which is why only the 6 simplest cards existed —
## it was a model ceiling, not a shortage of cards.
##
## ## Four orthogonal axes instead of a bespoke branch per card
## Each step answers four independent questions, and the amount is one formula:
##
##     amount = (value + scale_value x scale_coef)
##            + ratio_term + per_term
##
## - [enum EffectKind] — WHAT happens (damage, block, heal, status…).
## - [enum TargetMode] — WHO it happens to (one enemy, all enemies, self).
## - [enum ScaleSource] — an ADDITIVE term: base + depth, + strength,
##   + cards of that type played this turn.
## - [enum RatioSource] — a MULTIPLICATIVE term read off your block, optionally
##   consuming it first.
## - [enum PerSource] — a FLOOR term: "gain 1 per 5 block".
##
## Keeping them orthogonal is what stops this file turning into 47 cases: a new
## card is a new `.tres`, and this class never grows a branch for it.
##
## ## Why conditions are per-step, not per-card
## 「撬棒连击」 deals damage unconditionally but draws 2 *only on a kill*;
## 「安全帽」 always grants block, then grants 3 more if an attack was already
## played this turn. Both need a conditional second step while the first step
## stays unconditional — which only works if the condition rides on the step.
## [member condition_replaces] picks between "add the bonus" (安全帽) and
## "swap the value" (「撬棍」: 9 damage, or 13 while you have block).
class_name CardEffectStep
extends Resource

## What the step does. Deliberately separate from [enum CardData.CardType]:
## "this is a skill" and "this grants block" are different questions, and a
## SKILL can deal damage while an ATTACK can grant block.
enum EffectKind {
	DAMAGE,      ## Hurt the target; its block absorbs first.
	RAW_DAMAGE,  ## Hurt the target, ignoring block (「破岩」).
	BLOCK,       ## Grant block to the source.
	HEAL,        ## Restore the source's health.
	LOSE_HEALTH, ## Cost the source health outright, ignoring block.
	DRAW,        ## Ask the source to draw cards.
	ENERGY,      ## Grant energy to the source.
	ADD_STATUS,  ## Apply stacks of a status; negative strips them.
}

## Who receives the effect.
enum TargetMode {
	ENEMY,       ## The current target only. Needs one in reach.
	ALL_ENEMIES, ## Every living enemy on the field.
	SELF,        ## The card's owner.
}

## Additive scaling term: `value + scale_value x scale_coef`.
enum ScaleSource {
	NONE,           ## No additive term; the amount is just [member value].
	DEPTH,          ## + depth x coef — the deeper the shaft, the harder.
	OWN_STRENGTH,   ## + 力量 x coef (「钢铁意志」).
	SKILL_PLAYS,    ## + skill cards played this turn x coef (「破壁索」).
	ATTACK_PLAYS,   ## + attack cards played this turn x coef (「井底之锤」).
}

## Block-derived term, optionally consuming the block it read.
enum RatioSource {
	NONE,                  ## No ratio term.
	OWN_BLOCK_RATIO,       ## + floor(block x ratio) — 「碎石」 reads block, keeps it.
	CONSUMED_BLOCK_TIMES,  ## Consume all block, then deal/consume x it (「液压冲击」).
}

## Floor term: "+1 per N block".
enum PerSource {
	NONE,               ## No floor term.
	OWN_BLOCK_PER,      ## + floor(block / per), block kept (「负重前行」).
	CONSUMED_BLOCK_PER, ## Consume all block, then + floor(consumed / per) (「压力阀」).
}

## Gate on the step. See the class docs for why this is not per-card.
enum Condition {
	ALWAYS,          ## Unconditional.
	IF_BLOCKED,      ## Only when the source currently has block (「撬棍」).
	IF_TARGET_DIED,  ## Only if the target died from this card (「撬棒连击」).
	IF_ANY_DIED,     ## Only if any enemy died (「连锁爆破」).
	IF_ATTACK_PLAYED,# Only if an attack card was played earlier this turn.
	IF_SKILL_PLAYED, # Only if a skill card was played earlier this turn.
}

@export_group("Step")

## What this step does.
@export var kind: EffectKind = EffectKind.DAMAGE
## Who it happens to.
@export var target: TargetMode = TargetMode.ENEMY

@export_group("Amount")

## Base amount, before any scaling, ratio or per term.
@export_range(0, 999, 1) var value: int = 0
## Value after upgrading. 0 falls back to [member value], matching
## [method CardData.damage_at_level]'s rule on the previous model.
@export_range(0, 999, 1) var upgraded_value: int = 0

@export_subgroup("Additive term")
@export var scale_source: ScaleSource = ScaleSource.NONE
@export_range(-99, 99, 1) var scale_coef: int = 0
@export_range(-99, 99, 1) var upgraded_scale_coef: int = 0

@export_subgroup("Block ratio term")
@export var ratio_source: RatioSource = RatioSource.NONE
## 0.5 means "half your block". Stored as a float because 「碎石」's upgrade is
## 0.75 — the fractions are the card's whole identity.
@export_range(0.0, 4.0, 0.05) var ratio: float = 0.0
@export_range(0.0, 4.0, 0.05) var upgraded_ratio: float = 0.0

@export_subgroup("Floor term")
@export var per_source: PerSource = PerSource.NONE
## Divisor for the floor term: 5 means "once per 5 block". Upgrading a card
## that scales this way LOWERS the divisor (5 -> 4 makes it stronger), which is
## the opposite direction from every other number and is easy to get backwards.
@export_range(1, 99, 1) var per: int = 1
@export_range(1, 99, 1) var upgraded_per: int = 0

@export_group("Multiplicity")

## How many times to repeat. 「连环凿」 uses 3; 1 means a single application.
## Kept separate from value so "hit 3 times for 5" stays authorable, and so the
## repeat count is visibly not a damage number.
@export_range(1, 20, 1) var times: int = 1

@export_group("Condition")

## Gate on this step.
@export var condition: Condition = Condition.ALWAYS
## When true, meeting [member condition] SWAPS [member value] for
## [member condition_value] instead of adding it. 「撬棍」 is the case: 9 damage,
## or 13 while blocking — 13 total, not 22.
@export var condition_replaces: bool = false
## The amount contributed (or substituted) when [member condition] is met.
@export_range(0, 999, 1) var condition_value: int = 0
@export_range(0, 999, 1) var upgraded_condition_value: int = 0

@export_group("Status")

## Which status [constant EffectKind.ADD_STATUS] applies. Meaningless for every
## other kind, but declared here rather than in a parallel field so there is one
## place that says "what does this status step touch".
@export var status_kind: StatusComponent.Kind = StatusComponent.Kind.STRENGTH

@export_group("Upgrades")

## Whether the whole card is upgraded. Steps read this instead of each carrying
## its own flag, so `upgraded` cannot be true for step 1 and false for step 2.
@export var uses_upgraded_numbers: bool = false


## Value at the given upgrade state, applying the 0-falls-back rule.
func value_at(upgraded: bool) -> int:
	if upgraded:
		return upgraded_value if upgraded_value > 0 else value
	return value


func scale_coef_at(upgraded: bool) -> int:
	if upgraded:
		return upgraded_scale_coef if upgraded_scale_coef != 0 else scale_coef
	return scale_coef


func ratio_at(upgraded: bool) -> float:
	if upgraded:
		return upgraded_ratio if upgraded_ratio > 0.0 else ratio
	return ratio


func per_at(upgraded: bool) -> int:
	if upgraded:
		return upgraded_per if upgraded_per > 0 else per
	return per


func condition_value_at(upgraded: bool) -> int:
	if upgraded:
		return upgraded_condition_value if upgraded_condition_value > 0 else condition_value
	return condition_value


## Whether this step consumes the source's block. Both ratio and per sources
## can eat it, and a card that does must do so exactly once — [CardEffect]
## resolves the amount before applying anything, so the consume happens there.
func consumes_block(upgraded: bool = false) -> bool:
	if per_source == PerSource.CONSUMED_BLOCK_PER:
		return true
	return ratio_source == RatioSource.CONSUMED_BLOCK_TIMES


## Whether this step needs a living enemy to act on. Self-targeted steps return
## false, which is what lets them be played with nothing adjacent.
func needs_target() -> bool:
	return target != TargetMode.SELF


## Chinese unit label for UI, matching the kind.
func unit_label() -> String:
	match kind:
		EffectKind.DAMAGE:
			return "伤害"
		EffectKind.RAW_DAMAGE:
			return "伤害"
		EffectKind.BLOCK:
			return "格挡"
		EffectKind.HEAL:
			return "治疗"
		EffectKind.LOSE_HEALTH:
			return "自伤"
		EffectKind.DRAW:
			return "抽牌"
		EffectKind.ENERGY:
			return "能量"
		EffectKind.ADD_STATUS:
			return StatusComponent.label_for(status_kind)
	return ""


## Developer-facing validation. [param source] is the step's owning card path,
## used only in the message. Returns an empty string when valid.
##
## A step is only rejected for a genuinely contradictory combination — a KIND
## that cannot carry a number it was given. Anything merely unusual is legal:
## a zero base is how a value appears only when upgraded (「重装机甲」 gains block
## solely at +1), and a conditional amount is how several cards legitimately hit
## zero. Both upgrade states are checked, since a card whose base is empty but
## whose upgrade is not is intentional.
func validate(source: String, upgraded: bool = false) -> String:
	var amount := value_at(upgraded)
	var conditional := condition_value_at(upgraded)
	# A step that carries a real number in EITHER upgrade state is fine; only one
	# that is empty in both is a mistake.
	var any_value := amount > 0 or conditional > 0 \
		or value_at(true) > 0 or value_at(false) > 0
	# A zero base is ALSO correct when the number comes entirely from a dynamic
	# term: 「深井作业」 is 深度×2 block and 「液压冲击」 is 格挡×1.5 damage, so both
	# carry value 0 and get everything from scale/ratio/per. Rejecting those
	# would drop 8 of the 48 authored cards on load.
	var dynamic := scale_source != ScaleSource.NONE \
		or ratio_source != RatioSource.NONE \
		or per_source != PerSource.NONE
	match kind:
		EffectKind.DAMAGE, EffectKind.RAW_DAMAGE, EffectKind.BLOCK:
			if not any_value and not dynamic:
				return "%s: a %s step needs a positive value" % [source, unit_label()]
		EffectKind.HEAL, EffectKind.LOSE_HEALTH, EffectKind.DRAW, EffectKind.ENERGY:
			if amount <= 0:
				return "%s: a %s step needs a positive value" % [source, unit_label()]
		EffectKind.ADD_STATUS:
			if amount == 0 and conditional == 0 and not dynamic:
				return "%s: a status step needs a non-zero value" % source
		_:
			return "%s: unsupported effect kind %d" % [source, kind]

	if ratio_source != RatioSource.NONE and ratio_at(upgraded) <= 0.0:
		return "%s: a ratio-scaled step needs a positive ratio" % source
	if times < 1:
		return "%s: times must be at least 1, got %d" % [source, times]
	if per_source != PerSource.NONE and per_at(upgraded) < 1:
		return "%s: a per-scaled step needs per >= 1" % source
	# A REPLACE condition with no replacement value would silently resolve to
	# the base value, i.e. the condition would look implemented but do nothing.
	if condition_replaces and condition != Condition.ALWAYS \
			and conditional <= 0:
		return ("%s: condition_replaces is set but condition_value is 0 — the "
			+ "condition would have no effect") % source
	return ""