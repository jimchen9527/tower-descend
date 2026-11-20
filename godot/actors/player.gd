## Player avatar: top-down movement + a timed melee attack.
##
## Run standalone (F6) to verify: this scene is fully self-contained and needs
## no parent context. [HealthComponent] lives at `$HealthComponent` (required by
## [Actor]); everything else it touches is declared as @onready with a type, so a
## renamed or removed node is a parse-time error, not a runtime surprise.
class_name Player
extends Actor

const FRICTION: float = 3200.0
## Keep the avatar this far away from the arena border.
const EDGE_PADDING: float = 28.0

@export_group("Movement")
@export var move_speed: float = 320.0

@export_group("Combat")
@export var attack_damage: int = 25
## Seconds between two swings.
@export var attack_cooldown: float = 0.42
## How long the swing hitbox stays live. This is the player's real reach window:
## too short and the attack feels unresponsive even though the damage is right,
## so it is deliberately longer than the animation's visible arc.
@export_range(0.05, 0.5, 0.01) var swing_duration: float = 0.22
## Forward offset of the hitbox centre, in pixels.
@export var swing_reach: float = 52.0

@onready var body_sprite: Sprite2D = $Body
@onready var swing_sprite: Sprite2D = $Body/SwingSprite
@onready var attack_area: Area2D = $AttackArea
@onready var attack_shape: CollisionShape2D = $AttackArea/CollisionShape2D
@onready var energy: EnergyComponent = $EnergyComponent

## Emitted when a card is played. [param card] is the card that was spent.
signal card_played(card: CardData)

## Emitted when the held card cannot be afforded with the energy available.
## Separate from a silent refusal so the UI can explain why nothing happened.
signal play_refused(reason: String)

## Emitted whenever the hand changes, so a HUD can redraw without polling.
signal hand_changed

## Cards the player can see and play this turn.
var _hand: Array[CardData] = []
## Unseen cards. Drawn from the top via [method draw_cards].
var _draw_pile: Array[CardData] = []
## Spent cards. Reshuffled back into [member _draw_pile] when it runs dry, which
## is the Web build's `drawTo` (combat.js:640).
var _discard_pile: Array[CardData] = []

## Attack cards played this turn. Read by 井底之锤 and 安全帽.
var attacks_played: int = 0
## Skill cards played this turn. Read by 破壁索.
var skills_played: int = 0
## Current shaft depth. Read by the DEPTH-scaling cards (井壁凿击, 深井作业).
var depth: int = 1

var _cooldown_left: float = 0.0
var _swing_left: float = 0.0
var _facing: Vector2 = Vector2.DOWN
## Instance ids already damaged by the swing in progress. Cleared on every swing
## so one swing can never hit the same target twice.
var _already_hit: Dictionary[int, bool] = {}
var _effect := CardEffect.new()

func _ready() -> void:
	super()
	add_to_group(&"player")
	# Disarm in _ready via the deferred setter: flipping `monitoring` during a
	# physics callback raises an engine error.
	attack_area.monitoring = false
	attack_area.body_entered.connect(_on_attack_area_entered)
	# health_changed is forwarded by Actor; listen to the Actor-level signal so
	# the HUD never has to reach into components.
	health_changed.connect(_on_health_changed)
	died.connect(_on_died)

func _physics_process(delta: float) -> void:
	if is_dead():
		return

	_cooldown_left = maxf(_cooldown_left - delta, 0.0)
	_swing_left = maxf(_swing_left - delta, 0.0)
	_update_attack_area()

	var input_dir := Input.get_vector(&"move_left", &"move_right", &"move_up", &"move_down")
	velocity = _compute_velocity(input_dir, delta)
	move_and_slide()
	_clamp_to_arena()
	_update_facing(input_dir)

	if Input.is_action_just_pressed(&"attack"):
		_try_attack()
	elif _swing_left > 0.0:
		_sweep_attack_area()

	if Input.is_action_just_pressed(&"play_card"):
		play_held_card()


## Puts [param card] in hand. Typed so a non-CardData cannot slip in.
func give_card(card: CardData) -> void:
	if card == null:
		return
	_hand.append(card)
	hand_changed.emit()


## The card the UI should show and [method play_held_card] will play: the first
## one in hand, or null when the hand is empty.
##
## The prototype plays a single card per press, so this is a view convenience
## rather than a selection model — [method hand] is the source of truth.
func held_card() -> CardData:
	if _hand.is_empty():
		return null
	return _hand[0]


## Everything in hand, in play order.
func hand() -> Array[CardData]:
	return _hand.duplicate()


## Loads [param cards] as this run's deck and shuffles it into the draw pile.
## The array is copied, not referenced: the caller's deck belongs to the run,
## and this one gets consumed.
func set_deck(cards: Array[CardData]) -> void:
	_draw_pile = cards.duplicate()
	_draw_pile.shuffle()
	_hand.clear()
	_discard_pile.clear()
	hand_changed.emit()


