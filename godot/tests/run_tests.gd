## Headless test suite for the combat core loop.
##
## This scene is the project's MAIN SCENE while testing, so autoloads (EventBus)
## and global class names (Player / Enemy / HealthComponent) resolve exactly as
## they do in a real run. Do NOT try to run it via `--script`: that mode skips
## autoload registration, which makes every class-name check fail for the wrong
## reason.
##
## Run with:
##   godot --headless --path D:/竖井/godot res://tests/test_runner.tscn
##
## ## On the card pool
## Cards are loaded from the real `.tres` files on disk, never built in code, so
## a wrong enum ordinal or a broken sub-resource fails here rather than in a
## running game. [method _test_every_card_resolves] additionally drives every one
## of the 48 cards through the engine — a pool that merely *loads* proves very
## little, and the whole point of this phase was that the previous 6-card pool
## loaded fine while 41 cards could not be represented at all.
extends Node

const PLAYER_SCENE: PackedScene = preload("res://actors/player.tscn")
const ENEMY_SCENE: PackedScene = preload("res://actors/enemy.tscn")
const MAIN_SCENE: PackedScene = preload("res://scenes/main.tscn")
const STRIKE_CARD := preload("res://cards/library/strike.tres") as CardData
const DEFEND_CARD := preload("res://cards/library/defend.tres") as CardData
const CROWBAR_CARD := preload("res://cards/library/crowbar.tres") as CardData
const CHAIN_CHISEL_CARD := preload("res://cards/library/chain_chisel.tres") as CardData
const SHOCKWAVE_CARD := preload("res://cards/library/shockwave.tres") as CardData
const DEEP_WORK_CARD := preload("res://cards/library/deep_work.tres") as CardData
const DISMANTLE_CARD := preload("res://cards/library/dismantle.tres") as CardData
const ROCKBREAK_CARD := preload("res://cards/library/rockbreak.tres") as CardData
const RIPOSTE_CARD := preload("res://cards/library/riposte.tres") as CardData
const HYDRAULIC_CARD := preload("res://cards/library/hydraulic.tres") as CardData
const BALLAST_CARD := preload("res://cards/library/ballast.tres") as CardData
const PLATE_GUARD_CARD := preload("res://cards/library/plate_guard.tres") as CardData
const PRY_COMBO_CARD := preload("res://cards/library/pry_combo.tres") as CardData
const HARDHAT_CARD := preload("res://cards/library/hardhat.tres") as CardData
const CHAIN_DEMOLITION_CARD := preload("res://cards/library/chain_demolition.tres") as CardData
const WEIGHT_CARD := preload("res://cards/library/ballast.tres") as CardData

## Matches the Web build's Digger pool size (47) plus its one curse card.
## A silent drop below this is the failure mode a "loads without error" check
## cannot see, so the count itself is asserted.
const EXPECTED_POOL_SIZE: int = 48

var _passed: int = 0
var _failed: int = 0
var _failures: Array[String] = []

func _ready() -> void:
	# Components
	_test_health_damage_reduces()
	_test_health_clamps_at_zero()
	_test_died_fires_exactly_once()
	_test_health_ignores_invalid_damage()
	_test_max_health_setter_clamps()
	_test_health_heals_up_to_max()
	_test_block_absorbs_before_health()
	_test_block_caps_at_max()
	_test_block_expires_at_turn_start()
	_test_block_can_persist_when_configured()
	_test_energy_refills_to_cap_each_turn()
	_test_energy_spend_gates_the_card()
	_test_energy_never_partially_spends()
	_test_status_stacks_and_strips()
	_test_status_resolution_order()
	_test_poison_ignores_block_and_decays()
	_test_debuffs_decay_at_end_of_turn()
	_test_metallicize_survives_the_block_clear()

	# Actors
	_test_actor_forwards_component_signal()
	_test_actor_without_block_takes_full_damage()
	_test_actor_without_status_degrades()
	_test_player_joins_group()
	_test_enemy_joins_group()
	_test_attack_cooldown_gates_repeat_swing()
	_test_single_hit_per_swing()
	_test_contact_damage_respects_interval()
	_test_dead_actor_stops_simulating()
	_test_zero_distance_still_connects()
	_test_block_absorbs_an_enemy_swing()
	_test_thorns_reflects_the_attacker()

	# Scenes / presentation
	_test_player_scene_isolated()
	_test_enemy_scene_isolated()
	_test_main_scene_wiring()
	_test_signal_contract_declared()
	_test_health_bar_tracks_actor()
	_test_health_bar_hides_at_full_health()
	_test_health_bar_follows_damage()
	_test_actor_spawns_its_own_health_bar()
	_test_swing_arc_fades_with_swing_window()
	_test_sprite_textures_assigned()

	# Card data
	_test_card_resource_parses()
	_test_card_upgrade_numbers()
	_test_card_validation_rejects_bad_data()
	_test_card_playability_filter()
	_test_curse_card_is_held_but_unplayable()

	# Card library
	_test_card_library_loads_pool()
	_test_card_library_filters()
	_test_card_library_rejects_duplicates()
	_test_card_library_starting_deck_is_deterministic()

	# Resolution
	_test_card_effect_deals_damage()
	_test_card_effect_refuses_unimplemented()
	_test_card_effect_never_heals_target()
	_test_damage_card_reports_block_split()
	_test_block_card_resolves_without_target()
	_test_conditional_replaces_instead_of_adds()
	_test_block_ratio_scales_damage()
	_test_consume_block_converts_to_damage()
	_test_multi_hit_repeats()
	_test_aoe_hits_every_enemy()
	_test_depth_scaling()
	_test_status_applied_to_enemy()
	_test_strength_scales_damage()
	_test_dexterity_scales_block()
	_test_raw_damage_ignores_block()
	_test_kill_triggers_a_bonus()
	_test_conditional_step_gate_shapes()
	_test_status_step_runs_before_block_step()
	_test_every_card_resolves()

	# Deck / wiring
	_test_draw_pile_and_reshuffle()
	_test_player_plays_card_against_enemy()
	_test_player_keeps_card_when_out_of_reach()
	_test_player_keeps_unresolvable_card()
	_test_play_counts_into_turn_tallies()
	_test_curse_costs_health_at_end_of_turn()
	_test_main_scene_deals_a_starting_card()
	_test_hand_label_names_both_subjects()
	_test_end_turn_key_actually_ends_the_turn()
	_test_play_card_key_reaches_the_polling_input_path()
	_test_player_turn_resets_both_pools()
	_report()

func _report() -> void:
	print("")
	print("==================================================")
	print("  PASS: %d    FAIL: %d" % [_passed, _failed])
	for failure in _failures:
		print("    - %s" % failure)
	print("==================================================")
	get_tree().quit(1 if _failed > 0 else 0)

## Runs one labelled test body and scores it.
##
## `_case` used to score purely on "no assertion fired", which quietly turned a
## mid-test exception into a PASS: GDScript aborts the whole lambda on a runtime
## error (e.g. handing a bare `[A, B, C]` to a `Array[CardData]` parameter), so
## every assertion after the throw never ran, the failure counter stayed put, and
## the truncated test was reported green. That is the same trap as asserting over
## an empty set — a test that died early and a test that passed look identical.
##
## The fix is a sentinel: every body must reach [method _end] as its last
## statement. If the body threw before getting there, the case is scored as a
## failure naming the truncation, and `_report` calls it out as an ERROR so it is
## not confused with an ordinary wrong number.
func _case(title: String, body: Callable) -> void:
	var failed_before := _failed
	var reached_end := [false]
	_case_depth.push_back(reached_end)
	body.call()
	_case_depth.pop_back()
	if not reached_end[0]:
		_failed += 1
		_failures.append("ABORTED (threw before its last line): %s" % title)
		print("  [ERROR] %s — body aborted early" % title)
		return
	if _failed == failed_before:
		_passed += 1
		print("  [PASS] %s" % title)
	else:
		print("  [FAIL] %s" % title)

## The sentinel [method _case] looks for. Must be the last statement of every
## test body; see that method for why.
func _end() -> void:
	if not _case_depth.is_empty():
		(_case_depth[-1] as Array)[0] = true

var _case_depth: Array = []

func _check(condition: bool, message: String) -> void:
	if condition:
		return
	_failed += 1
	_failures.append(message)

func _spawn(scene: PackedScene) -> Actor:
	var actor := scene.instantiate() as Actor
	add_child(actor)
	return actor

## Typed spawns. [method _spawn] returns [Actor], which is correct but hides
## [Player]-only members such as `hand`, `energy` and `curse_damage_in_hand`
## from the compiler. Those tests fail to parse with "Cannot infer the type"
## unless the static type is Player, so anything touching them uses these.
func _spawn_player() -> Player:
	return _spawn(PLAYER_SCENE) as Player

func _spawn_enemy() -> Enemy:
	return _spawn(ENEMY_SCENE) as Enemy

## Builds a deck for [method Player.set_deck], which takes `Array[CardData]`.
##
## A bare `[A, B, C]` literal infers to `Array`, and passing it to a typed-array
## parameter raises at RUNTIME rather than failing to parse — which is worse,
## because the exception aborts the rest of the enclosing `_case` lambda and
## every later assertion in it simply never runs. `_case` would then score the
## truncated test as a pass. Every deck literal goes through here instead.
func _deck(cards: Array[CardData]) -> Array[CardData]:
	var out: Array[CardData] = []
	for card in cards:
		out.append(card)
	return out

func _despawn(node: Node) -> void:
	remove_child(node)
	node.free()

func _bare_block(max_block: int = 30) -> BlockComponent:
	var block := BlockComponent.new()
	block.max_block = max_block
	add_child(block)
	return block

func _bare_energy(max_energy: int = 3) -> EnergyComponent:
	var energy := EnergyComponent.new()
	energy.max_energy = max_energy
	add_child(energy)
	return energy

## Builds a context wired to real actors, mirroring how gameplay calls it.
func _make_context(card: CardData, source: Actor, target: Actor) -> CardEffect.PlayContext:
	var context := CardEffect.PlayContext.new()
	context.source = source
	context.target = target
	if target != null:
		context.enemies.append(target)
	return context

