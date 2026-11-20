"""Generates every Godot card resource from the Web build's card pool.

The numbers in `js/data/cards.js` are the ones all 47 cards were balanced
against. Copying them by hand into 47 `.tres` files is exactly the kind of task
that produces a card that looks right and reads one point low, so this script
parses the Web source and emits resources from it.

Run:
    python tools/gen_cards.py            # write the pool
    python tools/gen_cards.py --check    # verify the pool matches the source

`--check` is the important one: it fails if any `.tres` on disk disagrees with
`cards.js`, which turns "did I transcribe this correctly" into a question with a
yes/no answer instead of a review task.

Card text is also copied verbatim from the Web build's `text()` output rather
than re-worded, so the two versions cannot drift into describing different cards.
"""

import argparse
import os
import re
import sys

PROJECT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEB_CARDS = os.path.join(os.path.dirname(PROJECT_DIR), "js", "data", "cards.js")
OUT_DIR = os.path.join(PROJECT_DIR, "cards", "library")

# The .tres files reference scripts by PATH only. UIDs are deliberately omitted:
# Godot resolves a path reference fine and then writes the UID into the file on
# its next save, which is the engine's job to do — copying a UID from another
# script's .uid file here would bind every card to the wrong script.

# Enum ordinals, mirrored from cards/effect_spec.gd and cards/card_data.gd.
# Duplicated here rather than imported because Godot enums have no reflection the
# Python side can read — so the parity test below is the guard against drift.
EFFECT_KIND = {
    "DAMAGE": 0, "RAW_DAMAGE": 1, "BLOCK": 2, "HEAL": 3,
    "LOSE_HEALTH": 4, "DRAW": 5, "ENERGY": 6, "ADD_STATUS": 7,
}
TARGET_MODE = {"ENEMY": 0, "ALL_ENEMIES": 1, "SELF": 2}
SCALE_SOURCE = {
    "NONE": 0, "DEPTH": 1, "OWN_STRENGTH": 2, "SKILL_PLAYS": 3, "ATTACK_PLAYS": 4,
}
RATIO_SOURCE = {"NONE": 0, "OWN_BLOCK_RATIO": 1, "CONSUMED_BLOCK_TIMES": 2}
PER_SOURCE = {"NONE": 0, "OWN_BLOCK_PER": 1, "CONSUMED_BLOCK_PER": 2}
CONDITION = {
    "ALWAYS": 0, "IF_BLOCKED": 1, "IF_TARGET_DIED": 2, "IF_ANY_DIED": 3,
    "IF_ATTACK_PLAYED": 4, "IF_SKILL_PLAYED": 5,
}
STATUS_KIND = {
    "STRENGTH": 0, "DEXTERITY": 1, "WEAK": 2, "VULNERABLE": 3, "POISON": 4,
    "THORNS": 5, "METALLICIZE": 6, "BARRICADE": 7, "STR_PER_TURN": 8,
}
CARD_TYPE = {"attack": 0, "skill": 1, "power": 2, "status": 3}
RARITY = {"basic": 0, "common": 1, "uncommon": 2, "rare": 3, "curse": 4}


def die(message):
    print("ERROR: %s" % message, file=sys.stderr)
    sys.exit(1)


def parse_js_cards(path):
    """Extracts every card definition from the Web build's `CARDS` object.

    Returns a list of dicts. Deliberately a narrow regex reader rather than a
    JS parser: the file is a flat literal object with one `play()` function per
    entry, and the only fields that matter here are the scalar ones plus the two
    number bags `v` / `upV`. A real parser would be more code for no extra
    confidence on this input shape.
    """
    with open(path, "r", encoding="utf-8") as handle:
        source = handle.read()

    start = source.index("const CARDS = {")
    # The object ends at the matching brace; find it by counting, because a
    # `},` also appears inside the `play()` bodies.
    depth = 0
    end = None
    for index in range(start, len(source)):
        char = source[index]
        if char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                end = index
                break
    if end is None:
        die("could not find the end of the CARDS object in %s" % path)
    body = source[start:end]

    cards = []
    # Each entry starts at 2-space indent with `id: {`.
    entry_re = re.compile(r"^  (\w+): \{$", re.M)
    entries = list(entry_re.finditer(body))
    for position, match in enumerate(entries):
        chunk_end = entries[position + 1].start() if position + 1 < len(entries) else len(body)
        chunk = body[match.start():chunk_end]
        card = parse_card_chunk(match.group(1), chunk)
        cards.append(card)
    return cards


