## Registers this project's input actions from code.
##
## Lifetime: Autoload, created once at app start.
## Purpose: the project opens and runs correctly even before the actions have
## been authored in the editor's Input Map. Actions that already exist are left
## untouched, so once you author them in the editor this script becomes a no-op
## and can be deleted safely.
##
## Editor-first note: authoring these in Project Settings > Input Map is the
## canonical place for them. This file only exists so the prototype runs on a
## fresh clone with zero manual setup.
extends Node

## action name -> physical keycodes bound to it
const ACTION_KEYS: Dictionary = {
	&"move_left": [KEY_A, KEY_LEFT],
	&"move_right": [KEY_D, KEY_RIGHT],
	&"move_up": [KEY_W, KEY_UP],
	&"move_down": [KEY_S, KEY_DOWN],
	&"attack": [KEY_SPACE, KEY_J],
	&"play_card": [KEY_Q, KEY_ENTER],
	&"end_turn": [KEY_E],
	&"restart": [KEY_R],
}

func _ready() -> void:
	for raw_name in ACTION_KEYS:
		var action := StringName(raw_name)
		if not InputMap.has_action(action):
			InputMap.add_action(action)
		for raw_keycode in ACTION_KEYS[raw_name]:
			var keycode: int = raw_keycode
			if _has_event(action, keycode):
				continue
			var event := InputEventKey.new()
			event.physical_keycode = keycode
			InputMap.action_add_event(action, event)

func _has_event(action: StringName, keycode: int) -> bool:
	for event in InputMap.action_get_events(action):
		var key_event := event as InputEventKey
		if key_event != null and key_event.physical_keycode == keycode:
			return true
	return false
