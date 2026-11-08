"""probe-table.py — 用 cct 產出的 data/char-fold.tsv 重算 hash，判別錯在表還是在 TS
"""
import csv
import hashlib
import re

import regex

HAN = regex.compile(r"\p{Script=Han}")

fold = {}
with open("data/char-fold.tsv", encoding="utf-8") as fh:
    for line in fh:
        if line.startswith("#") or not line.strip():
            continue
        a, _, b = line.rstrip("\n").partition("\t")
        fold[a] = b

lines = open("out/13j.xml", encoding="utf-8").read().split("\n")
bounds, mine = {}, {}
for row in csv.DictReader(open("out/13j-tree.tsv", encoding="utf-8"), delimiter="\t"):
    bounds[int(row["line"])] = int(row["textEnd"])
for row in csv.DictReader(open("out/13j-manifest.tsv", encoding="utf-8"), delimiter="\t"):
    mine[int(row["line"])] = row["textHash"]
gycd = {}
for row in csv.DictReader(open(r"D:\2026\gycd\interlink\seg-manifest.csv", encoding="utf-8-sig")):
    gycd[int(row["line"])] = row["textHash"]


def seg_text(ln, end):
    residual = (re.search(r"</(?:章|節|項)>(.*)$", lines[ln - 1]) or [None, ""])[1]
    s = residual + "".join(lines[ln:end - 1])
    return "".join(HAN.findall(re.sub(r"<[^>]*>", "", s)))


eq_gycd = eq_cct = miss = n = 0
first = None
for ln in sorted(bounds):
    if ln not in gycd or ln not in mine:
        continue
    n += 1
    chars = seg_text(ln, bounds[ln])
    buf = []
    for c in chars:
        if c in fold:
            buf.append(fold[c])
        else:
            miss += 1
            buf.append(c)
    h = hashlib.sha256("".join(buf).encode("utf-8")).hexdigest()[:16]
    eq_gycd += h == gycd[ln]
    eq_cct += h == mine[ln]
    if first is None and h != mine[ln]:
        first = (ln, chars[:12], "".join(fold.get(c, c) for c in chars[:12]), gycd[ln], mine[ln], h)

print(f"anchor={n}  表查不到字={miss}")
print(f"用 cct 表算 → 等於 gycd: {eq_gycd}   等於 cct TS 輸出: {eq_cct}")
if first:
    ln, raw, folded, g, m, h = first
    print(f"第一例 line {ln}: raw前12={raw}  摺疊後={folded}")
    print(f"   gycd={g} cctTS={m} python用表={h}")
print("表內範例:", [(k, fold[k]) for k in list(fold)[:8]])