def parse_card_chunk(fallback_id, chunk):
    """Reads one card's scalars and its `v` / `upV` number bags."""
    card = {"id": fallback_id}

    def scalar(name, cast=str):
        # The Web build packs several scalars onto one line
        # (`id: 'strike', name: '打击', cost: 1, type: 'attack', ...`), so the
        # match must not be anchored to the end of a line. The trailing
        # lookahead only forbids a following `.` so `dl:` cannot match the `dl`
        # inside `old_dl:` and friends.
        found = re.search(r"(?<![\w.])%s:\s*('([^']*)'|-?[\d.]+|true|false)\s*(?=[,}])"
                          % name, chunk)
        if not found:
            return None
        raw = found.group(1)
        if raw.startswith("'"):
            return found.group(2)
        if raw == "true":
            return True
        if raw == "false":
            return False
        return cast(raw)

    card["name"] = scalar("name") or fallback_id
    card["cost"] = scalar("cost", int)
    card["type"] = scalar("type") or "skill"
    card["rarity"] = scalar("rarity") or "common"
    card["dl"] = scalar("dl", int) or 0
    card["curse_hp_loss"] = scalar("curseHpLoss", int) or 0
    card["unplayable"] = bool(scalar("unplayable"))

    values = re.search(r"v:\s*\{([^}]*)\}", chunk)
    card["v"] = parse_number_bag(values.group(1)) if values else {}
    upgraded = re.search(r"upV:\s*(\{([^}]*)\}|null)", chunk)
    if upgraded and upgraded.group(2) is not None:
        card["upV"] = parse_number_bag(upgraded.group(2))
    else:
        card["upV"] = {}

    card["description"] = render_description(chunk, card)
    return card


def parse_number_bag(text):
    """Reads `{ dmg: 6, block: 5 }` into a dict of numbers."""
    bag = {}
    for name, raw in re.findall(r"(\w+):\s*(-?[\d.]+)", text):
        value = float(raw)
        bag[name] = int(value) if value == int(value) else value
    return bag


def render_description(chunk, card):
    """Replays the Web build's `text()` to produce the rules line.

    The template bodies only ever interpolate `v.<field>` or call
    `Math.round(...)` on one, so a tiny evaluator covers all 47 cards without
    pulling in a JS engine. Falling back to the raw template keeps a card
    authored rather than silently dropped if the Web build grows a form this
    does not model.
    """
    template = re.search(r"text:\s*\(v\)\s*=>\s*`([^`]*)`", chunk)
    if not template:
        return ""
    expression = template.group(1)
    # Normalise the two JS forms in use: `v.x` and Math.round(v.x * 100).
    rendered = re.sub(r"Math\.round\(v\.(\w+)\s*\*\s*100\)",
                      lambda m: str(round(card["v"].get(m.group(1), 0) * 100)),
                      expression)
    rendered = re.sub(r"v\.(\w+)", lambda m: str(card["v"].get(m.group(1), 0)), rendered)
    # Strip the JS template-literal `${...}` wrappers the substitution leaves
    # behind. The conditional tails (`v.block ? ... : ...`) are authored per
    # card and have no mechanical equivalent here; the numbers inside them are
    # still real, so keep the text rather than dropping the sentence.
    rendered = re.sub(r"\$\{([^}]*)\}", r"\1", rendered)
    return rendered.strip()


# --- Card recipes -----------------------------------------------------------
#
# One recipe per card says how the Web build's `play()` body maps onto effect
# steps. Written out rather than inferred, because the mapping is a design
# decision: `strDown: 2` means "-2 STRENGTH to the enemy" and that is not
# something a generic reader could know.
#
# Each step dict is passed straight through to the emitter; keys absent from the
# dict keep the script's neutral defaults (target ENEMY for damage, SELF for
# everything else, times 1, condition ALWAYS).

def S(kind, **kwargs):
    step = {"kind": kind}
    step.update(kwargs)
    return step


