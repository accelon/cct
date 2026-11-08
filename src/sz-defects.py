# -*- coding: utf-8 -*-
"""sz-defects.py — 量 swjzz（與 swjz）現存的字頭缺陷

用法：python src/sz-defects.py swjzz
輸出：out/<adb>-defects.txt
"""
import csv
import io
import os
import re
import sys

adb = sys.argv[1] if len(sys.argv) > 1 else "swjzz"
path = f"out/{adb}-char.tsv"
if not os.path.exists(path):
    sys.exit(f"找不到 {path}（先跑 build-zone-manifest）")

rows = list(csv.DictReader(io.open(path, encoding="utf-8"), delimiter="\t"))
multi = [r for r in rows if len(r["head"]) > 1]
paren = [r for r in rows if re.search(r"[（(]", r["head"])]
ids = [r for r in rows if re.search(r"[\u2ff0-\u2ffb]", r["head"])]
tuhao = [r for r in rows if "\u56fe" in r["head"] or re.search(r"[A-Za-z0-9]-\d\d", r["head"])]
fffd = [r for r in rows if "\ufffd" in r["head"]]
pua = [r for r in rows if re.search(r"[\ue000-\uf8ff]", r["head"])]
empty = [r for r in rows if not r["head"].strip()]

out = io.open(f"out/{adb}-defects.txt", "w", encoding="utf-8")
out.write(f"=== {adb} 字頭缺陷（來源 {path}）===\n")
out.write(f"字頭總數 {len(rows)}\n")
for name, arr in [("多码点", multi), ("含括号", paren), ("含 IDS 构形符", ids),
                  ("像图号/ASCII", tuhao), ("U+FFFD 替换符", fffd), ("PUA 私用区", pua),
                  ("空字头", empty)]:
    out.write(f"{name}: {len(arr)}\n")

out.write("\n多码点例子（前 15）:\n")
for r in multi[:15]:
    out.write(f"  {r['charId']} 「{r['head']}」 han {r['hanCount']} img {r.get('img','')}\n")
out.write("\n含括号例子（前 12）:\n")
for r in paren[:12]:
    out.write(f"  {r['charId']} 「{r['head']}」\n")
out.write("\nFFFD／PUA／空（前 12）:\n")
for r in (fffd + pua + empty)[:12]:
    out.write(f"  {r['charId']} 「{r['head']}」 cp {[hex(ord(c)) for c in r['head']]}\n")
out.write("\nzone 数为 0 的字条（无法定位例）: ")
zero = [r for r in rows if r.get("zoneBlocks") in ("0", "")]
out.write(f"{len(zero)}\n")
out.close()
print(f"{adb}: heads={len(rows)} multi={len(multi)} paren={len(paren)} ids={len(ids)} tuhao={len(tuhao)} fffd={len(fffd)} pua={len(pua)} empty={len(empty)}")