# --- HealthComponent -------------------------------------------------------

func _test_health_damage_reduces() -> void:
	_case("HealthComponent: damage reduces current", func() -> void:
		var player := _spawn(PLAYER_SCENE)
		player.health.take_damage(25)
		_check(player.health.current == 75,
			"damage: expected 75, got %d" % player.health.current)
		_despawn(player); _end())

func _test_health_clamps_at_zero() -> void:
	_case("HealthComponent: never drops below zero", func() -> void:
		var player := _spawn(PLAYER_SCENE)
		player.take_damage(9999)
		_check(player.health.current == 0,
			"clamp: expected 0, got %d" % player.health.current)
		_despawn(player); _end())

func _test_died_fires_exactly_once() -> void:
	_case("HealthComponent: died fires exactly once", func() -> void:
		var player := _spawn(PLAYER_SCENE)
		var deaths := [0]
		player.died.connect(func() -> void: deaths[0] += 1)
		player.take_damage(50)
		player.take_damage(50)
		player.take_damage(50)
		_check(deaths[0] == 1, "died fired %d times, expected exactly 1" % deaths[0])
		_despawn(player); _end())

func _test_health_ignores_invalid_damage() -> void:
	_case("HealthComponent: ignores non-positive damage", func() -> void:
		var player := _spawn(PLAYER_SCENE)
		var before := player.health.current
		player.take_damage(0)
		player.take_damage(-30)
		_check(player.health.current == before,
			"invalid damage changed current from %d to %d"
			% [before, player.health.current])
		_despawn(player); _end())

func _test_max_health_setter_clamps() -> void:
	_case("HealthComponent: lowering max_health clamps current", func() -> void:
		var player := _spawn(PLAYER_SCENE)
		player.take_damage(60)
		player.health.max_health = 30
		_check(player.health.current == 30,
			"max_health clamp: expected 30, got %d" % player.health.current)
		_despawn(player); _end())

func _test_health_heals_up_to_max() -> void:
	_case("HealthComponent: heal restores and clamps at max", func() -> void:
		var player := _spawn(PLAYER_SCENE)
		player.take_damage(30)
		var healed := player.heal(10)
		_check(healed == 10, "healing 10 into 70/100 must return 10, got %d" % healed)
		_check(player.health.current == 80,
			"health should be 80, got %d" % player.health.current)
		# A heal larger than the missing health must report the REAL amount,
		# never the card's nominal number.
		var overkill := player.heal(999)
		_check(overkill == 20,
			"healing 999 at 80/100 must report the 20 actually gained, got %d" % overkill)
		_check(player.health.current == player.health.max_health,
			"health must cap at max, got %d" % player.health.current)
		_despawn(player); _end())

# --- Block / energy --------------------------------------------------------

func _test_block_absorbs_before_health() -> void:
	_case("Block: soaks damage before health", func() -> void:
		var enemy := _spawn(ENEMY_SCENE)
		enemy.gain_block(10)
		var before := enemy.health.current
		var landed := enemy.take_damage(6)
		_check(landed == 0,
			"a 6-damage hit into 10 block must land 0, landed %d" % landed)
		_check(enemy.health.current == before,
			"health must be untouched, went %d -> %d"
			% [before, enemy.health.current])
		_check(enemy.block.current == 4,
			"block should drop to 4, got %d" % enemy.block.current)
		# Overcommit: block soaks 4 of the 9, and only the remaining 5 may reach
		# health. (9 - 4 == 5; asserting 3 here would be an arithmetic slip.)
		landed = enemy.take_damage(9)
		_check(landed == 5,
			"9 damage into 4 block must land 5, landed %d" % landed)
		_check(enemy.health.current == before - 5,
			"health should drop by exactly 5, dropped by %d"
			% (before - enemy.health.current))
		_check(enemy.block.current == 0, "block should be fully consumed")
		_despawn(enemy); _end())

func _test_block_caps_at_max() -> void:
	_case("Block: never exceeds its cap", func() -> void:
		var block := _bare_block(12)
		block.gain(999)
		_check(block.current == 12,
			"block must clamp to max_block, got %d" % block.current)
		block.gain(-5)
		_check(block.current == 12, "a negative gain must be ignored")
		_despawn(block); _end())

func _test_block_expires_at_turn_start() -> void:
	_case("Block: leftover expires at the turn boundary", func() -> void:
		var block := _bare_block(30)
		block.gain(15)
		var cleared: Array[int] = []
		block.block_cleared.connect(func(discarded: int) -> void: cleared.append(discarded))
		block.start_turn()
		_check(block.current == 0,
			"block must reset to 0, got %d" % block.current)
		_check(cleared.size() == 1 and cleared[0] == 15,
			"block_cleared must report the discarded amount, saw %s" % [cleared])
		_despawn(block); _end())

func _test_block_can_persist_when_configured() -> void:
	_case("Block: keep_block opts out of the reset", func() -> void:
		var block := _bare_block(30)
		block.keep_block = true
		block.gain(9)
		block.start_turn()
		_check(block.current == 9,
			"keep_block must survive the turn, got %d" % block.current)
		_despawn(block); _end())

func _test_energy_refills_to_cap_each_turn() -> void:
	_case("Energy: refills to the cap, it does not accumulate", func() -> void:
		var energy := _bare_energy(3)
		energy.spend(3)
		_check(energy.current == 0, "spending 3 of 3 must leave 0")
		# Leftover is discarded, not banked: this is the rule that makes card
		# cost a real constraint every single turn.
		energy.start_turn()
		_check(energy.current == 3,
			"a new turn must restore the full 3, got %d" % energy.current)
		energy.start_turn(1)
		_check(energy.current == 3,
			"bonus energy must clamp to max_energy, got %d" % energy.current)
		_despawn(energy); _end())

func _test_energy_spend_gates_the_card() -> void:
	_case("Energy: spend refuses when short and reports why", func() -> void:
		var energy := _bare_energy(3)
		var refusals: Array[int] = []
		energy.spend_refused.connect(
			func(required: int, _avail: int) -> void: refusals.append(required))
		_check(energy.can_afford(3), "3 of 3 must be affordable")
		_check(energy.spend(2), "spending 2 of 3 must succeed")
		_check(energy.current == 1, "should be left with 1, got %d" % energy.current)
		_check(not energy.can_afford(2), "2 must not be affordable with 1 left")
		_check(not energy.spend(2), "spending 2 with 1 left must fail")
		_check(energy.current == 1,
			"a refused spend must leave energy untouched, got %d" % energy.current)
		_check(refusals.size() == 1 and refusals[0] == 2,
			"spend_refused must report the shortfall, saw %s" % [refusals])
		_despawn(energy); _end())

func _test_energy_never_partially_spends() -> void:
	_case("Energy: a refused spend is all-or-nothing", func() -> void:
		var energy := _bare_energy(2)
		_check(not energy.spend(5),
			"spending 5 with 2 available must fail outright")
		_check(energy.current == 2,
			"a partial spend would let players probe affordability; got %d"
			% energy.current)
		_check(energy.spend(0), "spending 0 must always succeed")
		_despawn(energy); _end())

# --- StatusComponent -------------------------------------------------------

func _test_status_stacks_and_strips() -> void:
	_case("Status: stacks add and negative amounts strip", func() -> void:
		var player := _spawn(PLAYER_SCENE)
		player.add_status(StatusComponent.Kind.STRENGTH, 2)
		_check(player.status_stacks(StatusComponent.Kind.STRENGTH) == 2,
			"力量 should be 2, got %d"
			% player.status_stacks(StatusComponent.Kind.STRENGTH))
		player.add_status(StatusComponent.Kind.STRENGTH, 1)
		_check(player.status_stacks(StatusComponent.Kind.STRENGTH) == 3,
			"力量 should stack to 3")
		player.add_status(StatusComponent.Kind.STRENGTH, -2)
		_check(player.status_stacks(StatusComponent.Kind.STRENGTH) == 1,
			"stripping 2 should leave 1")
		# Stripping past zero must floor at 0, not go negative — a negative
		# 力量 would quietly become a damage penalty for the rest of the fight.
		player.add_status(StatusComponent.Kind.STRENGTH, -99)
		_check(player.status_stacks(StatusComponent.Kind.STRENGTH) == 0,
			"力量 must floor at 0, got %d"
			% player.status_stacks(StatusComponent.Kind.STRENGTH))
		_despawn(player); _end())

func _test_status_resolution_order() -> void:
	_case("Status: strength then weak then vulnerable, in that order", func() -> void:
		var status := StatusComponent.new()
		add_child(status)
		# Mirrors Combat.rawDamage: (base + str) then weak, then vulnerable.
		_check(status.resolve_damage(10, 0, false, false) == 10,
			"no modifiers must pass 10 through")
		_check(status.resolve_damage(10, 4, false, false) == 14,
			"力量 4 must add flat, got %d" % status.resolve_damage(10, 4, false, false))
		# (10 + 4) * 0.75 = 10.5 -> floor 10. Doing 10*0.75+4 = 11 instead
		# would silently buff every 力量 card, which is the exact reason the
		# order is asserted rather than assumed.
		_check(status.resolve_damage(10, 4, true, false) == 10,
			"力量 4 + weak must floor to 10, got %d"
			% status.resolve_damage(10, 4, true, false))
		_check(status.resolve_damage(10, 0, false, true) == 15,
			"vulnerable must take 10 to 15, got %d"
			% status.resolve_damage(10, 0, false, true))
		_check(status.resolve_block(5, 3) == 8,
			"敏捷 3 must add to block, got %d" % status.resolve_block(5, 3))
		_despawn(status); _end())

func _test_poison_ignores_block_and_decays() -> void:
	_case("Status: poison ticks through block and loses a stack", func() -> void:
		var player := _spawn(PLAYER_SCENE)
		player.gain_block(999)
		player.add_status(StatusComponent.Kind.POISON, 3)
		var before := player.health.current
		player.start_turn()
		# 30 block is on the player; poison must still cost 3 health.
		_check(before - player.health.current == 3,
			"poison must ignore block and cost 3, cost %d"
			% (before - player.health.current))
		_check(player.status_stacks(StatusComponent.Kind.POISON) == 2,
			"poison should drop to 2, got %d"
			% player.status_stacks(StatusComponent.Kind.POISON))
		_despawn(player); _end())

