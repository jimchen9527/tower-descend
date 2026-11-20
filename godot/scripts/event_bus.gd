## Global event bus for cross-scene, decoupled communication.
##
## Lifetime: created once at app start, persists across every scene change.
## Responsibility: SIGNALS ONLY for events that genuinely span scenes.
## Gameplay logic MUST NOT live here — this node cannot be instanced in isolation.
##
## Rule of thumb: if the emitter and the listener can live in different scenes,
## the signal belongs here. If both live in the same scene, keep the signal on
## the emitting node instead.
extends Node

## Emitted once when the player's HealthComponent reaches 0.
signal player_died

## Emitted when an enemy's HealthComponent reaches 0.
## [param enemy] is the enemy node, valid only during the signal callback.
signal enemy_died(enemy: Node)

## Emitted after the player takes damage. [param amount] is the raw damage value.
signal player_damaged(amount: int)
