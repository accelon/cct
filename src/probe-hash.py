"""probe-hash.py — 判別 gycd 的 textHash 到底用哪一層正規化

對前 N 個 anchor，用三種輸入各算一次 sha256[:16]，與 gycd csv 的值並列：
  t0  = NFKC + 首個漢字（不做 s2t／VMAP）
  t1  = NFKC + s2t + VMAP（spec §4.4 写的 tier 1）
  raw = 完全不正規化，只去標籤取漢字
"""
import ast
import csv
import hashlib
import re
import sys
import unicodedata

import regex
from opencc import OpenCC

HAN = regex.compile(r"\p{Script=Han}")
CC = OpenCC("s2t")

src = open(r"D:\2026\gycd\interlink-coverage.py", encoding="utf-8").read()
VMAP = ast.literal_eval(re.search(r"^VMAP\s*=\s*(\{.*?^\})", src, re.S | re.M).group(1))


def norm(c: str, tier: int) -> str:
    n = unicodedata.normalize("NFKC", c)
    hs = HAN.findall(n)
    x = hs[0] if hs else c
    if tier >= 1:
        y = CC.convert(x)
        yh = HAN.findall(y)
        x = yh[0] if yh else x
        x = VMAP.get(x, x)
    return x


lines = open("out/13j.xml", encoding="utf-8").read().split("\n")

# tree.tsv 給邊界（line → textEnd），manifest 給 anchorId／我的 hash
bounds = {}
for row in csv.DictReader(open("out/13j-tree.tsv", encoding="utf-8"), delimiter="\t"):
    bounds[int(row["line"])] = int(row["textEnd"])
mine = {}
for row in csv.DictReader(open("out/13j-manifest.tsv", encoding="utf-8"), delimiter="\t"):
    mine[int(row["line"])] = (row["anchorId"], row["work"], row["textHash"])

gycd = {}
for row in csv.DictReader(open(r"D:\2026\gycd\interlink\seg-manifest.csv", encoding="utf-8-sig")):
    gycd[int(row["line"])] = row["textHash"]


def seg_text(ln: int, end: int) -> str:
    residual = (re.search(r"</(?:章|節|項)>(.*)$", lines[ln - 1]) or [None, ""])[1]
    s = residual + "".join(lines[ln:end - 1])
    return "".join(HAN.findall(re.sub(r"<[^>]*>", "", s)))


hit = {"raw": 0, "t0": 0, "t1": 0}
n = 0
shown = 0
for ln in sorted(bounds):
    if ln not in gycd or ln not in mine:
        continue
    n += 1
    chars = seg_text(ln, bounds[ln])
    h_raw = hashlib.sha256(chars.encode("utf-8")).hexdigest()[:16]
    h_t0 = hashlib.sha256("".join(norm(c, 0) for c in chars).encode("utf-8")).hexdigest()[:16]
    h_t1 = hashlib.sha256("".join(norm(c, 1) for c in chars).encode("utf-8")).hexdigest()[:16]
    g = gycd[ln]
    hit["raw"] += h_raw == g
    hit["t0"] += h_t0 == g
    hit["t1"] += h_t1 == g
    if shown < 5:
        shown += 1
        print(f"{mine[ln][0]}({mine[ln][1]}) len={len(chars)}")
        print(f"   gycd={g}\n   raw ={h_raw}\n   t0  ={h_t0}\n   t1  ={h_t1}\n   cct ={mine[ln][2]}")

print(f"\n比對 {n} 條： raw={hit['raw']}  tier0={hit['t0']}  tier1={hit['t1']}")
print(f"opencc={sys.modules['opencc'].__file__}")
