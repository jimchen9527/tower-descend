## Stacking buffs and debuffs — the Web build's `unit.buffs`.
##
## The Web build kept buffs in a plain object on each unit and reached for
## `unit.buffs.str` from inside card scripts. That is untyped by construction:
## a typo reads `undefined`, silently adding nothing, and there is no place to
## hang the turn-boundary rules. Here the keys are an enum and the rules live in
## this one component, so "what does 力量 actually do" is answerable by reading
## one file instead of grepping 47 card scripts.
##
## ## Two families, deliberately not merged
## [enum Kind] splits them because they behave differently at the turn boundary:
##   - Debuffs ([constant Kind.WEAK], [constant Kind.VULNERABLE],
##     [constant Kind.POISON]) **decay**. Stacking them is a temporary problem.
##   - Buffs ([constant Kind.STRENGTH] and friends) **persist** for the fight.
## Merging them into one "buffs" number would make the decay rule ambiguous, and
## the Web build's own `decayDebuffs` lists exactly two keys for that reason.
##
## ## Poison ticks before block is cleared
## The Web build's `startPlayerTurn` order is deliberate (combat.js:163-180):
## poison damage resolves first, then leftover block is discarded. Poison
## therefore **ignores block** — it must call [method Actor.lose_health] and not
## [method Actor.take_damage]. Getting this backwards would let a player block
## their way out of poison.
##
## ## Where the hook is called from
## [method start_turn] is invoked by [method Actor.start_turn], which the turn
## system calls once per unit per turn. The component never polls: changes are
## broadcast through [signal status_changed] so a HUD can react without being
## polled every frame.
class_name StatusComponent
extends Node

## Emitted when any status changes value. [param kind] identifies which, so a
## listener showing one badge does not redraw every other badge.
signal status_changed(kind: Kind, current: int, delta: int)

## Emitted when poison deals its turn-start damage.
signal poison_ticked(damage: int)
## Emitted at the end of a turn when a debuff loses a stack.
signal debuff_decayed(kind: Kind, current: int)

## The statuses this build knows about.
##
## Names match the Web build's `BUFF_NAMES` keys (js/data) so balance reasoning
## carries over one-to-one. `STRENGTH` is `str`, `DEXTERITY` is `dex`.
enum Kind {
	STRENGTH,       ## 力量 — every point adds flat damage to each hit.
	DEXTERITY,      ## 敏捷 — every point adds flat block to each block gain.
	WEAK,           ## 虚弱 — attacker deals 75% damage. Decays 1 per turn.
	VULNERABLE,     ## 脆弱 — target takes 150% damage. Decays 1 per turn.
	POISON,         ## 中毒 — loses health equal to stacks at turn start, then −1.
	THORNS,         ## 荆棘 — attacker takes this much back when it hits.
	METALLICIZE,    ## 金属化 — gain this much block at each turn start.
	BARRICADE,      ## 壁垒 — block is no longer cleared at turn start.
	STR_PER_TURN,   ## 每回合力量 — gain this much 力量 at each turn start.
}

## Multiplier applied when the attacker has [constant Kind.WEAK]. Matches the
## Web build's `Math.floor(dmg * 0.75)` — the floor is applied after the
## multiply, so 3 damage weakened is 2, not 2.25 rounded.
const WEAK_MULTIPLIER: float = 0.75
## Multiplier applied when the target has [constant Kind.VULNERABLE].
const VULNERABLE_MULTIPLIER: float = 1.5

## Damage reduction while WEAK is active, as a plain int percentage.
## Kept as constants rather than literals at the call sites so the two
## multipliers can be tuned in one place.
## Current stacks by kind. Sparse: a status at 0 is absent, matching the Web
## build deleting the key instead of storing a zero.
var _stacks: Dictionary[Kind, int] = {}

## Debuffs that lose one stack at end of turn, per the Web build's
## `decayDebuffs`. Both are listed explicitly rather than filtered by a flag so
## adding a persistent buff can never accidentally make it decay.
const DECAYING: Array[Kind] = [Kind.WEAK, Kind.VULNERABLE]


## Adds (or, with a negative [param amount], removes) [param amount] stacks.
##
## Negative amounts are legal on purpose: 「震地锤」 and 「重锤作业」 both strip
## enemy 力量, and an earlier design that clamped at 0 made those cards no-ops
## against an enemy with no 力量 yet. Removing the clamp is what lets a debuff
## card matter at all.
##
## Returns the actual delta, which may differ from [param amount] when a stack
## bottoms out at zero.
func add(kind: Kind, amount: int) -> int:
	if amount == 0:
		return 0
	var before: int = _stacks.get(kind, 0)
	var after := maxi(before + amount, 0)
	if after == before:
		return 0
	if after == 0:
		_stacks.erase(kind)
	else:
		_stacks[kind] = after
	var delta := after - before
	status_changed.emit(kind, after, delta)
	return delta


func get_stacks(kind: Kind) -> int:
	return _stacks.get(kind, 0)


func has_status(kind: Kind) -> bool:
	return get_stacks(kind) > 0