RECIPES = {
    # --- DL0 basic pool ---
    "strike": lambda c: [S("DAMAGE", v=c["v"]["dmg"], uv=c["upV"].get("dmg"))],
    "defend": lambda c: [S("BLOCK", v=c["v"]["block"], uv=c["upV"].get("block"))],
    "brace": lambda c: [S("BLOCK", v=c["v"]["block"], uv=c["upV"].get("block"))],
    "iron_fist": lambda c: [S("DAMAGE", v=c["v"]["dmg"], uv=c["upV"].get("dmg"))],
    "crowbar": lambda c: [S("DAMAGE", v=c["v"]["dmg"], uv=c["upV"].get("dmg"),
                            cond="IF_BLOCKED", cond_replaces=True,
                            cond_v=c["v"]["boost"], cond_uv=c["upV"].get("boost"))],
    "pry": lambda c: [S("DAMAGE", v=c["v"]["dmg"], uv=c["upV"].get("dmg")),
                      S("DRAW", v=c["v"]["draw"], uv=c["upV"].get("draw"))],
    "shove": lambda c: [S("DAMAGE", v=c["v"]["dmg"], uv=c["upV"].get("dmg")),
                        S("ADD_STATUS", target="ENEMY", status="WEAK",
                          v=c["v"]["weak"], uv=c["upV"].get("weak"))],
    "hardhat": lambda c: [S("BLOCK", v=c["v"]["block"], uv=c["upV"].get("block")),
                          S("BLOCK", v=c["v"]["bonus"], uv=c["upV"].get("bonus"),
                            cond="IF_ATTACK_PLAYED")],
    "shrapnel": lambda c: [S("DAMAGE", ratio="OWN_BLOCK_RATIO", v=0,
                             r=c["v"]["ratio"], ur=c["upV"].get("ratio"))],
    "patch": lambda c: [S("HEAL", v=c["v"]["heal"], uv=c["upV"].get("heal"))],
    "cursed_lung": lambda c: [],

    # --- DL1 ---
    "rivet_plate": lambda c: [S("BLOCK", v=c["v"]["block"], uv=c["upV"].get("block"))],
    "hydraulic": lambda c: [S("DAMAGE", ratio="CONSUMED_BLOCK_TIMES", v=0,
                              r=c["v"]["ratio"], ur=c["upV"].get("ratio"))],
    "dismantle": lambda c: [S("DAMAGE", v=c["v"]["dmg"], uv=c["upV"].get("dmg")),
                            S("BLOCK", v=c["v"]["block"], uv=c["upV"].get("block"))],

    # --- DL2 ---
    "ballast": lambda c: [S("ADD_STATUS", status="STRENGTH",
                            per="OWN_BLOCK_PER", per_n=c["v"]["per"],
                            per_n_uv=c["upV"].get("per"))],
    "wall_pick": lambda c: [S("DAMAGE", v=c["v"]["dmg"], uv=c["upV"].get("dmg"),
                              scale="DEPTH", coef=c["v"]["perDepth"],
                              coef_uv=c["upV"].get("perDepth"))],
    "weld": lambda c: [S("BLOCK", v=c["v"]["block"], uv=c["upV"].get("block")),
                       S("DRAW", v=c["v"]["draw"], uv=c["upV"].get("draw"))],
    "shockwave": lambda c: [S("DAMAGE", target="ALL_ENEMIES", v=c["v"]["dmg"],
                              uv=c["upV"].get("dmg")),
                            S("BLOCK", v=c["v"]["block"], uv=c["upV"].get("block"))],
    "counterweight": lambda c: [S("ADD_STATUS", status="DEXTERITY",
                                  v=c["v"]["dex"], uv=c["upV"].get("dex"))],
    "deep_work": lambda c: [S("BLOCK", v=0, scale="DEPTH",
                              coef=c["v"]["perDepth"], coef_uv=c["upV"].get("perDepth"))],
    "quake": lambda c: [S("DAMAGE", v=c["v"]["dmg"], uv=c["upV"].get("dmg")),
                        S("ADD_STATUS", target="ENEMY", status="STRENGTH",
                          v=-c["v"]["strDown"], uv=-c["upV"]["strDown"])],

    # --- DL3 ---
    "plate_guard": lambda c: [S("ADD_STATUS", status="DEXTERITY",
                                v=c["v"]["dex"], uv=c["upV"].get("dex")),
                              S("BLOCK", v=c["v"]["block"], uv=c["upV"].get("block"))],
    "chain_chisel": lambda c: [S("DAMAGE", v=c["v"]["dmg"], uv=c["upV"].get("dmg"),
                                 times=c["v"]["times"])],
    "rust_grip": lambda c: [S("ADD_STATUS", target="ENEMY", status="WEAK",
                              v=c["v"]["weak"], uv=c["upV"].get("weak")),
                            S("ADD_STATUS", target="ENEMY", status="VULNERABLE",
                              v=c["v"]["vuln"], uv=c["upV"].get("vuln"))],
    "emergency": lambda c: [S("BLOCK", v=c["v"]["block"], uv=c["upV"].get("block")),
                            S("LOSE_HEALTH", v=c["v"]["selfHurt"],
                              uv=c["upV"].get("selfHurt"))],

    # --- DL4 ---
    "pressure_valve": lambda c: [S("ADD_STATUS", status="STRENGTH",
                                   per="CONSUMED_BLOCK_PER", per_n=c["v"]["per"],
                                   per_n_uv=c["upV"].get("per"))],
    "sledge_work": lambda c: [S("DAMAGE", v=c["v"]["dmg"], uv=c["upV"].get("dmg")),
                              S("ADD_STATUS", target="ENEMY", status="STRENGTH",
                                v=-c["v"]["strDown"], uv=-c["upV"]["strDown"])],
    "derrick": lambda c: [S("ADD_STATUS", status="METALLICIZE",
                             v=c["v"]["block"], uv=c["upV"].get("block"))],
    "chain_demolition": lambda c: [
        S("DAMAGE", target="ALL_ENEMIES", v=c["v"]["dmg"], uv=c["upV"].get("dmg")),
        S("DRAW", v=1, cond="IF_ANY_DIED")],
    "rockbreak": lambda c: [S("RAW_DAMAGE", v=c["v"]["dmg"], uv=c["upV"].get("dmg"))],
    "temper": lambda c: [S("BLOCK", v=c["v"]["block"], uv=c["upV"].get("block")),
                         S("ADD_STATUS", target="ENEMY", status="POISON",
                           v=c["v"]["poison"], uv=c["upV"].get("poison"))],
    "pry_combo": lambda c: [S("DAMAGE", v=c["v"]["dmg"], uv=c["upV"].get("dmg")),
                            S("DRAW", v=c["v"]["draw"], uv=c["upV"].get("draw"),
                              cond="IF_TARGET_DIED")],
    "steel_beam": lambda c: [S("ADD_STATUS", status="STR_PER_TURN",
                               v=c["v"]["str"], uv=c["upV"].get("str"))],
    "dual_crowbar": lambda c: [S("DAMAGE", v=c["v"]["dmg"], uv=c["upV"].get("dmg"),
                                 times=c["v"]["times"])],

    # --- DL5 / DL6 ---
    "riposte": lambda c: [S("BLOCK", v=c["v"]["block"], uv=c["upV"].get("block")),
                           S("ADD_STATUS", status="THORNS", v=c["v"]["thorns"],
                             uv=c["upV"].get("thorns"))],
    "blast_charge": lambda c: [S("DAMAGE", v=c["v"]["dmg"], uv=c["upV"].get("dmg")),
                               S("LOSE_HEALTH", v=c["v"]["selfHurt"],
                                 uv=c["upV"].get("selfHurt"))],
    "seam_resonance": lambda c: [S("DAMAGE", v=0, scale="DEPTH",
                                   coef=c["v"]["perDepth"],
                                   coef_uv=c["upV"].get("perDepth"))],
    "heavy_rig": lambda c: [S("ADD_STATUS", status="BARRICADE", v=c["v"]["keep"]),
                            S("BLOCK", v=c["v"].get("block", 0),
                              uv=c["upV"].get("block"))],
    "salvage": lambda c: [S("BLOCK", v=c["v"]["block"], uv=c["upV"].get("block"),
                            scale="DEPTH", coef=1),
                          S("HEAL", v=c["v"]["heal"], uv=c["upV"].get("heal"))],
    "demolition_charge": lambda c: [S("RAW_DAMAGE", target="ALL_ENEMIES",
                                      v=c["v"]["dmg"], uv=c["upV"].get("dmg"))],
    "abyss_echo": lambda c: [S("DAMAGE", v=0, scale="DEPTH",
                               coef=c["v"]["perDepth"], coef_uv=c["upV"].get("perDepth")),
                             S("DRAW", v=c["v"]["draw"], uv=c["upV"].get("draw"))],
    "iron_will": lambda c: [S("BLOCK", v=c["v"]["block"], uv=c["upV"].get("block"),
                             scale="OWN_STRENGTH", coef=c["v"]["perStr"],
                             coef_uv=c["upV"].get("perStr"))],
    "wall_breaker": lambda c: [S("BLOCK", v=c["v"]["block"], uv=c["upV"].get("block"),
                                 scale="SKILL_PLAYS", coef=c["v"]["perSkill"],
                                 coef_uv=c["upV"].get("perSkill"))],
    "jackhammer": lambda c: [S("DAMAGE", v=c["v"]["dmg"], uv=c["upV"].get("dmg"),
                              times=c["v"]["times"])],
    "bottom_hammer": lambda c: [S("DAMAGE", v=c["v"]["dmg"], uv=c["upV"].get("dmg"),
                                  scale="ATTACK_PLAYS", coef=c["v"]["perAttack"],
                                  coef_uv=c["upV"].get("perAttack"))],
    "immovable": lambda c: [S("ADD_STATUS", status="BARRICADE", v=1),
                            S("ADD_STATUS", status="METALLICIZE", v=c["v"]["block"],
                              uv=c["upV"].get("block"))],
    "final_bore": lambda c: [S("RAW_DAMAGE", v=0, scale="DEPTH",
                               coef=c["v"]["perDepth"], coef_uv=c["upV"].get("perDepth")),
                             S("LOSE_HEALTH", v=c["v"]["selfHurt"],
                               uv=c["upV"].get("selfHurt"))],
    "bedrock_hammer": lambda c: [S("DAMAGE", v=c["v"]["dmg"], uv=c["upV"].get("dmg")),
                                 S("BLOCK", v=c["v"]["block"], uv=c["upV"].get("block"))],
}


