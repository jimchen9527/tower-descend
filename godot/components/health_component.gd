## Reusable health state for any damageable actor.
##
## Lifetime: child node of an [Actor] scene. Self-contained — it holds no
## references to its owner and never calls get_parent(). Whoever holds this node
## listens to [signal health_changed] / [signal died]; communication is upward
## via signals only.
##
## Composition over inheritance: instead of `class CharacterWithHealth`, attach
## this node to any scene and it just works.
class_name HealthComponent
extends Node

## Emitted after [member current] changes.
## [param current] is always clamped to [0, max_health].
signal health_changed(current: int, max_health: int)

## Emitted when [method take_damage] applies a positive [param amount].
signal damaged(amount: int)

## Emitted exactly once, the first time [member current] reaches 0.
signal died

## Upper bound for [member current]. Never lower than 1.
@export_range(1, 9999, 1) var max_health: int = 100:
	set(value):
		max_health = maxi(value, 1)
		current = mini(current, max_health)
		health_changed.emit(current, max_health)

## Current hit points, always within [0, max_health].
@export_range(0, 9999, 1) var current: int = 100

var _is_dead: bool = false

func _ready() -> void:
	current = clampi(current, 1, max_health)
	health_changed.emit(current, max_health)

## Applies [param amount] damage. Non-positive amounts are ignored so callers
## never need to guard their own math.
func take_damage(amount: int) -> void:
	if _is_dead or amount <= 0:
		return
	var before := current
	current = maxi(current - amount, 0)
	damaged.emit(amount)
	if current != before:
		health_changed.emit(current, max_health)
	if current == 0:
		_is_dead = true
		died.emit()

## Restores [param amount] health, clamped to [member max_health].
##
## Emits [signal health_changed] only when something was actually gained, so a
## heal at full health is silent rather than a redundant bar update. Refuses to
## revive a dead actor: nothing in this build resurrects, and un-killing would
## also mean clearing [member _is_dead], which is not a heal's decision.
func heal(amount: int) -> void:
	if _is_dead or amount <= 0:
		return
	var before := current
	current = mini(current + amount, max_health)
	if current != before:
		health_changed.emit(current, max_health)


func is_dead() -> bool:
	return _is_dead
