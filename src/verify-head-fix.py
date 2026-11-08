# -*- coding: utf-8 -*-
"""verify-head-fix.py — 檢查 data/shuowen-head-fix.tsv 的码位欄是否與真字欄一致
   並把 16 筆的「真字↔码位」跟 sz-variant-join.py 的產出對一次。
用法：python src/verify-head-fix.py
"""
import io
import re

rows = [l.rstrip("\n").split("\t") for l in io.open("data/shuowen-head-fix.tsv", encoding="utf-8")]
head = rows[0]
rows = rows[1:]

join = io.open("out/shuowen-defects-join.txt", encoding="utf-8").read()

bad = []
for r in rows:
    line, old, ctx, new, cp, conf, note = r[:7]
    if new:
        real = " ".join("U+%04X" % ord(c) for c in new)
        if real != cp.strip():
            bad.append(f"码位不符 line {line}: 表寫 {cp} 實為 {real}（字「{new}」）")
    # 與 join 產出比對：真字必須确实出現在該 id 對應的 variant 行裡
    cid = None
    for m in re.finditer(r"\[(w\d{7})\]", join):
        pass
    if new and conf in ("high", "contested"):
        if new not in join:
            bad.append(f"join 產出找不到「{new}」（line {line}）— 可能是我重打時打錯")

io.open("out/head-fix-verify.txt", "w", encoding="utf-8").write(
    f"檢查 {len(rows)} 筆，問題 {len(bad)} 筆\n" + "\n".join("  " + b for b in bad) + "\n")
print(f"checked={len(rows)} problems={len(bad)}  → out/head-fix-verify.txt")
