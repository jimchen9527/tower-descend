## Base type for anything in the arena that can be hurt.
##
## Exists to give [Player] and [Enemy] one shared, statically-typed damage
## contract ([method take_damage]) without either of them having to know the
## other's concrete type. That is what keeps [Player] -> [Enemy] a one-way
## reference instead of a cyclic one.
##
## ## Damage always flows through here
## [method take_damage] consults [member block] first and only passes the
## remainder to [member health]. Doing it here rather than at each damage source
## means no future card, enemy or hazard can forget to check block — forgetting
## once would be a silent exploit.
##
## REQUIRED CHILD NODES: every [Actor] scene must contain a [HealthComponent]
## at `$HealthComponent`. [BlockComponent] at `$BlockComponent` is optional and
## resolved dynamically, because enemies that never block should not have to
## carry the node. This script fails loudly if the health contract breaks.
class_name Actor
extends CharacterBody2D

## Forwarded from [HealthComponent.health_changed].
signal health_changed(current: int, max_health: int)

## Forwarded from [HealthComponent.did].
signal died

## Forwarded from [BlockComponent.block_changed]. Only fires when the actor
## actually has a block component, so listeners must tolerate the silence.
signal block_changed(current: int, max_block: int)

## Forwarded from [BlockComponent.damage_absorbed].
signal damage_absorbed(absorbed: int, remaining: int)

@export_group("Presentation")
## Optional floating health bar, assigned in the inspector. When set, the actor
## injects itself on `_ready` — the bar never reaches back via `get_parent()`,
## so the wiring stays one-directional.
@export var health_bar_scene: PackedScene
## Where the bar floats relative to this actor's origin. Exposed here (not on
## the bar) because only the actor knows how tall its own sprite is.
@export var health_bar_offset: float = -48.0

@onready var health: HealthComponent = $HealthComponent
## Optional. Null when the scene has no `$BlockComponent` — resolved dynamically
## on purpose so block-less actors need no dummy node.
@onready var block: BlockComponent = get_node_or_null(^"BlockComponent")
## Optional, same reasoning as [member block]: every actor wants statuses in
## principle, but a test-built actor should not have to carry the node.
@onready var status: StatusComponent = get_node_or_null(^"StatusComponent")

func _ready() -> void:
	# NOTE: GDScript does NOT auto-call a parent's _ready(). Subclasses that
	# override _ready() must invoke super() or these connections never happen.
	health.health_changed.connect(_on_health_component_changed)
	health.died.connect(_on_health_component_died)
	if block != null:
		block.block_changed.connect(_on_block_component_changed)
		block.damage_absorbed.connect(_on_block_damage_absorbed)
	# 壁垒 lets a power card switch off the block reset. BlockComponent cannot
	# see StatusComponent, so the status is copied onto it here — the one place
	# where both exist and therefore the only place that can bridge them.
	if block != null and status != null:
		block.keep_block = status.keeps_block()
		status.status_changed.connect(
			func(kind: StatusComponent.Kind, _current: int, _delta: int) -> void:
				if kind == StatusComponent.Kind.BARRICADE:
					block.keep_block = status.keeps_block())
	_spawn_health_bar()

func _spawn_health_bar() -> void:
	if health_bar_scene == null:
		return
	var bar := health_bar_scene.instantiate() as HealthBar
	if bar == null:
		push_error("%s: health_bar_scene root is not a HealthBar." % name)
		return
	bar.height_offset = health_bar_offset
	add_child(bar)
	bar.track(self)

## Single entry point for dealing damage to this actor.
##
## Block absorbs first; only the remainder reaches health. Returns the damage
## that actually landed, so callers report real numbers instead of intent.
##
## Source-less on purpose: this is the melee / enemy-contact path, where there is
## no card and no attacker worth reflecting off. Cards go through
## [method take_damage_from] instead, because 荆棘 has to know who swung.
func take_damage(amount: int) -> int:
	return _apply_damage(amount, false, null)


## Damage that can be reflected. [param source] is the attacker; 荆棘 on this
## actor hits it back. Pass true for [param ignore_block] to bypass block
## (「破岩」, 「终末钻探」 — the Web build's `dealDamageRaw`).
##
## Thorns live here rather than in [method take_damage] because the Web build
## reflects off the *attacker* (combat.js:383) and a source-less signature
## cannot express "who". A null [param source] degrades to no reflection rather
## than erroring, which keeps unit tests cheap.
func take_damage_from(source: Actor, amount: int, ignore_block: bool = false) -> int:
	return _apply_damage(amount, ignore_block, source)


