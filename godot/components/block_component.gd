## Temporary damage absorption that clears each turn.
##
## Sits in front of [HealthComponent] the way a shield sits in front of armour:
## damage is absorbed here first, and only the remainder reaches health. The two
## components stay separate because "how much hurt" and "how much is soaking it"
## change for completely different reasons — one from damage sources, the other
## from the turn boundary.
##
## ## The rule that is easy to get wrong
## Block does NOT accumulate across turns. The Web build resets it at the start
## of the owner's turn (combat.js:171) so holding block is never a strategy —
## it must be spent within the turn it was gained. That reset lives in
## [method start_turn] rather than being sprinkled through callers, so there is
## exactly one place where the rule is enforced.
##
## ## Why damage flows through here rather than into HealthComponent
## HealthComponent knows nothing about block. If it did, every damage source in
## the game would have to remember to consult block first, and forgetting once
## would silently produce an exploit. Routing all damage through
## [method absorb] makes it structurally impossible to skip.
class_name BlockComponent
extends Node

## Emitted when the block value changes for any reason.
## [param current] is the new value, already clamped to [0, max_block].
signal block_changed(current: int, max_block: int)

## Emitted when damage is absorbed. [param absorbed] is the portion eaten by
## block, [param remaining] is what continues to health.
signal damage_absorbed(absorbed: int, remaining: int)

## Emitted when block absorbs nothing, so an attack was fully blocked.
signal fully_blocked(damage: int)

## Emitted at the start of each turn when leftover block was discarded. Kept as
## its own signal because a player watching a bar drop to zero deserves to know
## it was the turn boundary, not a bug.
signal block_cleared(discarded: int)

## Upper bound, so a stacking card cannot make block unbounded. Kept generous:
## the cap exists as a sanity guard, not as balance.
@export_range(1, 999, 1) var max_block: int = 30:
	set(value):
		max_block = maxi(value, 1)
		current = mini(current, max_block)
		block_changed.emit(current, max_block)

@export_range(0, 999, 1) var current: int = 0

## Whether block survives the turn boundary. False matches the Web build's
## default; `keepBlock` units (e.g. a specific enemy trait) opt in.
@export var keep_block: bool = false


## Applies [param amount] damage, consuming block first.
##
## Returns the damage that actually reached health, so callers report the real
## number rather than the number they intended. Damage is always >= 0; callers
## pass positive amounts only.
func absorb(amount: int) -> int:
	var incoming := maxi(amount, 0)
	if incoming == 0:
		return 0

	var absorbed := mini(current, incoming)
	var remaining := incoming - absorbed

	if absorbed > 0:
		current -= absorbed
		block_changed.emit(current, max_block)
		damage_absorbed.emit(absorbed, remaining)
		if remaining == 0:
			fully_blocked.emit(incoming)
	return remaining


## Adds [param amount] block, clamped to [member max_block].
## Negative amounts are ignored so callers never need to guard their own math.
func gain(amount: int) -> void:
	if amount <= 0:
		return
	var before := current
	current = mini(current + amount, max_block)
	if current == before:
		return
	block_changed.emit(current, max_block)


## Discards all block and returns how much was thrown away.
## Separate from [method start_turn] so a card that eats block (Web build:
## "consumeBlock") is explicit at the call site instead of implied.
func consume_all() -> int:
	var discarded := current
	if discarded <= 0:
		return 0
	current = 0
	block_changed.emit(current, max_block)
	return discarded


## Call once at the start of the owner's turn.
##
## Resets block to zero unless [member keep_block] is set. This is the single
## place the per-turn rule lives.
##
## Emits [signal block_cleared] with the amount thrown away, so a UI can tell
## "your block expired" apart from "your block was consumed".
func start_turn() -> void:
	if keep_block:
		return
	var discarded := consume_all()
	if discarded > 0:
		block_cleared.emit(discarded)


## Whether any block is available. Cheap enough to call freely.
func has_block() -> bool:
	return current > 0
