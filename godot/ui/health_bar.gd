## Floating health bar that tracks an [Actor].
##
## Composition over inheritance: attach to any actor scene and it works. It never
## calls `get_parent()` for logic — the target is injected, and the bar listens
## to the Actor-level `health_changed` signal instead of polling every frame.
##
## Usage:
##   var bar := preload("res://ui/health_bar.tscn").instantiate()
##   add_child(bar)
##   bar.track(actor)
class_name HealthBar
extends Node2D

## Emitted whenever the displayed ratio changes. [param ratio] is 0..1.
signal ratio_changed(ratio: float)

@export var bar_size: Vector2 = Vector2(44.0, 6.0):
	set(value):
		bar_size = value
		queue_redraw()

@export var background_color: Color = Color(0.09, 0.10, 0.14, 0.85)
@export var fill_color: Color = Color(0.36, 0.86, 0.47, 1.0)
## Colour used once the target drops below [param low_ratio].
@export var low_color: Color = Color(0.90, 0.28, 0.24, 1.0)
## Below this fraction of max health the bar switches to [member low_color].
@export_range(0.0, 1.0, 0.01) var low_ratio: float = 0.34
## Vertical offset from the target's origin, in pixels. Keep this in sync with
## the sprite scale in the actor scene — it is the one piece of presentation
## data the bar cannot derive on its own.
@export var height_offset: float = -48.0
## Seconds between visibility polls while the target is at full health.
## Polling (rather than a signal) is deliberate: full health has no signal to
## listen to, and this bar only needs coarse "should I show at all" resolution.
@export var full_health_poll_interval: float = 0.25

var _target: Actor = null
var _ratio: float = 1.0
var _poll_left: float = 0.0

func _ready() -> void:
	queue_redraw()

func _process(delta: float) -> void:
	if not is_instance_valid(_target) or _target.is_dead():
		visible = false
		return
	if _ratio >= 1.0:
		_poll_left -= delta
		if _poll_left <= 0.0:
			_poll_left = full_health_poll_interval
			_refresh_from_target()
	visible = _ratio < 1.0

## Binds this bar to [param actor]. Safe to call before or after `_ready`.
func track(actor: Actor) -> void:
	if _target != null and _target.health_changed.is_connected(_on_health_changed):
		_target.health_changed.disconnect(_on_health_changed)
	_target = actor
	if _target == null:
		_set_ratio(1.0)
		_sync_visibility()
		return
	if not _target.health_changed.is_connected(_on_health_changed):
		_target.health_changed.connect(_on_health_changed)
	_refresh_from_target()
	_sync_visibility()

## `visible` must not wait for the first `_process` tick: an actor that is
## already damaged when the bar is attached would otherwise render one frame
## at full width before settling.
func _sync_visibility() -> void:
	if not is_instance_valid(_target) or _target.is_dead():
		visible = false
		return
	visible = _ratio < 1.0

func _refresh_from_target() -> void:
	if not is_instance_valid(_target):
		return
	var max_health: int = maxi(_target.health.max_health, 1)
	_set_ratio(float(_target.health.current) / float(max_health))

func _on_health_changed(current: int, max_health: int) -> void:
	_set_ratio(float(current) / float(maxi(max_health, 1)))
	# Signal-driven visibility: the bar must react on the same frame the damage
	# lands, not on the next _process tick.
	_sync_visibility()

func _set_ratio(value: float) -> void:
	var clamped := clampf(value, 0.0, 1.0)
	if is_equal_approx(clamped, _ratio):
		return
	_ratio = clamped
	ratio_changed.emit(_ratio)
	queue_redraw()

func current_ratio() -> float:
	return _ratio

func _draw() -> void:
	var origin := Vector2(-bar_size.x * 0.5, height_offset)
	var rect := Rect2(origin, bar_size)
	draw_rect(rect, background_color)
	var fill := rect
	fill.size.x = bar_size.x * _ratio
	if fill.size.x > 0.0:
		draw_rect(fill, low_color if _ratio <= low_ratio else fill_color)