def build_steps(card):
    """Turns one parsed card into its effect steps.

    Fails loudly on an unrecognised card rather than skipping it: a card silently
    missing from the pool is exactly the kind of gap that survives review.
    """
    recipe = RECIPES.get(card["id"])
    if recipe is None:
        die("no recipe for card '%s' — add one to RECIPES in gen_cards.py" % card["id"])
    steps = recipe(card)
    if card["unplayable"]:
        # A curse is deliberately unplayable; a card with effects AND unplayable
        # would be a contradiction worth failing on.
        if steps:
            die("card '%s' is marked unplayable but has %d step(s)"
                % (card["id"], len(steps)))
    return steps


def fmt_number(value):
    """Formats a .tres numeric literal, keeping floats recognisable."""
    if isinstance(value, float):
        text = repr(value)
        return text
    return str(value)


def render_step(index, step):
    """Emits one sub-resource block for a [CardEffectStep]."""
    kind = step["kind"]
    target = step.get("target", "SELF" if kind not in ("DAMAGE", "RAW_DAMAGE") else "ENEMY")
    lines = []
    lines.append('[sub_resource type="Resource" script_class="CardEffectStep" id="Step%d"]' % index)
    lines.append('script = ExtResource("2_step")')
    lines.append("kind = %d" % EFFECT_KIND[kind])
    lines.append("target = %d" % TARGET_MODE[target])
    lines.append("value = %d" % step.get("v", 0))
    upgraded_value = step.get("uv")
    if upgraded_value is not None and upgraded_value != step.get("v", 0):
        lines.append("upgraded_value = %d" % upgraded_value)
    if step.get("scale"):
        lines.append("scale_source = %d" % SCALE_SOURCE[step["scale"]])
        lines.append("scale_coef = %d" % step.get("coef", 0))
        upgraded_coef = step.get("coef_uv")
        if upgraded_coef is not None and upgraded_coef != step.get("coef", 0):
            lines.append("upgraded_scale_coef = %d" % upgraded_coef)
    if step.get("ratio"):
        lines.append("ratio_source = %d" % RATIO_SOURCE[step["ratio"]])
        lines.append("ratio = %s" % fmt_number(step.get("r", 0.0)))
        upgraded_ratio = step.get("ur")
        if upgraded_ratio is not None and upgraded_ratio != step.get("r", 0.0):
            lines.append("upgraded_ratio = %s" % fmt_number(upgraded_ratio))
    if step.get("per"):
        lines.append("per_source = %d" % PER_SOURCE[step["per"]])
        lines.append("per = %d" % step.get("per_n", 1))
        upgraded_per = step.get("per_n_uv")
        if upgraded_per is not None and upgraded_per != step.get("per_n", 1):
            lines.append("upgraded_per = %d" % upgraded_per)
    if step.get("times", 1) != 1:
        lines.append("times = %d" % step["times"])
    if step.get("cond"):
        lines.append("condition = %d" % CONDITION[step["cond"]])
    if step.get("cond_replaces"):
        lines.append("condition_replaces = true")
    if step.get("cond_v"):
        lines.append("condition_value = %d" % step["cond_v"])
        if step.get("cond_uv") is not None and step["cond_uv"] != step["cond_v"]:
            lines.append("upgraded_condition_value = %d" % step["cond_uv"])
    if kind == "ADD_STATUS":
        lines.append("status_kind = %d" % STATUS_KIND[step["status"]])
    lines.append("")
    return lines


