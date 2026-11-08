# -*- coding: utf-8 -*-
"""sz-variant-join.py — 用「母字」精確 join 資料集的 variants，定出 16 個缺陷字頭的真字

步驟：
  1) 從 out/swjzz.xml 找每個缺陷條目的「母字」＝同部內最近一個 id 末位為 0 的字頭
  2) 拿母字到 shuowen 資料集比對 wordhead，列出它的 variants（含码位與說明）
  3) 用該條目自己的說明句（古文X／籒文X…）在 variants 裡挑對應的那一個

用法：python src/sz-variant-join.py
輸出：out/shuowen-defects-join.txt
"""
import glob
import io
import json
import os
import re

lines = io.open("out/swjzz.xml", encoding="utf-8").read().split("\n")
out = io.open("out/shuowen-defects-join.txt", "w", encoding="utf-8")

def w(s=""):
    out.write(s + "\n")

def cps(s):
    return " ".join("U+%04X" % ord(c) for c in s) if s else "(空)"

HEAD = re.compile(r'<字[^>]*\sid="(w\d{7})"[^>]*>([\s\S]*?)</字>')
entries = []          # (id, head, line)
for i, l in enumerate(lines):
    m = HEAD.search(l)
    if m and "id=" in m.group(0):
        entries.append((m.group(1), m.group(2), i + 1))
byid = {e[0]: e for e in entries}

# 母字：往回找最近一個末位 0 的條目
def mother(cid):
    idx = next((k for k, e in enumerate(entries) if e[0] == cid), None)
    if idx is None:
        return None
    for k in range(idx, -1, -1):
        eid, head, _ = entries[k]
        if eid.endswith("0"):
            return eid, head
    return None

# 資料集：wordhead → variants
DATA = r"D:\2026\swjzz\src\shuowen-master\data"
wd_map = {}
for f in glob.glob(os.path.join(DATA, "*.json")):
    try:
        j = json.load(io.open(f, encoding="utf-8"))
    except Exception:
        continue
    if isinstance(j, dict) and "wordhead" in j:
        wd_map.setdefault(j["wordhead"], []).append(j)
w(f"資料集 wordhead 索引數 {len(wd_map)}；swjzz 字條 {len(entries)}\n")

TARGETS = ["w1040061", "w1310270", "w1320011", "w1460021", "w2060562", "w2064121",
           "w2340011", "w3630012", "w4230012", "w4240021", "w4430531", "w4450011",
           "w4600011", "w4720151", "w4901860", "w5360011"]

for cid in TARGETS:
    if cid not in byid:
        w(f"[{cid}] swjzz 查無此 id")
        continue
    head = byid[cid][1]
    mo = mother(cid)
    mom_id, mom_head = (mo if mo else ("?", "?"))
    # 該條目的說明句
    ln = byid[cid][2]
    doc = ""
    for j in range(ln, min(ln + 8, len(lines))):
        mm = re.search(r"<(說文異|說文|段注)>([\s\S]*?)</\1>", lines[j])
        if mm:
            doc += mm.group(2)
        if HEAD.search(lines[j]):
            break
    w(f"[{cid}] 現字頭「{head}」 母字「{mom_head}」({cps(mom_head)}) {mom_id}")
    w(f"    說明句：{doc[:78]}")
    cands = wd_map.get(mom_head, [])
    if not cands:
        w("    → 資料集無此母字（楷化形不同或未收）")
    for e in cands:
        vs = e.get("variants") or []
        w(f"    資料集母字「{e['wordhead']}」部「{e.get('radical')}」 說明「{(e.get('explanation') or '')[:40]}」")
        for v in vs:
            vh, ve = (v, "") if isinstance(v, str) else (v.get("wordhead", ""), v.get("explanation", ""))
            w(f"        variant「{vh}」 {cps(vh)}  「{ve[:40]}」")
    w("")
out.close()
print("done")