func _test_debuffs_decay_at_end_of_turn() -> void:
	_case("Status: weak and vulnerable decay, buffs do not", func() -> void:
		var player := _spawn(PLAYER_SCENE)
		player.add_status(StatusComponent.Kind.WEAK, 2)
		player.add_status(StatusComponent.Kind.VULNERABLE, 1)
		player.add_status(StatusComponent.Kind.STRENGTH, 3)
		player.end_turn()
		_check(player.status_stacks(StatusComponent.Kind.WEAK) == 1,
			"虚弱 should decay 2 -> 1, got %d"
			% player.status_stacks(StatusComponent.Kind.WEAK))
		_check(player.status_stacks(StatusComponent.Kind.VULNERABLE) == 0,
			"脆弱 should decay away entirely")
		# 力量 is a buff and must NOT decay — if the DECAYING list ever grew to
		# include it, every 力量 card would quietly halve each turn.
		_check(player.status_stacks(StatusComponent.Kind.STRENGTH) == 3,
			"力量 must not decay, got %d"
			% player.status_stacks(StatusComponent.Kind.STRENGTH))
		_despawn(player); _end())

func _test_metallicize_survives_the_block_clear() -> void:
	_case("Status: 金属化 grants block after the turn's clear", func() -> void:
		var player := _spawn(PLAYER_SCENE)
		player.add_status(StatusComponent.Kind.METALLICIZE, 4)
		player.gain_block(10)
		player.start_turn()
		# Order matters: block clears to 0, THEN 金属化 grants 4. If the hook ran
		# first the 4 would be discarded and the power would do nothing.
		_check(player.block.current == 4,
			"金属化 4 must survive the clear, block should be 4, got %d"
			% player.block.current)
		_despawn(player); _end())

func _test_barricade_keeps_block_across_turns() -> void:
	_case("Status: 壁垒 stops the block clear", func() -> void:
		var player := _spawn(PLAYER_SCENE)
		player.add_status(StatusComponent.Kind.BARRICADE, 1)
		player.gain_block(9)
		player.start_turn()
		_check(player.block.current == 9,
			"壁垒 must keep block across the boundary, got %d"
			% player.block.current)
		_despawn(player); _end())

# --- Actor -----------------------------------------------------------------

func _test_actor_forwards_component_signal() -> void:
	_case("Actor: forwards component signal without polling", func() -> void:
		var player := _spawn(PLAYER_SCENE)
		var seen: Array[int] = []
		player.health_changed.connect(
			func(current: int, _max: int) -> void: seen.append(current))
		player.take_damage(10)
		_check(seen.has(90),
			"Actor did not forward health_changed, saw %s" % [seen])
		_despawn(player); _end())

func _test_actor_without_block_takes_full_damage() -> void:
	_case("Actor: no block component means no absorption", func() -> void:
		var bare := Actor.new()
		var health := HealthComponent.new()
		health.name = "HealthComponent"
		bare.add_child(health)
		add_child(bare)
		_check(bare.block == null,
			"a bare actor must resolve block to null, got %s" % bare.block)
		var landed := bare.take_damage(7)
		_check(landed == 7, "without block the full 7 must land, landed %d" % landed)
		_check(bare.gain_block(10) == 0,
			"gain_block on a block-less actor must be a no-op, not a crash")
		_despawn(bare); _end())

func _test_actor_without_status_degrades() -> void:
	_case("Actor: no status component degrades instead of crashing", func() -> void:
		var bare := Actor.new()
		var health := HealthComponent.new()
		health.name = "HealthComponent"
		bare.add_child(health)
		add_child(bare)
		_check(bare.status == null, "a bare actor must resolve status to null")
		_check(bare.add_status(StatusComponent.Kind.STRENGTH, 3) == 0,
			"add_status on a status-less actor must be a no-op")
		_check(bare.status_stacks(StatusComponent.Kind.STRENGTH) == 0,
			"status_stacks on a status-less actor must read 0")
		# start_turn must tolerate the missing component too, since the turn
		# system calls it unconditionally on every actor.
		bare.start_turn()
		bare.end_turn()
		_despawn(bare); _end())

func _test_player_joins_group() -> void:
	_case("Player: joins the 'player' group", func() -> void:
		var player := _spawn(PLAYER_SCENE)
		_check(player.is_in_group(&"player"), "player is not in group 'player'")
		_despawn(player); _end())

func _test_enemy_joins_group() -> void:
	_case("Enemy: joins the 'enemy' group", func() -> void:
		var enemy := _spawn(ENEMY_SCENE)
		_check(enemy.is_in_group(&"enemy"), "enemy is not in group 'enemy'")
		_despawn(enemy); _end())

func _test_thorns_reflects_the_attacker() -> void:
	_case("Thorns: reflects damage onto the attacker", func() -> void:
		var player := _spawn(PLAYER_SCENE)
		var enemy := _spawn(ENEMY_SCENE)
		enemy.add_status(StatusComponent.Kind.THORNS, 4)
		var player_before := player.health.current
		enemy.take_damage_from(player, 10)
		_check(player.health.current == player_before - 4,
			"thorns 4 must cost the attacker 4, went %d -> %d"
			% [player_before, player.health.current])
		# Self-inflicted damage must NOT reflect — the Web build guards this
		# with `attacker !== target`, and without the guard a thorns card would
		# chew through its own owner's health.
		var enemy_before := enemy.health.current
		enemy.take_damage_from(enemy, 5)
		_check(enemy.health.current == enemy_before - 5,
			"self-damage must not reflect, went %d -> %d"
			% [enemy_before, enemy.health.current])
		_despawn(player)
		_despawn(enemy); _end())

# --- Combat rules ----------------------------------------------------------

func _test_attack_cooldown_gates_repeat_swing() -> void:
	_case("Player: cooldown gates a second swing", func() -> void:
		var player := _spawn(PLAYER_SCENE)
		player._try_attack()
		var first_cooldown: float = player._cooldown_left
		player._try_attack()
		_check(first_cooldown > 0.0, "cooldown was never set after a swing")
		_check(is_equal_approx(player._cooldown_left, first_cooldown),
			"second swing bypassed the cooldown (%f -> %f)"
			% [first_cooldown, player._cooldown_left])
		_despawn(player); _end())

func _test_single_hit_per_swing() -> void:
	_case("Player: one swing damages a target at most once", func() -> void:
		var player := _spawn(PLAYER_SCENE)
		var enemy := _spawn(ENEMY_SCENE)
		var before := enemy.health.current
		player._swing_left = player.swing_duration
		player._damage_target(enemy)
		player._damage_target(enemy)
		player._damage_target(enemy)
		var dealt := before - enemy.health.current
		_check(dealt == player.attack_damage,
			"three hits in one swing dealt %d, expected exactly %d"
			% [dealt, player.attack_damage])
		_despawn(player)
		_despawn(enemy); _end())

func _test_contact_damage_respects_interval() -> void:
	_case("Enemy: attacks once per turn, not once per frame", func() -> void:
		var player := _spawn(PLAYER_SCENE)
		var enemy := _spawn(ENEMY_SCENE)
		enemy.global_position = player.global_position
		enemy._resolve_target()
		_check(enemy._target == player,
			"enemy did not resolve the player as its target")
		var before := player.health.current

		enemy.act()
		_check(enemy.is_swinging(),
			"act() must start a wind-up rather than damage instantly")
		# Running many frames must not multiply the damage.
		for _i in 120:
			enemy._process(1.0 / 60.0)
		var after_one_swing := before - player.health.current
		_check(after_one_swing == enemy.contact_damage,
			"120 frames of a single swing must land exactly %d, landed %d"
			% [enemy.contact_damage, after_one_swing])

		enemy.act()
		for _i in 120:
			enemy._process(1.0 / 60.0)
		_check(before - player.health.current == enemy.contact_damage * 2,
			"two turns must land exactly %d, landed %d"
			% [enemy.contact_damage * 2, before - player.health.current])
		_despawn(player)
		_despawn(enemy); _end())

func _test_dead_actor_stops_simulating() -> void:
	_case("Actor: dead actor stops simulating", func() -> void:
		var enemy := _spawn(ENEMY_SCENE)
		enemy.take_damage(9999)
		_check(enemy.is_dead(), "enemy should be dead")
		enemy._physics_process(1.0 / 60.0)
		_check(enemy.velocity.is_zero_approx(),
			"dead enemy still moving, velocity=%s" % enemy.velocity)
		_despawn(enemy); _end())

func _test_zero_distance_still_connects() -> void:
	_case("Enemy: hits at zero separation", func() -> void:
		var player := _spawn(PLAYER_SCENE)
		var enemy := _spawn(ENEMY_SCENE)
		enemy.global_position = player.global_position
		enemy._resolve_target()
		_check(enemy._offset_to_target().length() < 0.001,
			"setup: the two actors must be at the same position")
		var before := player.health.current
		enemy.act()
		for _i in 60:
			enemy._process(1.0 / 60.0)
		_check(before - player.health.current == enemy.contact_damage,
			"a fully overlapped enemy must still deal %d, dealt %d"
			% [enemy.contact_damage, before - player.health.current])
		_despawn(player)
		_despawn(enemy); _end())

func _test_block_absorbs_an_enemy_swing() -> void:
	_case("Block: soaks an enemy swing end to end", func() -> void:
		var player := _spawn(PLAYER_SCENE)
		var enemy := _spawn(ENEMY_SCENE)
		enemy.global_position = player.global_position
		enemy._resolve_target()
		player.gain_block(enemy.contact_damage + 10)
		var before := player.health.current
		enemy.act()
		for _i in 60:
			enemy._process(1.0 / 60.0)
		_check(player.health.current == before,
			"a fully blocked swing must not touch health, went %d -> %d"
			% [before, player.health.current])
		_check(player.block.current == 10,
			"block should have dropped by exactly %d, got %d"
			% [enemy.contact_damage, player.block.current])
		_despawn(player)
		_despawn(enemy); _end())

