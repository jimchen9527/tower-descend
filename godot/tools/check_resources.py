"""Validates .tscn / .tres resource references without launching the engine.

Godot reports a broken ExtResource as a bare "Parse error" pointing at the
resource line, not at the offending id — which makes a renamed id very hard to
track down. This checker resolves every ExtResource reference against the ids
actually declared in the same file, so the real culprit is named directly.

Run:
    python tools/check_resources.py
Exit code is non-zero when anything is inconsistent, so it can gate a commit.
"""

import os
import re
import sys

RESOURCE_DIRS = ("actors", "cards", "components", "scenes", "ui", "tests")

EXT_DEF = re.compile(r'^\[ext_resource\s+.*id="([^"]+)"', re.M)
# Attribute order is not fixed: Godot writes `type="Resource" script_class="X"
# id="Step0"`, and a regex that assumed `id` came straight after `type` would
# silently declare every card's steps undeclared — which is exactly the failure
# this checker exists to catch, so it must not be the thing generating it.
SUB_DEF = re.compile(r'^\[sub_resource\s+[^\]]*?\bid="([^"]+)"', re.M)
# Matches ExtResource("x") and SubResource("x").
EXT_USE = re.compile(r'ExtResource\("([^"]+)"')
SUB_USE = re.compile(r'SubResource\("([^"]+)"')
LOAD_STEPS = re.compile(r'load_steps=(\d+)')

# A .tscn must declare exactly this header shape; anything else is hand-written
# wrong and will confuse the parser before it ever reaches a real error.
HEADER_OK = re.compile(r'^\[gd_(scene|resource)\b.*\bformat=3\]')


def check_file(path):
    """Returns a list of problem strings for one resource file."""
    problems = []
    with open(path, encoding="utf-8") as fh:
        text = fh.read()

    if not HEADER_OK.match(text):
        first = text.splitlines()[0] if text.splitlines() else "<empty>"
        problems.append("%s: bad or missing header (expected "
                        "[gd_scene ... format=3] / [gd_resource ... format=3]): %s"
                        % (path, first))

    ext_ids = set(EXT_DEF.findall(text))
    sub_ids = set(SUB_DEF.findall(text))

    for used in sorted(set(EXT_USE.findall(text))):
        if used not in ext_ids:
            problems.append("%s: ExtResource(\"%s\") has no matching "
                            "[ext_resource]; declared ids are %s"
                            % (path, used, sorted(ext_ids)))
    for used in sorted(set(SUB_USE.findall(text))):
        if used not in sub_ids:
            problems.append("%s: SubResource(\"%s\") has no matching "
                            "[sub_resource]; declared ids are %s"
                            % (path, used, sorted(sub_ids)))

    # load_steps counts external + sub resources, plus one for the resource
    # block itself. Godot tolerates a wrong value in some cases but it is the
    # single most common cause of a bare "Parse error" in a hand-edited file.
    steps = LOAD_STEPS.search(text)
    if steps:
        expected = len(ext_ids) + len(sub_ids) + 1
        actual = int(steps.group(1))
        if actual != expected:
            problems.append("%s: load_steps=%d but there are %d ext + %d sub "
                            "resources, so it should be %d"
                            % (path, actual, len(ext_ids), len(sub_ids), expected))
    return problems


def main():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    targets = []
    for folder in RESOURCE_DIRS:
        base = os.path.join(root, folder)
        if not os.path.isdir(base):
            continue
        for entry in sorted(os.listdir(base)):
            if entry.endswith((".tscn", ".tres")):
                targets.append(os.path.join(base, entry))
        library = os.path.join(base, "library")
        if os.path.isdir(library):
            for entry in sorted(os.listdir(library)):
                if entry.endswith((".tscn", ".tres")):
                    targets.append(os.path.join(library, entry))

    all_problems = []
    for path in targets:
        all_problems.extend(check_file(path))

    rel_root = root
    for problem in all_problems:
        print("  " + problem.replace(rel_root + os.sep, "").replace("\\", "/"))
    print("  checked %d resource files, %d problem(s)"
          % (len(targets), len(all_problems)))
    return 1 if all_problems else 0


if __name__ == "__main__":
    sys.exit(main())
