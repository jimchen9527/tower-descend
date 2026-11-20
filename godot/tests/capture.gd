## Renders real frames of the running game to PNG so the visuals can be checked.
##
## Headless mode never draws, so this runs with a real (dummy-free) rendering
## path and grabs the viewport after a fixed number of frames. It also drives
## synthetic input so the swing animation and the damaged-health bar are both
## captured — a screenshot of an idle first frame would prove nothing.
##
## Run:
##   godot --path D:/竖井/godot res://tests/capture.gd -- <out_dir>
extends Node

const PLAYER_SCENE: PackedScene = preload("res://actors/player.tscn")
const ENEMY_SCENE: PackedScene = preload("res://actors/enemy.tscn")

var _out_dir: String = "user://captures"
var _main: Node = null
var _frame: int = 0
var _player: Player = null
## Set while a swing is being held open for the capture.
var _swing_frames_left: int = 0

func _ready() -> void:
	for arg in OS.get_cmdline_user_args():
		_out_dir = arg
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(_out_dir))
	_build_scene()
	set_process(true)

func _build_scene() -> void:
	var packed: PackedScene = load("res://scenes/main.tscn")
	_main = packed.instantiate()
	add_child(_main)
	_player = _main.get("player") as Player

func _process(_delta: float) -> void:
	_frame += 1
	# Hold the swing open across real frames. Driving `_physics_process` by hand
	# from a single _process tick closes the swing window before the frame is
	# ever presented, which is why the arc kept missing from the captures.
	if _swing_frames_left > 0:
		_swing_frames_left -= 1
		if _swing_frames_left == 0:
			Input.action_release(&"attack")

	match _frame:
		5:
			_capture("01-spawn")
		30:
			if is_instance_valid(_player):
				_player.take_damage(35)
			_capture("02-player-damaged")
		50:
			_begin_swing()
		56:
			_capture("03-swing-arc")
		75:
			_damage_enemy_and_capture("04-enemy-bar")
		95:
			_capture("05-late")
		115:
			_play_card_and_capture("06-card-played")
		135:
			_show_resources("07-block-and-energy")
		165:
			_finish()

## Opens the swing window through the real gameplay path (the attack action),
## then extends it so the arc is guaranteed to still be on screen when the
## frame is presented. Waiting on `is_action_just_pressed` alone is flaky: the
## window is shorter than the capture cadence.
func _begin_swing() -> void:
	if not is_instance_valid(_player):
		return
	Input.action_press(&"attack")
	_player._try_attack()
	Input.action_release(&"attack")
	_player._swing_left = _player.swing_duration
	_player._update_attack_area()
	# _update_attack_area defers the physics flag, so force the visual here or
	# the arc is still hidden on the frame we capture.
	_player.swing_sprite.visible = true
	_player.swing_sprite.modulate = Color(1.0, 1.0, 1.0, 1.0)
	_swing_frames_left = 4

## Raises block and drains energy, so the HUD line and the floating bar both
## show the Phase 4 resources instead of only ever displaying zeros.
func _show_resources(label: String) -> void:
	if not is_instance_valid(_player):
		return
	_player.gain_block(18)
	_player.energy.spend(2)
	await RenderingServer.frame_post_draw
	_capture(label)

## Moves an enemy next to the player and plays the held card, so the capture
## shows a real card being spent against a real target.
func _play_card_and_capture(label: String) -> void:
	if _main == null or not is_instance_valid(_player):
		return
	var enemies := _main.get_node_or_null("Enemies")
	if enemies == null or enemies.get_child_count() == 0:
		return
	var victim := enemies.get_child(0) as Actor
	if victim == null or _player.held_card() == null:
		return
	victim.global_position = _player.global_position + Vector2(46.0, 0.0)
	_player.play_held_card()
	await RenderingServer.frame_post_draw
	_capture(label)

func _damage_enemy_and_capture(label: String) -> void:
	if _main == null:
		return
	var enemies := _main.get_node_or_null("Enemies")
	if enemies == null:
		return
	var first := enemies.get_child(0)
	var victim := first as Enemy
	if victim == null:
		return
	victim.take_damage(20)
	await RenderingServer.frame_post_draw
	_capture(label)

func _capture(label: String) -> void:
	var image := get_viewport().get_texture().get_image()
	if image == null:
		push_error("Capture: viewport returned no image for %s" % label)
		return
	var path := "%s/%s.png" % [_out_dir, label]
	var err := image.save_png(path)
	if err != OK:
		push_error("Capture: save_png failed (%d) for %s" % [err, path])
		return
	print("  captured %s" % ProjectSettings.globalize_path(path))

func _finish() -> void:
	print("  capture run complete")
	get_tree().quit(0)