def render_card(card, steps):
    """Emits the full `.tres` text for one card."""
    # load_steps counts the sub-resources plus the two ext_resources, plus 1 for
    # the resource block itself. Getting this wrong makes Godot re-import on
    # every load, so it is computed rather than hardcoded.
    load_steps = 2 + len(steps) + 1
    out = []
    out.append('[gd_resource type="Resource" script_class="CardData" load_steps=%d format=3]'
               % load_steps)
    out.append("")
    out.append('[ext_resource type="Script" path="res://cards/card_data.gd" id="1_script"]')
    out.append('[ext_resource type="Script" path="res://cards/effect_spec.gd" id="2_step"]')
    out.append("")
    for index, step in enumerate(steps):
        out.extend(render_step(index, step))
    out.append("[resource]")
    out.append('script = ExtResource("1_script")')
    out.append('id = "%s"' % card["id"])
    out.append('title = "%s"' % card["name"])
    out.append('description = "%s"' % card["description"].replace('"', '\\"'))
    out.append("cost = %d" % card["cost"])
    out.append("card_type = %d" % CARD_TYPE[card["type"]])
    out.append("rarity = %d" % RARITY[card["rarity"]])
    out.append("discipline = 0")
    out.append("unlock_depth = %d" % card["dl"])
    if steps:
        out.append("effects = Array[ExtResource(\"2_step\")]([%s])"
                   % ", ".join("SubResource(\"Step%d\")" % i for i in range(len(steps))))
    if card["curse_hp_loss"]:
        out.append("curse_hp_loss = %d" % card["curse_hp_loss"])
    out.append("")
    return "\n".join(out)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true",
                        help="verify the pool on disk instead of writing it")
    args = parser.parse_args()

    if not os.path.exists(WEB_CARDS):
        die("Web card source not found at %s" % WEB_CARDS)

    cards = parse_js_cards(WEB_CARDS)
    if not cards:
        die("parsed zero cards from %s" % WEB_CARDS)

    built = []
    for card in cards:
        built.append((card, build_steps(card)))

    # The six placeholder cards from Phase 3/4 are authored by hand and are not
    # in the Web pool. Two of them share an id with the real pool (strike,
    # defend) and are replaced; the rest are stale and must not linger, because
    # a second file with a fresh id would quietly widen the pool.
    stale = ["heavy_blow", "second_wind", "surgical_strike"]
    stale_paths = [os.path.join(OUT_DIR, "%s.tres" % name) for name in stale]
    known_ids = {card["id"] for card, _ in built}

    if args.check:
        problems = []
        for card, steps in built:
            path = os.path.join(OUT_DIR, "%s.tres" % card["id"])
            if not os.path.exists(path):
                problems.append("missing: %s" % os.path.basename(path))
                continue
            with open(path, "r", encoding="utf-8") as handle:
                actual = handle.read()
            if actual != render_card(card, steps):
                problems.append("out of date: %s" % os.path.basename(path))
        for name, path in zip(stale, stale_paths):
            if os.path.exists(path):
                problems.append("stale hand-written card still present: %s" % os.path.basename(path))
        extra = []
        for name in sorted(os.listdir(OUT_DIR)):
            if not name.endswith(".tres"):
                continue
            if name[:-5] not in known_ids:
                extra.append(name)
        for name in extra:
            problems.append("unexpected file not in the Web pool: %s" % name)
        if problems:
            print("Card pool does NOT match %s:" % os.path.basename(WEB_CARDS))
            for problem in problems:
                print("  - %s" % problem)
            return 1
        print("Card pool matches %s (%d cards)." % (os.path.basename(WEB_CARDS), len(built)))
        return 0

    os.makedirs(OUT_DIR, exist_ok=True)
    for path in stale_paths:
        if os.path.exists(path):
            os.remove(path)
    for card, steps in built:
        path = os.path.join(OUT_DIR, "%s.tres" % card["id"])
        with open(path, "w", encoding="utf-8") as handle:
            handle.write(render_card(card, steps))
    print("Wrote %d cards to %s" % (len(built), OUT_DIR))
    return 0


if __name__ == "__main__":
    sys.exit(main())