# --- Scene isolation -------------------------------------------------------

func _test_player_scene_isolated() -> void:
	_case("Scene: player runs standalone (F6)", func() -> void:
		var player := PLAYER_SCENE.instantiate() as Player
		_check(player != null, "player.tscn root is not a Player")
		if player == null:
			return
		add_child(player)
		player._physics_process(1.0 / 60.0)
		_check(player.health != null,
			"player.tscn is missing the required $HealthComponent child")
		_check(player.status != null,
			"player.tscn is missing $StatusComponent, so buffs would silently "
			+ "do nothing")
		_despawn(player); _end())

func _test_enemy_scene_isolated() -> void:
	_case("Scene: enemy runs standalone (F6)", func() -> void:
		var enemy := ENEMY_SCENE.instantiate() as Enemy
		_check(enemy != null, "enemy.tscn root is not an Enemy")
		if enemy == null:
			return
		add_child(enemy)
		enemy._physics_process(1.0 / 60.0)
		_check(enemy.health != null,
			"enemy.tscn is missing the required $HealthComponent child")
		_check(enemy.status != null,
			"enemy.tscn is missing $StatusComponent, so debuffs would silently "
			+ "do nothing")
		_despawn(enemy); _end())

func _test_main_scene_wiring() -> void:
	_case("Scene: main.gd node paths match main.tscn", func() -> void:
		var main := MAIN_SCENE.instantiate()
		add_child(main)
		var expected: Array[String] = ["Player", "Enemies", "HUD/Banner",
			"HUD/HandLabel", "HUD/ResourceLabel"]
		for path in expected:
			_check(main.get_node_or_null(NodePath(path)) != null,
				"main.gd expects node '%s' but main.tscn does not provide it" % path)
		_despawn(main); _end())

func _test_signal_contract_declared() -> void:
	_case("Signal: EventBus exposes the cross-scene contract", func() -> void:
		for signal_name: String in ["player_died", "enemy_died", "player_damaged"]:
			_check(EventBus.has_signal(signal_name),
				"EventBus is missing signal '%s'" % signal_name); _end())

# --- Health bar ------------------------------------------------------------

func _test_health_bar_tracks_actor() -> void:
	_case("HealthBar: tracks an injected actor", func() -> void:
		var player := _spawn(PLAYER_SCENE)
		var bar := HealthBar.new()
		add_child(bar)
		bar.track(player)
		_check(is_equal_approx(bar.current_ratio(), 1.0),
			"a full-health actor should read 1.0, got %f" % bar.current_ratio())
		_despawn(bar)
		_despawn(player); _end())

func _test_health_bar_hides_at_full_health() -> void:
	_case("HealthBar: hidden while at full health", func() -> void:
		var player := _spawn(PLAYER_SCENE)
		var bar := HealthBar.new()
		add_child(bar)
		bar.track(player)
		_check(not bar.visible,
			"bar should start hidden on a full-health actor")
		player.take_damage(10)
		_check(bar.visible, "bar should appear once the actor takes damage")
		_despawn(bar)
		_despawn(player); _end())

func _test_health_bar_follows_damage() -> void:
	_case("HealthBar: ratio tracks damage without polling", func() -> void:
		var player := _spawn(PLAYER_SCENE)
		var bar := HealthBar.new()
		add_child(bar)
		bar.track(player)
		player.take_damage(50)
		_check(is_equal_approx(bar.current_ratio(), 0.5),
			"after 50 of 100 damage the ratio should be 0.5, got %f"
			% bar.current_ratio())
		player.take_damage(50)
		_check(is_equal_approx(bar.current_ratio(), 0.0),
			"a dead actor should read 0.0, got %f" % bar.current_ratio())
		_despawn(bar)
		_despawn(player); _end())

func _test_actor_spawns_its_own_health_bar() -> void:
	_case("Actor: assembles its health bar from the exported scene", func() -> void:
		var player := _spawn(PLAYER_SCENE)
		var bars := 0
		for child in player.get_children():
			if child is HealthBar:
				bars += 1
		_check(bars == 1,
			"expected exactly 1 auto-assembled HealthBar, found %d" % bars)
		var enemy := _spawn(ENEMY_SCENE)
		var enemy_bars := 0
		for child in enemy.get_children():
			if child is HealthBar:
				enemy_bars += 1
		_check(enemy_bars == 1,
			"enemy should also assemble 1 HealthBar, found %d" % enemy_bars)
		_despawn(player)
		_despawn(enemy); _end())

# --- Presentation ----------------------------------------------------------

func _test_swing_arc_fades_with_swing_window() -> void:
	_case("Player: swing arc is visible only while swinging", func() -> void:
		var player := _spawn(PLAYER_SCENE)
		var arc := player.get_node_or_null("Body/SwingSprite") as Sprite2D
		_check(arc != null, "player.tscn is missing Body/SwingSprite")
		if arc == null:
			_despawn(player)
			return
		_check(not arc.visible, "swing arc should start hidden")
		player._try_attack()
		player._update_attack_area()
		_check(arc.visible, "swing arc must appear during the swing window")
		player._swing_left = 0.0
		player._update_attack_area()
		_check(not arc.visible, "swing arc must hide once the window closes")
		_despawn(player); _end())

func _test_sprite_textures_assigned() -> void:
	_case("Scene: body sprites have textures assigned", func() -> void:
		var player_body := PLAYER_SCENE.instantiate() as Node2D
		var enemy_body := ENEMY_SCENE.instantiate() as Node2D
		add_child(player_body)
		add_child(enemy_body)
		var p_sprite := player_body.get_node_or_null("Body") as Sprite2D
		var e_sprite := enemy_body.get_node_or_null("Body") as Sprite2D
		_check(p_sprite != null and p_sprite.texture != null, "player Body has no texture")
		_check(e_sprite != null and e_sprite.texture != null, "enemy Body has no texture")
		_despawn(player_body)
		_despawn(enemy_body); _end())

# --- Card data -------------------------------------------------------------

func _test_card_resource_parses() -> void:
	_case("CardData: .tres loads with every field intact", func() -> void:
		_check(STRIKE_CARD != null, "strike.tres failed to load")
		if STRIKE_CARD == null:
			return
		_check(STRIKE_CARD.id == "strike", "id should be 'strike', got '%s'" % STRIKE_CARD.id)
		_check(STRIKE_CARD.title == "打击", "title should be '打击', got '%s'" % STRIKE_CARD.title)
		_check(STRIKE_CARD.cost == 1, "cost should be 1, got %d" % STRIKE_CARD.cost)
		# Enum ordinals are the fragile part of a hand-authored .tres: a wrong
		# value parses fine and silently means the wrong thing.
		_check(STRIKE_CARD.card_type == CardData.CardType.ATTACK,
			"strike should be ATTACK, got %d" % STRIKE_CARD.card_type)
		_check(STRIKE_CARD.rarity == CardData.Rarity.BASIC,
			"strike should be BASIC, got %d" % STRIKE_CARD.rarity)
		_check(STRIKE_CARD.discipline == CardData.Discipline.DIGGER,
			"strike should be DIGGER, got %d" % STRIKE_CARD.discipline)
		_check(STRIKE_CARD.effects.size() == 1,
			"strike should have exactly 1 step, got %d" % STRIKE_CARD.effects.size())
		var step := STRIKE_CARD.effects[0]
		_check(step.kind == CardEffectStep.EffectKind.DAMAGE,
			"strike's step should be DAMAGE, got %d" % step.kind)
		_check(step.target == CardEffectStep.TargetMode.ENEMY,
			"strike should target ENEMY, got %d" % step.target)
		_check(step.value == 6, "strike deals 6, got %d" % step.value); _end())

func _test_card_upgrade_numbers() -> void:
	_case("CardData: upgrade swaps to the upgraded numbers", func() -> void:
		if STRIKE_CARD == null:
			return
		var step := STRIKE_CARD.effects[0]
		_check(step.value_at(false) == 6, "base damage should be 6, got %d" % step.value_at(false))
		_check(step.value_at(true) == 9, "upgraded damage should be 9, got %d" % step.value_at(true))
		_check(STRIKE_CARD.can_upgrade(),
			"strike has distinct upgraded numbers and must report can_upgrade")
		var defend_step := DEFEND_CARD.effects[0]
		_check(DEFEND_CARD.can_upgrade(), "defend upgrades its block, so it must report can_upgrade")
		_check(defend_step.value_at(false) == 5,
			"defend base block should be 5, got %d" % defend_step.value_at(false))
		_check(defend_step.value_at(true) == 8,
			"defend upgraded block should be 8, got %d" % defend_step.value_at(true))
		# The card-level flag is what resolution reads, so it must be the switch
		# that changes which number comes out. The card is duplicated first: a
		# preloaded resource is shared by every test in this file, so flipping
		# the flag on it would silently upgrade 打击 for the rest of the run.
		var upgraded_strike := STRIKE_CARD.duplicate() as CardData
		upgraded_strike.upgraded = true
		var upgraded_step := upgraded_strike.effects[0]
		_check(upgraded_step.value_at(upgraded_strike.upgraded) == 9,
			"setting the card flag must feed the upgraded number through")
		_check(STRIKE_CARD.upgraded == false,
			"the shared 打击 resource must be left un-upgraded")
		# 重装机甲 gains block only when upgraded: base 0, upgraded 5.
		var heavy := CardLibrary.new()
		heavy.ensure_loaded()
		var rig := heavy.get_card("heavy_rig")
		_check(rig != null, "heavy_rig missing from the pool")
		if rig != null:
			_check(rig.can_upgrade(), "heavy_rig has an upgrade-only block")
			var block_step := rig.effects[1]
			_check(block_step.value_at(false) == 0,
				"heavy_rig base block should be 0, got %d" % block_step.value_at(false))
			_check(block_step.value_at(true) == 5,
				"heavy_rig upgraded block should be 5, got %d" % block_step.value_at(true)); _end())

