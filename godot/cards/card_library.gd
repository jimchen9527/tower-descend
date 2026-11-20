## Loads and serves the card pool.
##
## This is the only thing gameplay code needs to hold: ask the library for
## cards, get back typed [CardData]. It owns loading, validation and filtering
## so no caller has to know how cards are stored on disk.
##
## The pool is loaded lazily and cached, because building it is pure I/O plus
## validation — no reason to pay for it before something asks.
##
## ## Why not an Autoload
## A pool is stateful and scoped to one run, so making it global would mean
## test runs and scene reloads sharing a stale cache. Whoever owns the run
## creates one and passes it down; [EventBus] stays reserved for genuine
## cross-scene events.
class_name CardLibrary
extends RefCounted

## Emitted once the pool finishes loading. [param library] is the pool itself.
signal loaded(library: CardLibrary)
## Emitted when a card file fails validation. [param reason] explains why.
## Loading continues — one bad card must not empty the pool.
signal card_rejected(reason: String)

## Directory scanned for card resources, relative to `res://`.
const CARD_DIRECTORY: String = "res://cards/library"

## Cards keyed by [member CardData.id]. Typed so lookups return the real class
## instead of a bare Variant.
var _by_id: Dictionary[String, CardData] = {}
var _load_state: LoadState = LoadState.NOT_LOADED
var _rejected: Array[String] = []

enum LoadState {
	NOT_LOADED,   ## Nothing has been scanned yet.
	LOADING,      ## A scan is in progress.
	LOADED,       ## Every candidate file has been inspected.
}


## Ensures the pool is populated, loading it on first use.
func ensure_loaded() -> void:
	if _load_state == LoadState.LOADED:
		return
	load_cards()


## Scans [constant CARD_DIRECTORY] and rebuilds the pool from scratch.
##
## Safe to call again: it clears previous results first, so a reload after
## editing card files does not accumulate stale entries.
func load_cards() -> void:
	_by_id.clear()
	_rejected.clear()
	_load_state = LoadState.LOADING

	var dir := DirAccess.open(CARD_DIRECTORY)
	if dir == null:
		# An empty pool is a valid state (e.g. first run before any card is
		# authored). Report it, but do not treat it as a failure.
		push_warning("CardLibrary: cannot open %s (pool is empty)." % CARD_DIRECTORY)
		_load_state = LoadState.LOADED
		loaded.emit(self)
		return

	var names := dir.get_files()
	# Sort so the load order — and therefore any duplicate-id report — is
	# deterministic across filesystems.
	names.sort()
	for file_name in names:
		var lowered := file_name.to_lower()
		if not (lowered.ends_with(".tres") or lowered.ends_with(".res")):
			continue
		_load_one(CARD_DIRECTORY.path_join(file_name))

	_load_state = LoadState.LOADED
	loaded.emit(self)


func _load_one(path: String) -> void:
	var resource := ResourceLoader.load(path)
	if resource == null:
		_reject("%s: failed to load" % path)
		return
	var card := resource as CardData
	if card == null:
		_reject("%s: root is not a CardData (got %s)" % [path, resource.get_class()])
		return
	var reason := card.validate(path)
	if not reason.is_empty():
		_reject(reason)
		return
	if _by_id.has(card.id):
		_reject("%s: duplicate id '%s' (already defined)" % [path, card.id])
		return
	_by_id[card.id] = card


func _reject(reason: String) -> void:
	_rejected.append(reason)
	card_rejected.emit(reason)


## Every valid card, ordered by id.
func all_cards() -> Array[CardData]:
	var result: Array[CardData] = []
	for id in _by_id.keys():
		result.append(_by_id[id])
	result.sort_custom(func(a: CardData, b: CardData) -> bool: return a.id < b.id)
	return result


## Cards the current build can actually resolve. Filtering here means an
## unsupported card never reaches the player as a dead button.
##
## Note this excludes curse cards: they are [method CardData.is_playable] by
## design (they have a real effect — health loss) yet must never be offered as a
## button. Playability means "resolvable", not "worth playing".
func playable_cards() -> Array[CardData]:
	var result: Array[CardData] = []
	for card in all_cards():
		if card.is_playable() and card.rarity != CardData.Rarity.CURSE:
			result.append(card)
	return result


## Cards of one class. [param which] must be a [enum CardData.Discipline] value.
func cards_of_discipline(which: int) -> Array[CardData]:
	var result: Array[CardData] = []
	for card in all_cards():
		if card.discipline == which:
			result.append(card)
	return result


## Cards available at or below [param depth]. Mirrors the Web build's `dl`
## gating: 0 always qualifies, so the starting pool is never empty.
func cards_unlocked_at(depth: int) -> Array[CardData]:
	var result: Array[CardData] = []
	for card in all_cards():
		if card.unlock_depth <= depth:
			result.append(card)
	return result


## Builds a starting deck of [param size] cards, or every unlocked basic card
## when the pool is smaller than requested.
##
## Deterministic: always the same cards for the same pool, so a run can be
## reproduced from its seed without also replaying the shuffle.
func starting_deck(size: int) -> Array[CardData]:
	var candidates: Array[CardData] = []
	for card in cards_unlocked_at(0):
		if card.rarity == CardData.Rarity.BASIC:
			candidates.append(card)
	if candidates.is_empty():
		candidates = playable_cards()
	var deck: Array[CardData] = []
	for i in mini(maxi(size, 0), candidates.size()):
		deck.append(candidates[i])
	return deck


func get_card(id: String) -> CardData:
	return _by_id.get(id, null)


func has_card(id: String) -> bool:
	return _by_id.has(id)


func size() -> int:
	return _by_id.size()


## Human-readable reasons for every card that failed to load. Empty when the
## pool loaded cleanly.
func rejected_reasons() -> Array[String]:
	return _rejected.duplicate()


func load_state() -> LoadState:
	return _load_state