## Draws up to [param amount] cards, refilling from the discard pile when the
## draw pile runs dry. Returns how many were actually drawn.
##
## Never loops forever: when both piles are empty it stops, so a card asking for
## 5 with an empty deck draws 0 instead of hanging the frame.
func draw_cards(amount: int) -> int:
	var drawn := 0
	while drawn < amount:
		if _draw_pile.is_empty():
			if _discard_pile.is_empty():
				break
			_draw_pile = _discard_pile.duplicate()
			_draw_pile.shuffle()
			_discard_pile.clear()
		_hand.append(_draw_pile.pop_back())
		drawn += 1
	if drawn > 0:
		hand_changed.emit()
	return drawn


## Discards the whole hand at end of turn. Keeps the cards in the game — a
## curse in hand has already done its damage at this point, see
## [method curse_damage_in_hand].
func discard_hand() -> void:
	if _hand.is_empty():
		return
	_discard_pile.append_array(_hand)
	_hand.clear()
	hand_changed.emit()


## Health owed by curse cards still in hand at end of turn.
##
## Computed rather than applied so the turn system decides when to charge it —
## the Web build settles curses before discarding (combat.js:224), and getting
## that order wrong lets a player dodge a curse by ending the turn.
func curse_damage_in_hand() -> int:
	var total := 0
	for card in _hand:
		total += card.curse_hp_loss
	return total


## A player turn refills energy, discards leftover block and runs the status
## hooks. All three resets live here rather than being scattered across callers,
## so the rule "energy refills, block expires, statuses tick" is stated once.
func start_turn(bonus_energy: int = 0) -> void:
	super()
	energy.start_turn(bonus_energy)
	attacks_played = 0
	skills_played = 0


## Ends the player's turn: decays their own debuffs. Kept separate from
## [method start_turn] because the Web build decays debuffs at the END of a
## turn (combat.js:235), not at the start — doing it on the way in would silently
## grant every debuffed card an extra turn of life.
func end_turn() -> void:
	super()


## Plays [param card] (default: the first card in hand).
##
## Order of checks matters and is deliberate: energy is verified BEFORE the
## effect resolves, so a card the player cannot afford is never silently eaten. A
## card with no settlement path is refused too and stays in hand either way —
## [signal play_refused] explains which rule stopped it.
##
## Returns true only when a card was actually spent.
func play_held_card(card: CardData = null) -> bool:
	if is_dead():
		return false
	var chosen := card
	if chosen == null:
		chosen = held_card()
	if chosen == null:
		play_refused.emit("手牌为空")
		return false
	if not _hand.has(chosen):
		play_refused.emit("这张牌不在手里")
		return false
	if not energy.can_afford(chosen.cost):
		play_refused.emit("能量不足（需要 %d 点）" % chosen.cost)
		return false

	var target := _nearest_enemy_in_reach()
	# A card that needs an enemy cannot be played out of reach. _make_context
	# fills `enemies` from the whole `enemy` group regardless of distance, so
	# without this the engine would happily resolve a damage card against an
	# enemy 900px away and charge the player for it.
	if chosen.needs_target() and target == null:
		play_refused.emit("没有在攻击范围内的敌人")
		return false
	var context := _make_context(chosen, target)
	if not _effect.resolve(chosen, context):
		play_refused.emit("该卡牌尚无法结算")
		return false
	if not energy.spend(chosen.cost):
		# Unreachable while can_afford passed, but a silent failure here would
		# hand the player a free card.
		play_refused.emit("能量扣除失败")
		return false

	_hand.erase(chosen)
	_discard_pile.append(chosen)
	_record_play(chosen)
	card_played.emit(chosen)
	hand_changed.emit()
	if target != null:
		_face_towards(target.global_position)
	return true


## Builds the resolution context for [param card]: this player as source, the
## nearest enemy as target, and every living enemy for AOE steps.
##
## AOE steps still need [member PlayContext.enemies] populated even when the
## primary target is in reach — 「震波」 hits all of them. It is filled from the
## `enemy` group rather than from a parent path so the player stays independent
## of whichever scene spawned it.
func _make_context(card: CardData, target: Actor) -> CardEffect.PlayContext:
	var context := CardEffect.PlayContext.new()
	context.source = self
	context.target = target
	context.depth = depth
	context.attacks_played = attacks_played
	context.skills_played = skills_played
	for node in get_tree().get_nodes_in_group(&"enemy"):
		var enemy := node as Actor
		if enemy != null and not enemy.is_dead():
			context.enemies.append(enemy)
	return context


## Counts the card into this turn's tallies.
##
## Recorded AFTER resolution, matching the Web build (combat.js:294) — 井底之锤
## reads `turnPlays.attack` and is balanced against not counting itself.
func _record_play(card: CardData) -> void:
	match card.card_type:
		CardData.CardType.ATTACK:
			attacks_played += 1
		CardData.CardType.SKILL, CardData.CardType.POWER:
			skills_played += 1


