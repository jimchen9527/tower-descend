"""Static sanity checks for .gd files that the engine only reports indirectly.

Godot's parse errors name a line but rarely explain the shape of the problem,
and a missing bracket or a stray indent in a multi-line lambda can surface as a
parse error on an unrelated line. These checks catch the two shapes that have
actually bitten this project:

  1. Unbalanced brackets, ignoring brackets inside string literals.
  2. A block header (`if` / `for` / `while` / `match` / `func`) with no indented
     body, which the engine reports as "Expected indented block after ...".

Run:
    python tools/check_scripts.py
Exit code is non-zero when anything is suspicious.
"""

import os
import re
import sys

SCRIPT_DIRS = ("actors", "cards", "components", "scenes", "scripts", "ui", "tests")

BLOCK_RE = re.compile(r'^(?P<indent>\t*)(?:if|elif|else|for|while|match|func)\b.*:\s*$')
FUNC_DEF_RE = re.compile(r'^func\s+(\w+)')


def strip_strings(line):
    """Returns the line with string-literal contents removed.

    Brackets inside strings must not count: an assertion message like
    "strike (attack, damage 6)" would otherwise corrupt the balance check.
    """
    out = []
    i = 0
    n = len(line)
    while i < n:
        ch = line[i]
        if ch == "#":
            break
        if ch == '"':
            i += 1
            while i < n and line[i] != '"':
                if line[i] == "\\":
                    i += 1
                i += 1
            i += 1
            continue
        if ch == "'":
            i += 1
            while i < n and line[i] != "'":
                if line[i] == "\\":
                    i += 1
                i += 1
            i += 1
            continue
        out.append(ch)
        i += 1
    return "".join(out)


def check_balance(path, lines):
    problems = []
    depth = 0
    opened_at = None
    for number, line in enumerate(lines, 1):
        stripped = strip_strings(line)
        before = depth
        depth += (stripped.count("(") + stripped.count("[") + stripped.count("{")
                  - stripped.count(")") - stripped.count("]") - stripped.count("}"))
        match = FUNC_DEF_RE.match(line)
        if match and before != 0:
            problems.append("%s:%d: func %s starts while brackets are still open "
                            "(depth %d) — the previous function is missing a "
                            "closing bracket" % (path, number, match.group(1), before))
        if before > 0 and opened_at is None:
            opened_at = number
        if depth == 0:
            opened_at = None
    if depth != 0:
        problems.append("%s: %d unclosed bracket(s) at end of file (first opened "
                        "around line %s)" % (path, depth, opened_at))
    return problems


def check_indentation(path, lines):
    """Flags a block header whose next non-blank line is not indented further."""
    problems = []
    for index, line in enumerate(lines):
        match = BLOCK_RE.match(line)
        if not match:
            continue
        header_indent = match.group("indent")
        # A header may be continued on the next line (multi-line call), so scan
        # forward until brackets balance before demanding an indented body.
        depth = (strip_strings(line).count("(") + strip_strings(line).count("[")
                 + strip_strings(line).count("{") - strip_strings(line).count(")")
                 - strip_strings(line).count("]") - strip_strings(line).count("}"))
        probe = index + 1
        while depth > 0 and probe < len(lines):
            cont = strip_strings(lines[probe])
            depth += (cont.count("(") + cont.count("[") + cont.count("{")
                      - cont.count(")") - cont.count("]") - cont.count("}"))
            probe += 1
        if probe >= len(lines):
            continue
        nxt = lines[probe]
        if not nxt.strip():
            continue
        indent = nxt[:len(nxt) - len(nxt.lstrip("\t"))]
        if len(indent) <= len(header_indent):
            problems.append("%s:%d: block header has no indented body (next line "
                            "at %s: %r)" % (path, index + 1, len(indent), nxt.strip()[:60]))
    return problems


def main():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    targets = []
    for folder in SCRIPT_DIRS:
        base = os.path.join(root, folder)
        if not os.path.isdir(base):
            continue
        for entry in sorted(os.listdir(base)):
            if entry.endswith(".gd"):
                targets.append(os.path.join(base, entry))

    problems = []
    for path in targets:
        with open(path, encoding="utf-8") as handle:
            lines = handle.read().split("\n")
        problems.extend(check_balance(path, lines))
        problems.extend(check_indentation(path, lines))

    for problem in problems:
        print("  " + problem.replace(root + os.sep, "").replace("\\", "/"))
    print("  checked %d script(s), %d problem(s)" % (len(targets), len(problems)))
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
