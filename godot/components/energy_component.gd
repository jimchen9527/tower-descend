## Per-turn energy budget for playing cards.
##
## Energy in this design is a *refilled pool*, not an accumulating currency:
## [method start_turn] sets it back to [member max_energy] rather than adding to
## whatever was left. That matches the Web build (combat.js:205) and is the
## reason a turn's leftover energy is simply gone — there is no banking a turn's
## surplus for later, so card cost is a real constraint every single turn.
##
## Kept separate from [BlockComponent] on purpose: energy is spent to *use*
## cards, block is spent to *avoid* damage. They reset on the same boundary but
## answer different questions, and merging them would make "clear everything at
## turn start" ambiguous.
class_name EnergyComponent
extends Node

## Emitted when the available energy changes.
## [param current] is what is left, [param max_energy] the per-turn cap.
signal energy_changed(current: int, max_energy: int)

## Emitted when a spend is refused for lack of energy. [param required] is what
## the card wanted, [param available] what was left. Separate from a silent
## failure so the UI can grey the card out instead of swallowing the input.
signal spend_refused(required: int, available: int)

@export_range(0, 99, 1) var max_energy: int = 3:
	set(value):
		max_energy = maxi(value, 0)
		current = mini(current, max_energy)
		energy_changed.emit(current, max_energy)

@export_range(0, 99, 1) var current: int = 3


## Call once at the start of the owner's turn: refill to the cap.
##
## Note this *sets* rather than adds. A card that grants bonus energy mid-turn
## therefore has real value, and leftover energy is discarded.
##
## [param bonus] is added on top of the cap, but the result is still clamped to
## [member max_energy]: a +1 bonus must never let a player hold 4 energy on a
## 3-energy turn, or the cap stops meaning anything.
func start_turn(bonus: int = 0) -> void:
	var refilled := mini(max_energy + maxi(bonus, 0), max_energy)
	if current == refilled:
		return
	current = refilled
	energy_changed.emit(current, max_energy)


## Whether [param amount] of energy is available. Callers can use this to grey
## out a card before the player attempts it.
func can_afford(amount: int) -> bool:
	return amount <= current


## Spends [param amount] energy.
##
## Returns false and emits [signal spend_refused] when there is not enough,
## leaving [member current] untouched — a partial spend would let a player
## cheaply probe which cards are affordable.
func spend(amount: int) -> bool:
	var cost := maxi(amount, 0)
	if cost == 0:
		return true
	if cost > current:
		spend_refused.emit(cost, current)
		return false
	current -= cost
	energy_changed.emit(current, max_energy)
	return true


## Grants [param amount] energy immediately, clamped to the cap.
## For effects that give energy mid-turn rather than at the boundary.
func gain(amount: int) -> void:
	if amount <= 0:
		return
	var before := current
	current = mini(current + amount, max_energy)
	if current == before:
		return
	energy_changed.emit(current, max_energy)