func _test_card_validation_rejects_bad_data() -> void:
	_case("CardData: validation catches malformed cards", func() -> void:
		var broken := CardData.new()
		_check(not broken.validate("test").is_empty(),
			"a default-constructed card must fail validation")
		broken.id = "broken"
		broken.title = "无名"
		# Still no steps and no curse penalty: a card that does nothing at all.
		_check(not broken.validate("test").is_empty(),
			"a card with neither steps nor a curse penalty must fail")
		# A step whose kind cannot carry a number it was given.
		var step := CardEffectStep.new()
		step.kind = CardEffectStep.EffectKind.DAMAGE
		step.value = 0
		broken.effects = [step]
		_check(not broken.validate("test").is_empty(),
			"a DAMAGE step with value 0 must be rejected")
		step.value = 5
		_check(broken.validate("test").is_empty(),
			"a complete DAMAGE card must pass validation")
		broken.title = ""
		_check(not broken.validate("test").is_empty(),
			"a card with no title must be rejected")
		# A condition that claims to replace but has no replacement value would
		# silently resolve to the base number — a condition that looks real and
		# does nothing.
		broken.title = "条件缺失"
		var conditional := CardEffectStep.new()
		conditional.kind = CardEffectStep.EffectKind.DAMAGE
		conditional.value = 9
		conditional.condition = CardEffectStep.Condition.IF_BLOCKED
		conditional.condition_replaces = true
		broken.effects = [conditional]
		_check(not broken.validate("test").is_empty(),
			"condition_replaces with no condition_value must be rejected"); _end())

func _test_card_playability_filter() -> void:
	_case("CardData: playability follows the declared steps", func() -> void:
		_check(STRIKE_CARD.is_playable(), "strike must be playable")
		_check(DEFEND_CARD.is_playable(), "defend must be playable")
		_check(not DEFEND_CARD.needs_target(),
			"a self-only BLOCK card must not need an enemy")
		_check(STRIKE_CARD.needs_target(), "a DAMAGE card must need a target")
		# 震波 hits all enemies AND grants block, so it needs a target even
		# though one of its steps is self-targeted.
		_check(SHOCKWAVE_CARD.needs_target(),
			"an AOE card must report needing a target")
		var empty := CardData.new()
		_check(not empty.is_playable(),
			"a card with no steps must not be playable"); _end())

func _test_curse_card_is_held_but_unplayable() -> void:
	_case("Curse: 疫尘入肺 can be held but never played", func() -> void:
		var library := CardLibrary.new()
		library.ensure_loaded()
		var curse := library.get_card("cursed_lung")
		_check(curse != null, "the pool must contain cursed_lung")
		if curse == null:
			return
		_check(curse.rarity == CardData.Rarity.CURSE,
			"cursed_lung must be CURSE, got %d" % curse.rarity)
		_check(curse.curse_hp_loss == 2,
			"cursed_lung must cost 2 health, got %d" % curse.curse_hp_loss)
		_check(curse.effects.is_empty(),
			"a curse must have no effects; it is unplayable by design")
		# It is "playable" in the resolvable sense only because it has a real
		# effect (the health loss), yet resolution must refuse it.
		var player := _spawn(PLAYER_SCENE)
		player.give_card(curse)
		var effect := CardEffect.new()
		_check(not effect.resolve(curse, _make_context(curse, player, null)),
			"a curse card must be refused by resolution")
		_check(player.play_held_card() == false,
			"playing a curse must fail")
		_check(player.held_card() == curse,
			"a curse must stay in hand, not be consumed")
		_despawn(player); _end())

# --- Card library ----------------------------------------------------------

func _test_card_library_loads_pool() -> void:
	_case("CardLibrary: loads the whole Web pool", func() -> void:
		var library := CardLibrary.new()
		library.ensure_loaded()
		_check(library.load_state() == CardLibrary.LoadState.LOADED,
			"library should reach the LOADED state")
		_check(library.rejected_reasons().is_empty(),
			"the authored pool must load cleanly, got: %s" % [library.rejected_reasons()])
		# The count is the load-bearing assertion: every card loading is not the
		# same as every card existing, and a missing file is silent otherwise.
		_check(library.size() == EXPECTED_POOL_SIZE,
			"expected %d cards, loaded %d — check tools/gen_cards.py"
			% [EXPECTED_POOL_SIZE, library.size()])
		_check(library.has_card("strike"), "library is missing 'strike'")
		_check(library.has_card("bottom_hammer"), "library is missing 'bottom_hammer'")
		_check(library.get_card("nope") == null,
			"an unknown id must return null, not a broken card"); _end())

func _test_card_library_filters() -> void:
	_case("CardLibrary: filters by playability, class and depth", func() -> void:
		var library := CardLibrary.new()
		library.ensure_loaded()
		var playable := library.playable_cards()
		for card in playable:
			_check(card.is_playable(),
				"playable_cards() returned an unplayable card: %s" % card.id)
		# A curse is resolvable but must never be offered as a button, so the
		# playable set is strictly smaller than the pool here.
		_check(playable.size() == library.size() - 1,
			"expected the pool minus its single curse, got %d of %d"
			% [playable.size(), library.size()])
		var shallow := library.cards_unlocked_at(0)
		for card in shallow:
			_check(card.unlock_depth <= 0,
				"cards_unlocked_at(0) leaked %s (depth %d)" % [card.id, card.unlock_depth])
		_check(library.cards_unlocked_at(99).size() == library.size(),
			"a deep unlock must return the whole pool")
		# Depth gating must actually gate: DL10 cards are not available at DL0.
		var deep_card := library.get_card("bottom_hammer")
		_check(deep_card != null and deep_card.unlock_depth == 10,
			"bottom_hammer should be a DL10 card")
		_check(not shallow.has(deep_card),
			"a DL10 card must not appear in the DL0 pool"); _end())

func _test_card_library_rejects_duplicates() -> void:
	_case("CardLibrary: survives a reload without accumulating entries", func() -> void:
		var library := CardLibrary.new()
		_check(library.load_state() == CardLibrary.LoadState.NOT_LOADED,
			"a fresh library must start NOT_LOADED")
		library.ensure_loaded()
		_check(library.load_state() == CardLibrary.LoadState.LOADED,
			"ensure_loaded must always reach LOADED")
		var first_size := library.size()
		library.load_cards()
		_check(library.size() == first_size,
			"reloading changed the pool size from %d to %d" % [first_size, library.size()]); _end())

func _test_card_library_starting_deck_is_deterministic() -> void:
	_case("CardLibrary: starting deck is deterministic and basic-only", func() -> void:
		var a := CardLibrary.new()
		var b := CardLibrary.new()
		a.ensure_loaded()
		b.ensure_loaded()
		var deck_a := a.starting_deck(10)
		var deck_b := b.starting_deck(10)
		_check(deck_a.size() == deck_b.size(),
			"two pools produced different deck sizes: %d vs %d"
			% [deck_a.size(), deck_b.size()])
		for i in mini(deck_a.size(), deck_b.size()):
			_check(deck_a[i].id == deck_b[i].id,
				"deck slot %d differs between loads: %s vs %s"
				% [i, deck_a[i].id, deck_b[i].id])
		for card in deck_a:
			_check(card.rarity == CardData.Rarity.BASIC,
				"starting deck must contain BASIC cards only, found %s" % card.id)
		_check(CardLibrary.new().starting_deck(0).is_empty(),
			"a deck size of 0 must produce an empty deck")
		_check(a.starting_deck(9999).size() <= a.size(),
			"an oversized request must clamp to the available cards"); _end())

# --- Card resolution -------------------------------------------------------

func _test_card_effect_deals_damage() -> void:
	_case("CardEffect: an attack card damages the target", func() -> void:
		if STRIKE_CARD == null:
			return
		var player := _spawn(PLAYER_SCENE)
		var enemy := _spawn(ENEMY_SCENE)
		var before := enemy.health.current
		var context := _make_context(STRIKE_CARD, player, enemy)
		var effect := CardEffect.new()
		_check(effect.resolve(STRIKE_CARD, context), "strike must resolve successfully")
		_check(enemy.health.current == before - 6,
			"target health should drop by 6, went %d -> %d"
			% [before, enemy.health.current])
		_despawn(player)
		_despawn(enemy); _end())

func _test_card_effect_refuses_unimplemented() -> void:
	_case("CardEffect: refuses cards it cannot resolve", func() -> void:
		var player := _spawn(PLAYER_SCENE)
		var enemy := _spawn(ENEMY_SCENE)
		var effect := CardEffect.new()
		var unset := CardData.new()
		unset.id = "unset_probe"
		unset.title = "未实现"
		_check(not effect.resolve(unset, _make_context(unset, player, enemy)),
			"a card with no steps must be refused")
		_check(not effect.resolve(STRIKE_CARD, _make_context(STRIKE_CARD, player, null)),
			"a damage card with no target must be refused")
		_check(not effect.resolve(null, _make_context(STRIKE_CARD, player, enemy)),
			"resolving a null card must be refused")
		_check(not effect.resolve(STRIKE_CARD, _make_context(STRIKE_CARD, null, enemy)),
			"resolving without a source must be refused")
		_despawn(player)
		_despawn(enemy); _end())

func _test_card_effect_never_heals_target() -> void:
	_case("CardEffect: cannot push a target below zero health", func() -> void:
		if STRIKE_CARD == null:
			return
		var player := _spawn(PLAYER_SCENE)
		var enemy := _spawn(ENEMY_SCENE)
		enemy.health.current = 2
		var context := _make_context(STRIKE_CARD, player, enemy)
		var effect := CardEffect.new()
		effect.resolve(STRIKE_CARD, context)
		_check(enemy.health.current == 0,
			"target health should be 0, got %d" % enemy.health.current)
		_despawn(player)
		_despawn(enemy); _end())

func _test_damage_card_reports_block_split() -> void:
	_case("CardEffect: block absorbs before health", func() -> void:
		var player := _spawn(PLAYER_SCENE)
		var enemy := _spawn(ENEMY_SCENE)
		enemy.gain_block(4)
		var before := enemy.health.current
		var effect := CardEffect.new()
		effect.resolve(STRIKE_CARD, _make_context(STRIKE_CARD, player, enemy))
		_check(before - enemy.health.current == 2,
			"strike deals 6; 4 is eaten by block so 2 must reach health, got %d"
			% (before - enemy.health.current))
		_despawn(player)
		_despawn(enemy); _end())

