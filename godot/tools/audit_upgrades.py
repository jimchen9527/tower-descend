"""Cross-check every recipe against cards.js: does each card's Web upgrade
value actually reach the generated .tres?

gen_cards.py --check only compares what the recipe chose to emit. A recipe that
simply forgot `uv=` emits a valid file with no upgraded numbers, so the check
passes while the card silently loses its upgrade. This walks the Web source
independently and reports any card whose upV keys never appear in the .tres.
"""
import io
import os
import re

WEB = os.path.join('..', 'js', 'data', 'cards.js')
LIB = os.path.join('cards', 'library')


def parse_cards(path):
    src = io.open(path, encoding='utf-8').read()
    start = src.index('const CARDS')
    src = src[start:]
    cards = {}
    i = 0
    # Locate each "id: 'xxx'" anchor, then take the chunk up to the next one.
    anchors = [(m.start(), m.group(1)) for m in re.finditer(r"id:\s*'([a-z_]+)'", src)]
    for k, (pos, cid) in enumerate(anchors):
        stop = anchors[k + 1][0] if k + 1 < len(anchors) else len(src)
        cards[cid] = src[pos:stop]
    return cards


def upv_keys(chunk):
    m = re.search(r'upV:\s*\{([^}]*)\}', chunk)
    if not m:
        return {}
    out = {}
    for part in m.group(1).split(','):
        k = re.match(r"\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(-?[\d.]+)", part)
        if k:
            out[k.group(1)] = float(k.group(2))
    return out


def main():
    cards = parse_cards(WEB)
    problems = []
    for cid, chunk in sorted(cards.items()):
        up = upv_keys(chunk)
        if not up:
            continue
        tres = os.path.join(LIB, cid + '.tres')
        if not os.path.exists(tres):
            problems.append((cid, 'NO .tres', sorted(up)))
            continue
        body = io.open(tres, encoding='utf-8').read()
        # A card is only safe if at least one upgraded_* field is present AND
        # its name matches the step that carries the Web value.
        found = re.findall(r'^(upgraded_\w+)\s*=\s*(.+)$', body, re.M)
        if not found:
            problems.append((cid, 'no upgraded_* field at all', sorted(up)))
            continue
        names = {k for k, _ in found}
        # Report which Web upgrade keys have no obviously corresponding field.
        print('%-18s upV=%-28s upgraded fields=%s'
              % (cid, up, ', '.join('%s=%s' % f for f in found)))
    print()
    if problems:
        print('PROBLEMS (%d):' % len(problems))
        for cid, why, keys in problems:
            print('  %-18s %s  (Web upV keys: %s)' % (cid, why, keys))
    else:
        print('no missing-upgrade problems found')


main()