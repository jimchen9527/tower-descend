## Combat arena: owns the player, the enemy spawner and the round state.
##
## This is the only scene that knows about both [Player] and [Enemy]. The actors
## themselves know nothing about each other's concrete types — they talk through
## groups, signals and the shared [Actor] base, which is why both remain
## independently testable.
extends Node2D

const ENEMY_SCENE: PackedScene = preload("res://actors/enemy.tscn")
## Keep spawned enemies this far from every screen edge.
const SPAWN_MARGIN: float = 90.0
## Never spawn closer than this to the player, so nothing materialises on top
## of them. Retries are bounded — see _random_spawn_position.
const MIN_SPAWN_DISTANCE: float = 240.0
## Arena backdrop grid, in pixels.
const GRID_SIZE: float = 64.0
const GRID_COLOR: Color = Color(1.0, 1.0, 1.0, 0.045)
const GRID_BORDER: Color = Color(1.0, 1.0, 1.0, 0.10)
## Opening hand size. The Web build draws 5 per turn (combat.js:216).
const HAND_SIZE: int = 5

@export_range(1, 12, 1) var enemy_starting_count: int = 3
@export_range(1, 8, 1) var max_enemies: int = 4
@export_range(0.2, 5.0, 0.1) var respawn_interval: float = 1.2

@onready var player: Player = $Player
@onready var enemy_root: Node2D = $Enemies
@onready var banner: Label = $HUD/Banner
@onready var kill_label: Label = $HUD/KillLabel
@onready var hand_label: Label = $HUD/HandLabel
@onready var resource_label: Label = $HUD/ResourceLabel

var _spawn_timer: float = 0.0
var _alive_enemies: int = 0
var _kills: int = 0
var _cards_played: int = 0
## Guards against ending two turns in one frame while enemies are resolving.
var _turn_locked: bool = false
## Owned by this scene, not an Autoload: the pool is per-run state, and a
## singleton would leak it across scene reloads and tests.
var _library := CardLibrary.new()

func _ready() -> void:
	banner.visible = false
	_library.ensure_loaded()
	player.died.connect(_on_player_died)
	player.card_played.connect(_on_card_played)
	player.play_refused.connect(_on_play_refused)
	# Signal-driven HUD: energy and block change from several places (spending a
	# card, ending a turn, taking a hit), so polling would have to be refreshed
	# at every one of them.
	player.energy.energy_changed.connect(
		func(_current: int, _max: int) -> void: _refresh_resource_label())
	player.block.block_changed.connect(
		func(_current: int, _max: int) -> void: _refresh_resource_label())
	if player.status != null:
		player.status.status_changed.connect(
			func(_kind: StatusComponent.Kind, _cur: int, _delta: int) -> void:
				_refresh_resource_label())
	EventBus.enemy_died.connect(_on_enemy_died)
	player.hand_changed.connect(_refresh_hand_label)
	_deal_starting_deck()
	_refresh_hand_label()
	for _i in enemy_starting_count:
		_spawn_enemy()


## Hands the player the library's starting deck and draws the opening hand.
##
## The deck comes from the pool rather than a hardcoded reference, so the cards
## actually played are the ones a designer authored in the `.tres` — that is the
## whole point of routing this through [CardLibrary].
func _deal_starting_deck() -> void:
	var deck := _library.starting_deck(10)
	if deck.is_empty():
		hand_label.text = "卡池为空"
		return
	player.set_deck(deck)
	player.draw_cards(HAND_SIZE)


func _refresh_hand_label() -> void:
	var card := player.held_card()
	var held := player.hand().size()
	if card == null:
		hand_label.text = "手牌 %d：无　·　Q 无牌可出" % held
	else:
		# The unit label follows the card's leading effect, so a BLOCK card
		# reads "5 格挡" rather than "5 伤害".
		#
		# The count MUST be labelled as the hand total, not written bare as
		# "x%d" right after the selected card's name. "手牌：安全帽（1 费 /
		# 6 格挡）· x4" reads as "you are holding four 安全帽", which is a
		# different claim from "you hold four cards and 安全帽 is the selected
		# one" — and it was read that way the moment a hand legitimately
		# contained a single 安全帽. Naming the subject is the fix, not moving
		# the number further away.
		hand_label.text = "选中：%s（%d 费 / %d %s）　·　手牌共 %d 张　·　Q 出牌" % [
			card.title, card.cost, card.headline_value(), card.headline_unit(),
			held]
	_refresh_resource_label()


func _refresh_resource_label() -> void:
	var block := player.block.current if player.block != null else 0
	var energy := player.energy.current
	var max_energy := player.energy.max_energy
	var text := "能量 %d/%d　·　格挡 %d" % [energy, max_energy, block]
	# Statuses ride along on the same line: a player holding 力量 3 needs to see
	# it, and there is no room for a second row in this prototype's HUD.
	var badges := _status_badges()
	if not badges.is_empty():
		text += "　·　" + " ".join(badges)
	text += "　·　E 结束回合"
	resource_label.text = text


