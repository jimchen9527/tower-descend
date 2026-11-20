## Chasing enemy: walks at the player, swings once per turn.
##
## Run standalone (F6) — but with no player in the scene it will idle in place,
## which is the correct way to verify it never crashes without parent context.
##
## ## Why attacks are turn-driven, not frame-driven
## [method _physics_process] runs 60 times a second. If contact damage lived
## there, an enemy would hit the player many times per turn and the player's
## block would be meaningless. So movement stays continuous in physics while
## attacking goes through [method act], which the turn system calls exactly once.
## The two cadences are deliberately separate.
class_name Enemy
extends Actor

## Seconds between the wind-up starting and the hit landing. Gives the player a
## beat to react or block, which is the whole point of having block.
const ACT_DELAY: float = 0.22
## Extra reach beyond the collision radius, in pixels. Without it the enemy would
## whiff while visibly overlapping the player.
const REACH_SLACK: float = 18.0

## How far the enemy can notice the player.
@export var detect_range: float = 460.0
@export var move_speed: float = 145.0
@export var contact_damage: int = 8
## Block this enemy gains at the start of its own turn.
@export var block_per_turn: int = 0
@export var knockback_strength: float = 190.0

@onready var body_sprite: Sprite2D = $Body
@onready var body_shape: CollisionShape2D = $CollisionShape2D

var _target: Node2D = null
var _knockback: Vector2 = Vector2.ZERO
## Counts down the wind-up; > 0 means a swing is pending.
var _swing_timer: float = 0.0

func _ready() -> void:
	super()
	add_to_group(&"enemy")
	died.connect(_on_died)

func _physics_process(delta: float) -> void:
	if is_dead():
		return
	_resolve_target()
	_decay_knockback(delta)

	var to_target := _offset_to_target()
	var chasing := to_target.length() > 0.0 and to_target.length() <= detect_range

	velocity = to_target.normalized() * move_speed if chasing else Vector2.ZERO
	if chasing:
		body_sprite.rotation = to_target.angle() + PI * 0.5
	move_and_slide()

func _process(delta: float) -> void:
	if _swing_timer <= 0.0:
		return
	_swing_timer -= delta
	if _swing_timer > 0.0:
		return
	_swing_timer = 0.0
	_try_contact_attack()


## Resolves this enemy's turn: refresh its own block, then start a swing.
func act() -> void:
	if is_dead():
		return
	start_turn()
	gain_block(block_per_turn)
	_swing_timer = ACT_DELAY


## Deals the pending swing, if the player is still in reach.
func _try_contact_attack() -> void:
	if is_dead():
		return
	var offset := _offset_to_target()
	# No target yet: nothing to hit. Note this does NOT bail on a zero-length
	# offset — two actors at the exact same position is the *closest* possible
	# contact and must still connect. An earlier `is_zero_approx()` guard here
	# silently made fully-overlapped enemies deal no damage at all.
	if not is_instance_valid(_target):
		return
	# `shape` is typed Shape2D, so `.radius` is a Variant — it only exists on
	# CapsuleShape2D. Cast explicitly so a shape swap fails at compile time.
	var shape := body_shape.shape as CapsuleShape2D
	if shape == null:
		return
	if offset.length() > shape.radius * 2.0 + REACH_SLACK:
		return
	var victim := _target as Actor
	if victim == null or victim.is_dead():
		return
	victim.take_damage(contact_damage)
	# Knockback needs a direction; at zero separation there is none, so skip it
	# rather than normalising a zero vector into NaN.
	if offset.length_squared() > 0.001:
		var push_dir := offset.normalized()
		victim.velocity += push_dir * knockback_strength
		_knockback = -push_dir * knockback_strength * 0.5


## Whether a swing is currently winding up. Used by tests and by the HUD.
func is_swinging() -> bool:
	return _swing_timer > 0.0


func _offset_to_target() -> Vector2:
	if not is_instance_valid(_target):
		return Vector2.ZERO
	return _target.global_position - global_position

func _resolve_target() -> void:
	if is_instance_valid(_target):
		return
	# get_first_node_in_group instead of a hardcoded path: the main scene owns
	# player placement, this scene must not assume it.
	_target = get_tree().get_first_node_in_group(&"player") as Node2D

func _decay_knockback(delta: float) -> void:
	if _knockback.is_zero_approx():
		return
	_knockback = _knockback.move_toward(Vector2.ZERO, knockback_strength * delta * 4.0)


## Extends the base contract to shove the attacker away on hit.
## Returns the damage that actually landed, matching [Actor.take_damage].
func take_damage(amount: int) -> int:
	if is_dead():
		return 0
	var landed := super(amount)
	var offset := _offset_to_target()
	if not offset.is_zero_approx():
		_knockback = -offset.normalized() * knockback_strength
	return landed

func _on_died() -> void:
	set_physics_process(false)
	set_process(false)
	velocity = Vector2.ZERO
	EventBus.enemy_died.emit(self)
	queue_free()