## Shared body of both damage entry points.
##
## Order matches `Combat.dealDamage` (combat.js:360): apply 力量 / 虚弱 / 脆弱
## first, then let block absorb, then only the remainder reaches health. Doing
## the modifier pass here — not in each card — is what makes it structurally
## impossible for a new damage source to skip debuffs.
func _apply_damage(amount: int, ignore_block: bool, source: Actor) -> int:
	var incoming := maxi(amount, 0)
	if is_dead() or incoming == 0:
		return 0
	# 力量 and 虚弱 belong to the ATTACKER; 脆弱 belongs to the DEFENDER.
	# Reading all three off `self` looks plausible and is silently wrong: a
	# player with 力量 3 hitting an unbuffed enemy would deal the base amount and
	# the enemy's own 力量 would be added to the hit against them.
	var strength := 0
	var weak := false
	if source != null and source.status != null:
		strength = source.status.strength_bonus()
		weak = source.status.has_status(StatusComponent.Kind.WEAK)
	var vulnerable := status != null \
		and status.has_status(StatusComponent.Kind.VULNERABLE)
	var final_amount := incoming
	if status != null:
		final_amount = status.resolve_damage(incoming, strength, weak, vulnerable)

	var remaining := final_amount
	if not ignore_block and block != null:
		remaining = block.absorb(final_amount)
		if remaining == 0:
			# Fully blocked, but thorns still answer the swing.
			_reflect_thorns(source)
			return 0
	var before := health.current
	health.take_damage(remaining)
	_reflect_thorns(source)
	return before - health.current


## Health lost directly: poison ticks, and a card's own price (「应急护盾」).
##
## Bypasses block AND thorns by design. The Web build's `loseHp` (combat.js:447)
## does both, and poison would be trivially blockable otherwise — block is a
## shield against blows, not against poison already in the blood.
func lose_health(amount: int) -> int:
	var incoming := maxi(amount, 0)
	if is_dead() or incoming == 0:
		return 0
	var before := health.current
	health.take_damage(incoming)
	return before - health.current


## Restores health, clamped to max. Returns what was actually gained, so a
## full-health actor heals 0 rather than reporting the card's number.
func heal(amount: int) -> int:
	var incoming := maxi(amount, 0)
	if incoming == 0 or is_dead():
		return 0
	var before := health.current
	health.heal(incoming)
	return health.current - before


## Reflects this actor's 荆棘 at [param source]. No-op without a status
## component, without thorns, or against self — the Web build also excludes
## self-inflicted damage (`attacker !== target`, combat.js:385).
func _reflect_thorns(source: Actor) -> void:
	if status == null or source == null or source == self:
		return
	var thorns := status.thorns()
	if thorns > 0:
		source.lose_health(thorns)


## Convenience wrapper for actors without a block component.
func has_block() -> bool:
	return block != null and block.has_block()


## Grants [param amount] block plus this actor's 敏捷. No-op on actors without
## a block component, which lets a "gain block" card target any actor without a
## type check. Returns the resulting block total.
func gain_block(amount: int) -> int:
	if block == null:
		return 0
	var total := amount
	if status != null:
		total = status.resolve_block(amount, status.dexterity_bonus())
	block.gain(total)
	return block.current


## Applies [param amount] stacks of [param kind]. Route every status change
## through here so a status-less actor degrades to a no-op the same way
## block-less ones do. Negative [param amount] strips stacks, which is what
## lets 「震地锤」 matter against an enemy with no 力量 yet.
func add_status(kind: StatusComponent.Kind, amount: int) -> int:
	if status == null:
		return 0
	return status.add(kind, amount)


func status_stacks(kind: StatusComponent.Kind) -> int:
	if status == null:
		return 0
	return status.get_stacks(kind)


## Eats this actor's block and returns how much was there. For the cards that
## convert block into something else (「液压冲击」, 「压力阀」).
func consume_block() -> int:
	if block == null:
		return 0
	return block.consume_all()


## Call at the start of this actor's turn: discards leftover block, then runs the
## status hooks (poison, 金属化, 每回合力量).
##
## Order follows the Web build's `startPlayerTurn` (combat.js:157-217) and each
## step depends on it: block must clear BEFORE 金属化 grants, otherwise the block
## that power just earned would be thrown away in the same breath. Block first,
## then statuses — reversing these two lines silently deletes 井架支撑.
func start_turn() -> void:
	if block != null:
		block.start_turn()
	if status != null:
		status.start_turn()


## Call at the end of this actor's turn: decays 虚弱 / 脆弱 by one stack.
func end_turn() -> void:
	if status != null:
		status.end_turn()

func is_dead() -> bool:
	return health.is_dead()

## Override point: runs right after [method take_damage] reaches the component.
## [param amount] is the damage that actually landed on health, i.e. after
## block absorption — a subclass must not re-derive it from the raw request.
func _on_damaged(_amount: int) -> void:
	pass

func _on_health_component_changed(current: int, max_health: int) -> void:
	health_changed.emit(current, max_health)

func _on_health_component_died() -> void:
	died.emit()

func _on_block_component_changed(current: int, max_block: int) -> void:
	block_changed.emit(current, max_block)

func _on_block_damage_absorbed(absorbed: int, remaining: int) -> void:
	damage_absorbed.emit(absorbed, remaining)