## Renders the player's active statuses as "力量 2" chips, skipping empty ones.
##
## Reads the component's own dict rather than tracking a mirror, so a status
## gained by any route (a card, a power hook) shows up without extra wiring.
func _status_badges() -> Array[String]:
	var badges: Array[String] = []
	if player.status == null:
		return badges
	for kind: StatusComponent.Kind in [
			StatusComponent.Kind.STRENGTH,
			StatusComponent.Kind.DEXTERITY,
			StatusComponent.Kind.WEAK,
			StatusComponent.Kind.VULNERABLE,
			StatusComponent.Kind.POISON,
			StatusComponent.Kind.THORNS,
			StatusComponent.Kind.METALLICIZE,
			StatusComponent.Kind.BARRICADE,
		]:
		var stacks := player.status.get_stacks(kind)
		if stacks > 0:
			badges.append("%s %d" % [StatusComponent.label_for(kind), stacks])
	return badges


func _on_card_played(_card: CardData) -> void:
	_cards_played += 1
	_refresh_hand_label()


## Explains a refused play in the hand line rather than failing silently, so an
## unaffordable or out-of-range card never looks like a dropped input.
func _on_play_refused(reason: String) -> void:
	hand_label.text = "无法出牌：%s" % reason


func _unhandled_input(event: InputEvent) -> void:
	if event.is_action_pressed(&"end_turn"):
		_end_turn()
		return
	if not event.is_action_pressed(&"restart"):
		return
	get_tree().reload_current_scene()


## Ends the player's turn, in the Web build's order (combat.js:219-248):
##   1. Curses still in hand cost health.
##   2. The hand is discarded.
##   3. The player's own debuffs decay.
##   4. Enemies act.
##   5. A fresh turn begins: energy refills, block expires, statuses tick, hand
##      redrawn to [constant HAND_SIZE].
##
## Curses settle BEFORE the discard so a curse cannot be dodged by ending the
## turn, and the enemy's attack lands AFTER the player's block has cleared — the
## same asymmetry the Web build relies on.
func _end_turn() -> void:
	if not is_instance_valid(player) or player.is_dead():
		return
	if _turn_locked:
		return
	_turn_locked = true

	var curse_hp := player.curse_damage_in_hand()
	if curse_hp > 0:
		player.lose_health(curse_hp)
	player.discard_hand()
	player.end_turn()
	_refresh_hand_label()
	_refresh_resource_label()
	if player.is_dead():
		_turn_locked = false
		return

	# Enemies resolve against the player's post-reset state, i.e. the player
	# enters their own turn with no block — the same ordering the Web build uses.
	for child in enemy_root.get_children():
		var enemy := child as Enemy
		if enemy == null or enemy.is_dead():
			continue
		enemy.start_turn()
		enemy.act()

	if not player.is_dead():
		player.start_turn()
		player.draw_cards(HAND_SIZE)
	_refresh_hand_label()
	_refresh_resource_label()
	_turn_locked = false

## Paints the arena floor. Without a backdrop grid there is nothing to judge
## movement speed and spacing against, which makes the whole prototype feel
## unreadable — the grid exists purely as a visual reference.
func _draw() -> void:
	var view_size := get_viewport_rect().size
	var x := 0.0
	while x <= view_size.x:
		draw_line(Vector2(x, 0.0), Vector2(x, view_size.y), GRID_COLOR, 1.0)
		x += GRID_SIZE
	var y := 0.0
	while y <= view_size.y:
		draw_line(Vector2(0.0, y), Vector2(view_size.x, y), GRID_COLOR, 1.0)
		y += GRID_SIZE
	draw_rect(Rect2(Vector2.ONE, view_size - Vector2.ONE), GRID_BORDER, false, 2.0)

func _process(delta: float) -> void:
	if not is_instance_valid(player) or player.is_dead():
		return
	if _alive_enemies >= max_enemies:
		return
	_spawn_timer -= delta
	if _spawn_timer > 0.0:
		return
	_spawn_timer = respawn_interval
	_spawn_enemy()

func _spawn_enemy() -> void:
	var enemy := ENEMY_SCENE.instantiate() as Enemy
	if enemy == null:
		push_error("Main: enemy scene root is not an Enemy.")
		return
	enemy_root.add_child(enemy)
	enemy.global_position = _random_spawn_position()
	_alive_enemies += 1

## Picks a random point in the arena that is not on top of the player.
## Bounded retries instead of an unbounded loop: on a very small viewport the
## constraint may be unsatisfiable, and spinning forever would hang the game.
func _random_spawn_position() -> Vector2:
	var view_size := get_viewport_rect().size
	var edge := Vector2(SPAWN_MARGIN, SPAWN_MARGIN)
	var span := (view_size - edge * 2.0).max(Vector2.ONE)
	var player_pos := player.global_position if is_instance_valid(player) else view_size * 0.5

	var candidate := edge
	var attempts := 0
	while attempts < 12:
		candidate = edge + Vector2(randf() * span.x, randf() * span.y)
		if candidate.distance_to(player_pos) >= MIN_SPAWN_DISTANCE:
			break
		attempts += 1
	return candidate

func _on_enemy_died(_enemy: Node) -> void:
	_alive_enemies = maxi(_alive_enemies - 1, 0)
	_kills += 1
	kill_label.text = "击杀 %d" % _kills

func _notification(what: int) -> void:
	# The grid is sized from the viewport, so it has to be repainted whenever
	# the window changes size. NOTIFICATION_WM_SIZE_CHANGED is the Node-level
	# constant; NOTIFICATION_RESIZED belongs to Control, not to a Node2D.
	if what == NOTIFICATION_WM_SIZE_CHANGED:
		queue_redraw()

func _on_player_died() -> void:
	banner.text = "阵亡\n\n按 R 重新开始"
	banner.visible = true