func _test_block_card_resolves_without_target() -> void:
	_case("CardEffect: a BLOCK card needs no adjacent enemy", func() -> void:
		var player := _spawn(PLAYER_SCENE)
		var context := _make_context(DEFEND_CARD, player, null)
		var effect := CardEffect.new()
		_check(effect.resolve(DEFEND_CARD, context),
			"a BLOCK card must resolve with no target in reach")
		_check(player.block.current == 5,
			"the player's block should be 5, got %d" % player.block.current)
		_despawn(player); _end())

func _test_conditional_replaces_instead_of_adds() -> void:
	_case("CardEffect: 撬棍 swaps 9 for 13 while blocking", func() -> void:
		# This is the distinction the condition_replaces flag exists for. An
		# additive implementation would deal 22 here, which is 2.4x the card.
		var player := _spawn(PLAYER_SCENE)
		var enemy := _spawn(ENEMY_SCENE)
		enemy.global_position = player.global_position
		var effect := CardEffect.new()

		var before := enemy.health.current
		effect.resolve(CROWBAR_CARD, _make_context(CROWBAR_CARD, player, enemy))
		_check(before - enemy.health.current == 9,
			"unblocked 撬棍 must deal 9, dealt %d"
			% (before - enemy.health.current))

		player.gain_block(5)
		before = enemy.health.current
		effect.resolve(CROWBAR_CARD, _make_context(CROWBAR_CARD, player, enemy))
		_check(before - enemy.health.current == 13,
			"blocked 撬棍 must deal 13 (not 22), dealt %d"
			% (before - enemy.health.current))
		_despawn(player)
		_despawn(enemy); _end())

func _test_block_ratio_scales_damage() -> void:
	_case("CardEffect: 碎石 converts block into damage at 50%", func() -> void:
		var library := CardLibrary.new()
		library.ensure_loaded()
		var shrapnel := library.get_card("shrapnel")
		_check(shrapnel != null, "shrapnel missing from the pool")
		if shrapnel == null:
			return
		var player := _spawn(PLAYER_SCENE)
		var enemy := _spawn(ENEMY_SCENE)
		enemy.global_position = player.global_position
		player.gain_block(20)
		var before := enemy.health.current
		var effect := CardEffect.new()
		effect.resolve(shrapnel, _make_context(shrapnel, player, enemy))
		# floor(20 * 0.5) == 10, and block is READ, not consumed.
		_check(before - enemy.health.current == 10,
			"碎石 must deal 10 off 20 block, dealt %d"
			% (before - enemy.health.current))
		_check(player.block.current == 20,
			"碎石 reads block and must not consume it, block is %d"
			% player.block.current)
		_despawn(player)
		_despawn(enemy); _end())

func _test_consume_block_converts_to_damage() -> void:
	_case("CardEffect: 液压冲击 spends block at 1.5x", func() -> void:
		var player := _spawn(PLAYER_SCENE)
		var enemy := _spawn(ENEMY_SCENE)
		enemy.global_position = player.global_position
		player.gain_block(10)
		var before := enemy.health.current
		var effect := CardEffect.new()
		effect.resolve(HYDRAULIC_CARD, _make_context(HYDRAULIC_CARD, player, enemy))
		# floor(10 * 1.5) == 15, and the block is GONE.
		_check(before - enemy.health.current == 15,
			"液压冲击 must deal 15 off 10 block, dealt %d"
			% (before - enemy.health.current))
		_check(player.block.current == 0,
			"液压冲击 must consume the block, %d left" % player.block.current)
		_despawn(player)
		_despawn(enemy); _end())

func _test_multi_hit_repeats() -> void:
	_case("CardEffect: 连环凿 hits three times", func() -> void:
		var player := _spawn(PLAYER_SCENE)
		var enemy := _spawn(ENEMY_SCENE)
		enemy.global_position = player.global_position
		enemy.health.max_health = 999
		enemy.health.current = 999
		var before := enemy.health.current
		var effect := CardEffect.new()
		effect.resolve(CHAIN_CHISEL_CARD, _make_context(CHAIN_CHISEL_CARD, player, enemy))
		_check(before - enemy.health.current == 15,
			"3 hits of 5 must deal 15, dealt %d" % (before - enemy.health.current))
		_despawn(player)
		_despawn(enemy); _end())

func _test_multi_hit_stops_when_the_target_dies() -> void:
	_case("CardEffect: a multi-hit stops once the target is down", func() -> void:
		# 3 hits of 5 into a 6 HP enemy: the third must not be wasted, and
		# overkill must clamp health at 0 rather than going negative.
		var player := _spawn(PLAYER_SCENE)
		var enemy := _spawn(ENEMY_SCENE)
		enemy.global_position = player.global_position
		enemy.health.current = 6
		var effect := CardEffect.new()
		effect.resolve(CHAIN_CHISEL_CARD, _make_context(CHAIN_CHISEL_CARD, player, enemy))
		_check(enemy.health.current == 0,
			"health must clamp to 0, got %d" % enemy.health.current)
		_despawn(player)
		_despawn(enemy); _end())

func _test_aoe_hits_every_enemy() -> void:
	_case("CardEffect: 震波 hits all enemies and grants block", func() -> void:
		var player := _spawn(PLAYER_SCENE)
		var first := _spawn(ENEMY_SCENE)
		var second := _spawn(ENEMY_SCENE)
		first.global_position = player.global_position
		second.global_position = player.global_position + Vector2(30.0, 0.0)
		var first_before := first.health.current
		var second_before := second.health.current
		var effect := CardEffect.new()
		var context := CardEffect.PlayContext.new()
		context.source = player
		context.target = first
		context.enemies = [first, second]
		_check(effect.resolve(SHOCKWAVE_CARD, context), "震波 must resolve")
		_check(first_before - first.health.current == 5,
			"the first enemy must lose 5, lost %d" % (first_before - first.health.current))
		_check(second_before - second.health.current == 5,
			"the SECOND enemy must also lose 5, lost %d — AOE is not hitting all targets"
			% (second_before - second.health.current))
		_check(player.block.current == 4,
			"震波 also grants 4 block, got %d" % player.block.current)
		_despawn(player)
		_despawn(first)
		_despawn(second); _end())

func _test_depth_scaling() -> void:
	_case("CardEffect: 深井作业 scales with depth", func() -> void:
		var player := _spawn(PLAYER_SCENE)
		var effect := CardEffect.new()
		var context := _make_context(DEEP_WORK_CARD, player, null)
		context.depth = 4
		effect.resolve(DEEP_WORK_CARD, context)
		# depth 4 x coef 2 == 8
		_check(player.block.current == 8,
			"at depth 4 深井作业 must grant 8 block, got %d" % player.block.current)
		_despawn(player); _end())

func _test_status_applied_to_enemy() -> void:
	_case("CardEffect: a status step reaches the enemy", func() -> void:
		var player := _spawn(PLAYER_SCENE)
		var enemy := _spawn(ENEMY_SCENE)
		enemy.global_position = player.global_position
		var library := CardLibrary.new()
		library.ensure_loaded()
		var shove := library.get_card("shove")
		_check(shove != null, "shove missing from the pool")
		if shove == null:
			return
		var effect := CardEffect.new()
		effect.resolve(shove, _make_context(shove, player, enemy))
		_check(enemy.status_stacks(StatusComponent.Kind.WEAK) == 1,
			"shove must apply 1 虚弱, got %d"
			% enemy.status_stacks(StatusComponent.Kind.WEAK))
		_despawn(player)
		_despawn(enemy); _end())

func _test_strength_scales_damage() -> void:
	_case("CardEffect: 力量 adds flat damage to every hit", func() -> void:
		var player := _spawn(PLAYER_SCENE)
		player.add_status(StatusComponent.Kind.STRENGTH, 3)
		var enemy := _spawn(ENEMY_SCENE)
		enemy.global_position = player.global_position
		var before := enemy.health.current
		var effect := CardEffect.new()
		effect.resolve(STRIKE_CARD, _make_context(STRIKE_CARD, player, enemy))
		_check(before - enemy.health.current == 9,
			"strike 6 + 力量 3 must deal 9, dealt %d"
			% (before - enemy.health.current))
		_despawn(player)
		_despawn(enemy); _end())

func _test_dexterity_scales_block() -> void:
	_case("CardEffect: 敏捷 adds flat block to every block gain", func() -> void:
		var player := _spawn(PLAYER_SCENE)
		player.add_status(StatusComponent.Kind.DEXTERITY, 2)
		var effect := CardEffect.new()
		effect.resolve(DEFEND_CARD, _make_context(DEFEND_CARD, player, null))
		_check(player.block.current == 7,
			"defend 5 + 敏捷 2 must grant 7, got %d" % player.block.current)
		_despawn(player); _end())

func _test_raw_damage_ignores_block() -> void:
	_case("CardEffect: 破岩 goes straight through block", func() -> void:
		var player := _spawn(PLAYER_SCENE)
		var enemy := _spawn(ENEMY_SCENE)
		enemy.global_position = player.global_position
		# The enemy's own max_block is 12, so asking for 30 silently clamps.
		# Assert against what it actually gained, or this test would "prove" the
		# block was untouched by comparing against a number never reached.
		enemy.gain_block(30)
		var block_before := enemy.block.current
		var before := enemy.health.current
		var effect := CardEffect.new()
		effect.resolve(ROCKBREAK_CARD, _make_context(ROCKBREAK_CARD, player, enemy))
		_check(before - enemy.health.current == 16,
			"破岩 must deal a full 16 through %d block, dealt %d"
			% [block_before, before - enemy.health.current])
		_check(enemy.block.current == block_before,
			"破岩 must not touch block, %d left of %d"
			% [enemy.block.current, block_before])
		_despawn(player)
		_despawn(enemy); _end())

