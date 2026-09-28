#!/usr/bin/env python3
"""Reflow a Markdown draft to the repo's line-length rule without changing a word.

Usage: reflow.py DRAFT_PATH --width N [--tolerance M] [--check]

Wraps paragraphs, blockquotes, and list items at N characters. Words are never
broken or hyphenated, so a line holding an unbreakable token (a long URL) may run
past N; any line over M (default N + 5) is reported. Headings, code fences, tables, HTML, and
image or link-reference lines are left exactly as they are. Each list item is
wrapped on its own, with continuation lines aligned under the item's text, so list
items are never merged. A wrapped line never starts with a list marker.

--check reports lines over M and paragraphs that would change, without writing.
Exit status: 0 on success, 1 when --check finds work to do, 2 on a usage error or
when the reflow would change the words of the draft.
"""
import re
import sys
import textwrap

WIDTH = None
TOLERANCE = None
LIST_ITEM = re.compile(r"^(\s*)([-*+]|\d+[.)])(\s+)")
MARKER_START = re.compile(r"^([-*+]|\d+[.)])\s")
KEEP_AS_IS = re.compile(r"^(\s*#|\s*\||\s*<|\s*!\[|\s*\[[^\]]+\]:\s|\s*---\s*$|\s*\*\*\*\s*$)")
FENCE = re.compile(r"^\s*(```|~~~)")


def wrap(text, width, initial, subsequent):
    words = text.split()
    lines = textwrap.wrap(
        " ".join(words),
        width=width,
        initial_indent=initial,
        subsequent_indent=subsequent,
        break_long_words=False,
        break_on_hyphens=False,
    )
    # Never leave a wrapped line starting with a list marker: pull the marker up.
    fixed = [lines[0]] if lines else []
    for line in lines[1:]:
        body = line[len(subsequent):]
        if MARKER_START.match(body):
            marker, rest = body.split(" ", 1)
            fixed[-1] = fixed[-1] + " " + marker
            line = subsequent + rest
        fixed.append(line)
    return fixed


def blocks(lines):
    """Yield (kind, lines) where kind is 'fence', 'keep', 'blank', 'list', 'quote', or 'para'."""
    i = 0
    n = len(lines)
    if lines and lines[0].strip() == "---":  # front matter
        j = 1
        while j < n and lines[j].strip() != "---":
            j += 1
        yield "keep", lines[: j + 1]
        i = j + 1
    while i < n:
        line = lines[i]
        if FENCE.match(line):
            j = i + 1
            while j < n and not FENCE.match(lines[j]):
                j += 1
            yield "fence", lines[i : j + 1]
            i = j + 1
        elif not line.strip():
            yield "blank", [line]
            i += 1
        elif KEEP_AS_IS.match(line):
            yield "keep", [line]
            i += 1
        elif LIST_ITEM.match(line):
            m = LIST_ITEM.match(line)
            indent = len(m.group(1)) + len(m.group(2)) + len(m.group(3))
            j = i + 1
            while (
                j < n
                and lines[j].strip()
                and not LIST_ITEM.match(lines[j])
                and not FENCE.match(lines[j])
                and not KEEP_AS_IS.match(lines[j])
                and len(lines[j]) - len(lines[j].lstrip()) >= indent
            ):
                j += 1
            yield "list", lines[i:j]
            i = j
        elif line.lstrip().startswith(">"):
            j = i
            while j < n and lines[j].lstrip().startswith(">") and lines[j].lstrip(">").strip():
                j += 1
            if j == i:
                j = i + 1
            yield "quote", lines[i:j]
            i = j
        else:
            j = i
            while (
                j < n
                and lines[j].strip()
                and not FENCE.match(lines[j])
                and not KEEP_AS_IS.match(lines[j])
                and not LIST_ITEM.match(lines[j])
                and not lines[j].lstrip().startswith(">")
            ):
                j += 1
            yield "para", lines[i:j]
            i = j


def reflow_block(kind, block):
    if kind in ("fence", "keep", "blank"):
        return block
    if kind == "list":
        m = LIST_ITEM.match(block[0])
        lead = m.group(0)
        text = block[0][len(lead):] + " " + " ".join(l.strip() for l in block[1:])
        return wrap(text, WIDTH, lead, " " * len(lead))
    if kind == "quote":
        prefix = re.match(r"^\s*>\s?", block[0]).group(0)
        text = " ".join(re.sub(r"^\s*>\s?", "", l) for l in block)
        return wrap(text, WIDTH, prefix, prefix)
    indent = block[0][: len(block[0]) - len(block[0].lstrip())]
    return wrap(" ".join(l.strip() for l in block), WIDTH, indent, indent)


def parse(argv):
    path, width, tolerance, check = None, None, None, False
    it = iter(argv[1:])
    for a in it:
        if a == "--check":
            check = True
        elif a == "--width":
            width = int(next(it, "0"))
        elif a == "--tolerance":
            tolerance = int(next(it, "0"))
        elif path is None:
            path = a
        else:
            return None
    if path is None or not width or width < 20:
        return None
    return path, width, tolerance or width + 5, check


def main(argv):
    global WIDTH, TOLERANCE
    try:
        parsed = parse(argv)
    except ValueError:
        parsed = None
    if parsed is None:
        print(__doc__.strip().splitlines()[2], file=sys.stderr)
        return 2
    path, WIDTH, TOLERANCE, check = parsed
    with open(path, encoding="utf-8") as f:
        original = f.read()
    lines = original.rstrip("\n").split("\n")
    out = []
    changed = 0
    for kind, block in blocks(lines):
        new = reflow_block(kind, block)
        if new != block:
            changed += 1
        out.extend(new)
    result = "\n".join(out) + "\n"

    if original.split() != result.split():
        print("reflow would change the words of the draft; nothing written", file=sys.stderr)
        return 2

    long_lines = [(n, len(l)) for n, l in enumerate(result.split("\n"), 1) if len(l) > TOLERANCE]
    for n, length in long_lines:
        print(f"line {n}: {length} characters (over {TOLERANCE}; check for an unbreakable token)")

    if check:
        print(f"{changed} block(s) would be reflowed")
        return 1 if changed or long_lines else 0
    if result != original:
        with open(path, "w", encoding="utf-8") as f:
            f.write(result)
    print(f"reflowed {changed} block(s) in {path}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