## 力量 to add to a base hit. Reads through [method get_stacks] rather than
## caching a total so a mid-turn 力量 gain (「负重前行」) counts immediately.
func strength_bonus() -> int:
	return get_stacks(Kind.STRENGTH)


## 敏捷 to add to a block gain.
func dexterity_bonus() -> int:
	return get_stacks(Kind.DEXTERITY)


## Thorns to reflect back at an attacker.
func thorns() -> int:
	return get_stacks(Kind.THORNS)


## Whether leftover block survives the turn boundary. Read by
## [method BlockComponent.start_turn], not by the component doing the clearing —
## the block component owns its own reset.
func keeps_block() -> bool:
	return has_status(Kind.BARRICADE)


## Final damage for [param base] after 力量 / 虚弱 / 脆弱.
##
## Order matters and mirrors `Combat.rawDamage` (combat.js:419):
## strength adds, THEN weak multiplies, THEN vulnerable multiplies. Reordering
## these changes results: with 力量 4 and WEAK 1, base 10 is
## (10+4)*0.75 = 10 under this order, but 10*0.75+4 = 11 under the other — and
## the Web build's numbers are what all 47 cards were balanced against.
##
## [param attacker_strength] and [param attacker_weak] describe the source;
## [param target_vulnerable] the victim. Passed in rather than read from a unit
## so this stays a pure function — both sides of a hit are needed at once and
## they are usually different actors.
func resolve_damage(base: int, attacker_strength: int, attacker_weak: bool,
		target_vulnerable: bool) -> int:
	var amount := maxi(base, 0) + attacker_strength
	if attacker_weak:
		amount = int(floor(amount * WEAK_MULTIPLIER))
	if target_vulnerable:
		amount = int(floor(amount * VULNERABLE_MULTIPLIER))
	return maxi(amount, 0)


## Block for [param base] after 敏捷. Floor because the Web build's
## `gainBlock` returns `Math.max(0, amount + dex)` on an integer amount.
func resolve_block(base: int, dexterity: int) -> int:
	return maxi(base + dexterity, 0)


## Call once at the start of the owner's turn, in this exact order.
##
## Order is copied from `Combat.startPlayerTurn` (combat.js:157-217) because
## each step can observe the previous one:
##   1. Poison damage — ignores block, and must land before block is discarded
##      so the Web build's own ordering is reproduced exactly.
##   2. 金属化 block, granted *after* the clear so it is not thrown away.
##   3. 每回合 力量, also after the clear.
##
## The block clear itself is NOT done here — [method BlockComponent.start_turn]
## owns it and calls [method keeps_block] to decide. Splitting it keeps one
## owner per rule: this component grants, that component discards.
func start_turn() -> void:
	_tick_poison()
	var metallicize := get_stacks(Kind.METALLICIZE)
	if metallicize > 0:
		owner_grant_block(metallicize)
	var per_turn_strength := get_stacks(Kind.STR_PER_TURN)
	if per_turn_strength > 0:
		add(Kind.STRENGTH, per_turn_strength)


## Call once at the end of the owner's turn: decay 虚弱 / 脆弱 by one stack.
func end_turn() -> void:
	for kind in DECAYING:
		var current := get_stacks(kind)
		if current <= 0:
			continue
		add(kind, -1)
		debuff_decayed.emit(kind, get_stacks(kind))


## Poison: lose health equal to the stack count, then lose a stack.
##
## Reports the damage through [signal poison_ticked] so the presentation layer
## can float the number without re-deriving it.
func _tick_poison() -> void:
	var stacks := get_stacks(Kind.POISON)
	if stacks <= 0:
		return
	poison_ticked.emit(stacks)
	# Poison ignores block by design; the caller supplies an actor that honours
	# that. See the class docs for why it must not route through take_damage.
	var actor := get_owner() as Actor
	if actor != null:
		actor.lose_health(stacks)
	add(Kind.POISON, -1)


## Grants block to the owning actor, tolerating an owner without the component.
##
## The `as Actor` cast is the same shape as [method _tick_poison]: a
## StatusComponent can be unit-tested standalone with no Actor above it, in
## which case these turn hooks simply have no one to hand block to. Erroring
## there would make the component untestable in isolation.
func owner_grant_block(amount: int) -> void:
	var actor := get_owner() as Actor
	if actor == null:
		return
	actor.gain_block(amount)


## Human-readable label for UI, matching the Web build's `BUFF_NAMES`.
static func label_for(kind: Kind) -> String:
	match kind:
		Kind.STRENGTH:
			return "力量"
		Kind.DEXTERITY:
			return "敏捷"
		Kind.WEAK:
			return "虚弱"
		Kind.VULNERABLE:
			return "脆弱"
		Kind.POISON:
			return "中毒"
		Kind.THORNS:
			return "荆棘"
		Kind.METALLICIZE:
			return "金属化"
		Kind.BARRICADE:
			return "壁垒"
		Kind.STR_PER_TURN:
			return "每回合力量"
	return "未知"