func _test_kill_triggers_a_bonus() -> void:
	_case("CardEffect: 撬棒连击 draws only on a kill", func() -> void:
		var player := _spawn_player()
		var enemy := _spawn_enemy()
		enemy.global_position = player.global_position
		# First, a surviving target must NOT draw.
		enemy.health.max_health = 200
		enemy.health.current = 200
		# The deck must still have cards LEFT after the opening draw, otherwise
		# the kill's bonus draw has an empty pile to pull from and silently
		# draws 0 — the assertion would then be testing the deck, not the card.
		player.set_deck(_deck([STRIKE_CARD, DEFEND_CARD, CROWBAR_CARD,
			STRIKE_CARD, DEFEND_CARD, CROWBAR_CARD]))
		# set_deck fills the draw pile; it does not deal. Opening hand must be
		# drawn explicitly, otherwise "before" is 0 and the first resolve's
		# conditional draw is indistinguishable from the opening draw.
		player.draw_cards(3)
		var before_hand := player.hand().size()
		var effect := CardEffect.new()
		effect.resolve(PRY_COMBO_CARD, _make_context(PRY_COMBO_CARD, player, enemy))
		_check(player.hand().size() == before_hand,
			"a surviving kill must not draw; hand went %d -> %d"
			% [before_hand, player.hand().size()])
		# Now a lethal one.
		enemy.health.current = 3
		var before_kill := player.hand().size()
		effect.resolve(PRY_COMBO_CARD, _make_context(PRY_COMBO_CARD, player, enemy))
		_check(player.hand().size() == before_kill + 2,
			"a kill must draw 2, hand went %d -> %d"
			% [before_kill, player.hand().size()])
		_despawn(player)
		_despawn(enemy); _end())

## Locks the gate rule itself, not one card.
##
## Every conditional step in the pool was audited against its Web text, and they
## split cleanly into two shapes that a single "does it have a base value" test
## cannot tell apart — 安全帽's bonus and 撬棒连击's bonus are BOTH authored as
## `value` on their own step, so `value` carries no "unconditional half" flag.
## `condition_replaces` is the only field that does. This asserts both halves of
## both shapes, so a future refactor that "simplifies" the gate fails loudly.
func _test_conditional_step_gate_shapes() -> void:
	_case("CardEffect: condition_replaces decides REPLACE vs ADD gating", func() -> void:
		var player := _spawn_player()
		var enemy := _spawn_enemy()
		enemy.global_position = player.global_position

		# --- REPLACE shape: 撬棍. Unconditional step, conditional NUMBER.
		# The number is covered by the test above; here we assert the flag, since
		# the flag is what the gate reads and the number is what it protects.
		var crowbar_step: CardEffectStep = (CROWBAR_CARD as CardData).effects[0]
		_check(crowbar_step.condition_replaces,
			"撬棍's damage step must be REPLACE — its 9 is unconditional")
		_check(crowbar_step.condition == CardEffectStep.Condition.IF_BLOCKED,
			"撬棍 must be gated on block, got %d" % crowbar_step.condition)

		# --- ADD shape: 安全帽. No attack played this turn -> no bonus block.
		var hardhat_step: CardEffectStep = (HARDHAT_CARD as CardData).effects[1]
		_check(not hardhat_step.condition_replaces,
			"安全帽's bonus step must be ADD, not REPLACE")
		var plain := _spawn_player()
		var hp_effect := CardEffect.new()
		hp_effect.resolve(HARDHAT_CARD, _make_context(HARDHAT_CARD, plain, enemy))
		# base 6 only; the +3 needs an attack played this turn.
		_check(plain.block.current == 6,
			"安全帽 without an attack played must grant 6, got %d"
			% plain.block.current)
		_despawn(plain)

		# Same card, condition now satisfied: 6 + 3.
		var earned := _spawn_player()
		var atk_effect := CardEffect.new()
		var atk_ctx := _make_context(HARDHAT_CARD, earned, enemy)
		atk_ctx.attacks_played = 1
		atk_effect.resolve(HARDHAT_CARD, atk_ctx)
		_check(earned.block.current == 9,
			"安全帽 after an attack must grant 9 (6 + 3), got %d"
			% earned.block.current)
		_despawn(earned)

		# --- ADD shape on a DRAW step: the case the old gate got wrong.
		# 撬棒连击 authors its 2 as `value` on a DRAW step, indistinguishable from
		# a base amount, so a "value > 0 runs" gate let it fire on live targets.
		var pry_step: CardEffectStep = (PRY_COMBO_CARD as CardData).effects[1]
		_check(not pry_step.condition_replaces,
			"撬棒连击's draw step must be ADD — 'if you kill' has no base draw")
		_check(pry_step.kind == CardEffectStep.EffectKind.DRAW,
			"撬棒连击's second step must be a DRAW, got %d" % pry_step.kind)

		# --- ADD shape on an AOE kill: 连锁爆破 "if you knock down any enemy".
		var chain_step: CardEffectStep = (CHAIN_DEMOLITION_CARD as CardData).effects[1]
		_check(not chain_step.condition_replaces,
			"连锁爆破's draw step must be ADD — 'if any dies' has no base draw")
		_check(chain_step.condition == CardEffectStep.Condition.IF_ANY_DIED,
			"连锁爆破 must be gated on any-died, got %d" % chain_step.condition)

		# --- No card may be left undecidable: a REPLACE step with a zero
		# conditional silently resolves to its base, which no card text promises.
		var library := CardLibrary.new()
		library.ensure_loaded()
		var ambiguous: Array[String] = []
		for card in library.all_cards():
			for step in card.effects:
				if step.condition == CardEffectStep.Condition.ALWAYS:
					continue
				if step.condition_replaces \
						and step.condition_value_at(card.upgraded) <= 0:
					ambiguous.append("%s/%d" % [card.id, step.kind])
		_check(ambiguous.is_empty(),
			"REPLACE steps with no conditional number fall back to base silently: %s"
			% str(ambiguous))

		_despawn(player)
		_despawn(enemy); _end())

func _test_status_step_runs_before_block_step() -> void:
	_case("CardEffect: 钢板护体 grants 敏捷 before its own block", func() -> void:
		# Order is load-bearing: 敏捷 must be live when the block step runs, or
		# the card's own block misses the bonus its text promises.
		var player := _spawn(PLAYER_SCENE)
		var effect := CardEffect.new()
		effect.resolve(PLATE_GUARD_CARD, _make_context(PLATE_GUARD_CARD, player, null))
		# base block 12 + 敏捷 1 == 13
		_check(player.block.current == 13,
			"钢板护体 must grant 13 (12 + its own 敏捷 1), got %d"
			% player.block.current)
		_despawn(player); _end())

func _test_every_card_resolves() -> void:
	_case("CardLibrary: every non-curse card resolves against a real actor", func() -> void:
		var library := CardLibrary.new()
		library.ensure_loaded()
		var player := _spawn(PLAYER_SCENE)
		var enemy := _spawn(ENEMY_SCENE)
		enemy.global_position = player.global_position
		player.depth = 5
		var unresolved: Array[String] = []
		var checked := 0
		for card in library.all_cards():
			if card.rarity == CardData.Rarity.CURSE:
				continue
			var effect := CardEffect.new()
			var context := CardEffect.PlayContext.new()
			context.source = player
			context.target = enemy
			context.enemies = [enemy]
			context.depth = 5
			# Give the source something to spend, so consume-style cards are
			# exercised with real numbers rather than trivially resolving to 0.
			player.gain_block(20)
			player.status.add(StatusComponent.Kind.STRENGTH, 2)
			if not effect.resolve(card, context):
				unresolved.append(card.id)
			checked += 1
			_despawn_safely(enemy)
			enemy = _spawn(ENEMY_SCENE)
			enemy.global_position = player.global_position
		_check(checked == EXPECTED_POOL_SIZE - 1,
			"expected to exercise %d cards, exercised %d"
			% [EXPECTED_POOL_SIZE - 1, checked])
		_check(unresolved.is_empty(),
			"these cards failed to resolve: %s" % [unresolved])
		_despawn(player)
		_despawn(enemy); _end())

## Frees an enemy that may already have died (and therefore queue_free'd itself).
func _despawn_safely(node: Node) -> void:
	if is_instance_valid(node):
		remove_child(node)
		node.free()

# --- Deck ------------------------------------------------------------------

func _test_draw_pile_and_reshuffle() -> void:
	_case("Deck: draws, then reshuffles the discard pile", func() -> void:
		var player := _spawn(PLAYER_SCENE)
		player.set_deck(_deck([STRIKE_CARD, DEFEND_CARD, CROWBAR_CARD]))
		_check(player.draw_cards(2) == 2, "must draw 2 of 3")
		_check(player.draw_cards(5) == 1, "only 1 card left, must draw exactly 1")
		# Both piles are now empty; asking again must return 0, not spin.
		_check(player.draw_cards(3) == 0,
			"an empty deck must draw 0 rather than loop forever")
		_despawn(player); _end())

# --- Wiring ----------------------------------------------------------------

func _test_player_plays_card_against_enemy() -> void:
	_case("Wiring: a played card damages a real enemy and is spent", func() -> void:
		var player := _spawn(PLAYER_SCENE)
		var enemy := _spawn(ENEMY_SCENE)
		enemy.global_position = player.global_position + Vector2(40.0, 0.0)
		player.give_card(STRIKE_CARD)
		var played: Array[String] = []
		player.card_played.connect(func(card: CardData) -> void: played.append(card.id))
		var before := enemy.health.current
		_check(player.play_held_card(), "the card must be playable with an enemy in reach")
		_check(player.held_card() == null, "a spent card must leave the hand")
		_check(played.has("strike"), "card_played must announce the card spent")
		_check(enemy.health.current == before - 6,
			"the enemy must have lost exactly 6 health, went %d -> %d"
			% [before, enemy.health.current])
		_despawn(player)
		_despawn(enemy); _end())