## Nearest living enemy within melee range of the held card.
## Range reuses [member swing_reach] so a card and a swing agree on what
## "adjacent" means — two different numbers here would make the game feel
## arbitrarily inconsistent.
func _nearest_enemy_in_reach() -> Actor:
	# `shape` is typed Shape2D, so `.radius` is a Variant — it only exists on
	# CapsuleShape2D. Cast explicitly instead of inferring, so a shape swap to
	# (say) a RectangleShape2D fails at compile time rather than at runtime.
	var shape := attack_shape.shape as CapsuleShape2D
	if shape == null:
		return null
	var limit := swing_reach + shape.radius * 2.0
	var best: Actor = null
	var best_distance := limit
	for node in get_tree().get_nodes_in_group(&"enemy"):
		var enemy := node as Actor
		if enemy == null or enemy.is_dead():
			continue
		var distance := global_position.distance_to(enemy.global_position)
		if distance < best_distance:
			best_distance = distance
			best = enemy
	return best


func _face_towards(target_position: Vector2) -> void:
	var offset := target_position - global_position
	if offset.is_zero_approx():
		return
	_facing = offset.normalized()
	body_sprite.rotation = _facing.angle() + PI * 0.5

func _compute_velocity(input_dir: Vector2, delta: float) -> Vector2:
	if not input_dir.is_zero_approx():
		return input_dir * move_speed
	var step := FRICTION * delta
	return velocity.move_toward(Vector2.ZERO, step)

func _clamp_to_arena() -> void:
	var view_size := get_viewport_rect().size
	global_position = global_position.clamp(
		Vector2.ONE * EDGE_PADDING,
		view_size - Vector2.ONE * EDGE_PADDING
	)

func _update_facing(input_dir: Vector2) -> void:
	if input_dir.is_zero_approx():
		return
	_facing = input_dir.normalized()
	body_sprite.rotation = _facing.angle() + PI * 0.5

func _try_attack() -> void:
	if is_dead() or _cooldown_left > 0.0:
		return
	_cooldown_left = attack_cooldown
	_swing_left = swing_duration
	_already_hit.clear()
	_face_attack_area()
	# Deferred: flipping `monitoring` from inside a physics callback is an error.
	# The consequence is that the Area2D is still OFF for the rest of this frame,
	# so `get_overlapping_bodies()` would error out here. `_physics_process` picks
	# the target up on the next step via `_sweep_attack_area()`.
	attack_area.set_deferred("monitoring", true)

func _face_attack_area() -> void:
	attack_shape.position = Vector2(swing_reach, 0.0).rotated(
		body_sprite.rotation - PI * 0.5
	)

func _update_attack_area() -> void:
	var should_monitor := _swing_left > 0.0
	# Fade the arc out over the swing window instead of popping it off.
	# Brightness comes from the texture itself: the gl_compatibility renderer
	# clamps modulate above 1.0, so an over-bright tint would do nothing.
	var window := maxf(swing_duration, 0.001)
	var life := clampf(_swing_left / window, 0.0, 1.0)
	swing_sprite.visible = should_monitor
	if should_monitor:
		swing_sprite.modulate = Color(1.0, 1.0, 1.0, life)
	if attack_area.monitoring == should_monitor:
		return
	attack_area.set_deferred("monitoring", should_monitor)

## Polls everything currently overlapping the swing box.
## `body_entered` alone is not enough: it fires once on entry, so a target that
## walks into an already-open swing, or stands still inside it, would never be hit.
func _sweep_attack_area() -> void:
	# monitoring is off until the deferred setter lands; querying then throws.
	if not attack_area.monitoring:
		return
	for body in attack_area.get_overlapping_bodies():
		_damage_target(body)

func _damage_target(body: Node2D) -> void:
	if _swing_left <= 0.0:
		return
	var target := body as Actor
	if target == null or target == self or target.is_dead():
		return
	if not target.is_in_group(&"enemy"):
		return
	# One hit per swing, even if the target overlaps for several frames.
	if _already_hit.has(target.get_instance_id()):
		return
	_already_hit[target.get_instance_id()] = true
	target.take_damage(attack_damage)
	# Face the thing we just hit so the next swing continues naturally.
	_facing = (target.global_position - global_position).normalized()
	body_sprite.rotation = _facing.angle() + PI * 0.5

func _on_attack_area_entered(body: Node2D) -> void:
	_damage_target(body)

func _on_died() -> void:
	set_physics_process(false)
	attack_area.set_deferred("monitoring", false)
	velocity = Vector2.ZERO
	EventBus.player_died.emit()

func _on_health_changed(current: int, _max_health: int) -> void:
	# Phase 1 hook. The HUD in the main scene listens to this same Actor-level
	# signal, so it never has to reach into the HealthComponent itself.
	body_sprite.modulate = Color.WHITE if current > 0 else Color(0.45, 0.45, 0.45, 1.0)