func _test_player_keeps_card_when_out_of_reach() -> void:
	_case("Wiring: an out-of-reach damage card is not spent", func() -> void:
		var player := _spawn(PLAYER_SCENE)
		var enemy := _spawn(ENEMY_SCENE)
		enemy.global_position = player.global_position + Vector2(900.0, 0.0)
		player.give_card(STRIKE_CARD)
		_check(not player.play_held_card(), "playing with no enemy in reach must fail")
		_check(player.held_card() == STRIKE_CARD,
			"a failed play must leave the card in hand")
		_despawn(player)
		_despawn(enemy); _end())

func _test_player_keeps_unresolvable_card() -> void:
	_case("Wiring: an unresolvable card is not wasted", func() -> void:
		var player := _spawn(PLAYER_SCENE)
		var enemy := _spawn(ENEMY_SCENE)
		enemy.global_position = player.global_position + Vector2(40.0, 0.0)
		var unsupported := CardData.new()
		unsupported.id = "unsupported_probe"
		unsupported.title = "未实现"
		player.give_card(unsupported)
		_check(not player.play_held_card(), "a card with no steps must not resolve")
		_check(player.held_card() == unsupported,
			"an unresolvable card must stay in hand rather than vanish")
		_despawn(player)
		_despawn(enemy); _end())

func _test_play_counts_into_turn_tallies() -> void:
	_case("Wiring: a played card is tallied for the turn", func() -> void:
		# 井底之锤 reads attacks_played, and the Web build records the card
		# AFTER its own play resolves. Getting this wrong makes every card
		# count itself.
		var player := _spawn(PLAYER_SCENE)
		var enemy := _spawn(ENEMY_SCENE)
		enemy.global_position = player.global_position + Vector2(40.0, 0.0)
		enemy.health.current = 500
		enemy.health.max_health = 500
		player.energy.current = 3
		player.give_card(STRIKE_CARD)
		_check(player.play_held_card(), "the attack must resolve")
		_check(player.attacks_played == 1,
			"one attack played must be tallied, got %d" % player.attacks_played)
		_check(player.skills_played == 0,
			"an ATTACK card must not count as a skill, got %d" % player.skills_played)
		player.start_turn()
		_check(player.attacks_played == 0 and player.skills_played == 0,
			"a new turn must reset the tallies")
		_despawn(player)
		_despawn(enemy); _end())

func _test_curse_costs_health_at_end_of_turn() -> void:
	_case("Wiring: a curse in hand costs health when the turn ends", func() -> void:
		var library := CardLibrary.new()
		library.ensure_loaded()
		var curse := library.get_card("cursed_lung")
		if curse == null:
			return
		var player := _spawn_player()
		player.give_card(curse)
		_check(player.curse_damage_in_hand() == 2,
			"one curse in hand must owe 2 health, owes %d"
			% player.curse_damage_in_hand())
		var before := player.health.current
		var owed := player.curse_damage_in_hand()
		player.lose_health(owed)
		_check(before - player.health.current == 2,
			"the curse must cost 2 health")
		player.discard_hand()
		_check(player.curse_damage_in_hand() == 0,
			"a discarded curse must stop costing health")
		_despawn(player); _end())

func _test_main_scene_deals_a_starting_card() -> void:
	_case("Wiring: the arena deals a real starting hand", func() -> void:
		var main := MAIN_SCENE.instantiate()
		add_child(main)
		var player := main.get("player") as Player
		_check(player != null, "main.tscn must expose a player")
		if player == null:
			_despawn(main)
			return
		var hand := player.hand()
		_check(hand.size() >= 5,
			"the arena must deal a full opening hand, dealt %d" % hand.size())
		for card in hand:
			_check(card.is_playable(),
				"every dealt card must be playable, got %s" % card.id)
		_despawn(main); _end())

## Guards a HUD string that shipped a genuine misreading.
##
## The label used to read "手牌：安全帽（1 费 / 6 格挡）· x4", where the 4 is the
## HAND TOTAL printed bare right after the SELECTED card's name — so it read as
## "you hold four 安全帽". Nothing was wrong with the data; the number and the
## words belonged to different subjects and nothing said so. This asserts the
## two subjects are each named, so the ambiguity cannot come back.
func _test_hand_label_names_both_subjects() -> void:
	_case("HUD: the hand label names the selected card and the total", func() -> void:
		var main := MAIN_SCENE.instantiate()
		add_child(main)
		var label := main.get_node_or_null("HUD/HandLabel") as Label
		_check(label != null, "main.tscn must expose HUD/HandLabel")
		if label == null:
			_despawn(main)
			return
		var player := main.get("player") as Player
		var text: String = label.text
		_check(text.find("手牌共 %d 张" % player.hand().size()) >= 0,
			"the label must name the hand total, got %s" % text)
		# A bare "x<number>" after a card title is the ambiguous form. It may
		# only appear if the words say what it counts, which "x4" never does.
		_check(not text.contains("）· x"),
			"the label must not print a bare xN beside the card title, got %s" % text)
		_check(text.find("选中") >= 0 or player.held_card() == null,
			"with a card selected the label must say which card is selected: %s" % text)
		_despawn(main); _end())

## Drives the END TURN key through the real input path, not by calling `_end_turn`.
##
## This is the one thing every other test in this file cannot reach. They call
## methods directly, which proves the method works and proves NOTHING about
## whether any key is wired to it — the binding lives in `_unhandled_input` and
## in the InputMap that `InputActions` registers at startup. A test suite that
## only calls methods will stay green while `E` does nothing at all.
##
## [method Node.push_input] delivers a genuine [InputEvent] through the same
## viewport dispatch the OS uses, so this exercises the binding end to end.
## It is also why the suite must run through [code]test_runner.tscn[/code]: with
## `--script` there is no SceneTree, no viewport and no autoload, so the
## InputMap would be empty and this would fail for the wrong reason.
func _test_end_turn_key_actually_ends_the_turn() -> void:
	_case("Input: E ends the turn through the real input path", func() -> void:
		var main := MAIN_SCENE.instantiate()
		add_child(main)
		var player := main.get("player") as Player
		_check(player != null, "main.tscn must expose a player")
		if player == null:
			_despawn(main)
			return

		# The InputMap entry has to exist before the key can mean anything; this
		# also pins the autoload, since `InputActions` is what registers it.
		_check(InputMap.has_action(&"end_turn"),
			"InputActions must register the end_turn action")

		# Spend the turn's resources, then end the turn and require them back.
		player.energy.spend(2)
		player.gain_block(9)
		var energy_spent: int = player.energy.current
		var block_before: int = player.block.current
		_check(energy_spent < player.energy.max_energy,
			"setup: energy must be spent before the key is pressed, still %d"
			% energy_spent)
		_check(block_before > 0,
			"setup: block must be held before the key is pressed, still %d"
			% block_before)

		var event := InputEventKey.new()
		event.physical_keycode = KEY_E
		event.pressed = true
		# [method Viewport.push_input] is the real dispatch the OS feeds, so the
		# event reaches `_unhandled_input`. It lives on the viewport, not on the
		# scene node, and `push_input` on a plain Node does not exist.
		get_viewport().push_input(event, true)

		# end_turn refills energy to max and drops block; both are observable
		# proof the handler ran, without reaching into private state.
		_check(player.energy.current == player.energy.max_energy,
			"E must refill energy to %d, got %d"
			% [player.energy.max_energy, player.energy.current])
		_check(player.block.current == 0,
			"E must clear block, got %d" % player.block.current)
		_check(player.hand().size() >= 1,
			"E must redraw a hand, hand is %d" % player.hand().size())
		_despawn(main); _end())

## Drives PLAY CARD through the polling input path.
##
## [method Player._physics_process] reads [method Input.is_action_just_pressed],
## which consults the [Input] singleton's own state — not the event stream. A
## `push_input` event is invisible to it, so this test needs
## [method Input.parse_input_event] instead, plus a real `_physics_process` tick
## to observe it. Both matter: the injection proves the key is bound, the tick
## proves the poll actually happens on some frame.
func _test_play_card_key_reaches_the_polling_input_path() -> void:
	_case("Input: Q plays the held card through the polling path", func() -> void:
		var main := MAIN_SCENE.instantiate()
		add_child(main)
		var player := main.get("player") as Player
		_check(player != null, "main.tscn must expose a player")
		if player == null:
			_despawn(main)
			return
		_check(InputMap.has_action(&"play_card"),
			"InputActions must register the play_card action")

		# A card that costs nothing to resolve and needs no target, so the only
		# way it can fail is the input path itself.
		var card := DEFEND_CARD
		player.give_card(card)
		var hand_before: int = player.hand().size()
		var energy_before: int = player.energy.current
		_check(player.energy.can_afford(card.cost),
			"setup: the hand must be affordable, cost %d vs %d energy"
			% [card.cost, energy_before])

		var press := InputEventKey.new()
		press.physical_keycode = KEY_Q
		press.pressed = true
		Input.parse_input_event(press)
		# One physics frame for the poll to see the press. Driving
		# `_physics_process` by hand would bypass `is_action_just_pressed`
		# entirely and prove nothing, so the tree has to actually tick.
		await get_tree().physics_frame

		_check(player.hand().size() == hand_before - 1,
			"Q must consume one card, hand went %d -> %d"
			% [hand_before, player.hand().size()])
		_check(player.energy.current == energy_before - card.cost,
			"Q must charge the card's cost %d, energy went %d -> %d"
			% [card.cost, energy_before, player.energy.current])

		# Release, or the next test inherits a stuck key.
		var release := InputEventKey.new()
		release.physical_keycode = KEY_Q
		release.pressed = false
		Input.parse_input_event(release)
		_despawn(main); _end())

func _test_player_turn_resets_both_pools() -> void:
	_case("Turn: a player turn refills energy and drops block", func() -> void:		var player := _spawn_player()
		player.gain_block(12)
		player.energy.spend(3)
		_check(player.block.current == 12, "setup: block should be 12")
		_check(player.energy.current == 0, "setup: energy should be 0")
		player.start_turn()
		_check(player.block.current == 0,
			"a new turn must drop leftover block, got %d" % player.block.current)
		var max_energy := player.energy.max_energy
		_check(player.energy.current == max_energy,
			"a new turn must refill energy to %d, got %d"
			% [max_energy, player.energy.current])
		_despawn(player); _end())
