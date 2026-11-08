# -*- coding: utf-8 -*-
"""sz-json-probe2.py — 結構化取 shuowen 資料集的 wordhead／variants，只輸出码位

用法：python src/sz-json-probe2.py
輸出：out/shuowen-defects-json2.txt
"""
import glob
import io
import json
import os

DATA = r"D:\2026\swjzz\src\shuowen-master\data"
OUT = "out/shuowen-defects-json2.txt"

# (缺陷 id, 線索：要在其說明裡找到的關鍵字, 該字條在 swjzz 的字頭/部)
TARGETS = [
    ("w1040061", "古文⿱知白", "𦣹部"),
    ("w1310000", "畜産疫病也", "歺部"),          # 實為 w1310270
    ("w1310270", "畜産疫病也", "歺部"),
    ("w1320011", "古文死如此", "死部"),
    ("w1460021", "籒文", "左部"),
    ("w2060562", "古文杶", "木部"),
    ("w2064121", "古文柙", "木部"),
    ("w2340011", "古文㫃", "㫃部"),
    ("w3630012", "古文", "㣇部"),
    ("w4230012", "亦古文雲", "雲部"),
    ("w4240021", "籒文", "魚部"),
    ("w4430531", "古文奴", "女部"),
    ("w4450011", "古文民", "民部"),
    ("w4600011", "古文曲", "曲部"),
    ("w4720151", "古文省", "䖵部"),
    ("w4901860", "从金刀", "金部"),
    ("w5360011", "古文申", "申部"),
]

def cps(s):
    if not isinstance(s, str):
        return ""
    return " ".join("U+%04X" % ord(c) for c in s[:12])

def show(s, n=14):
    if not isinstance(s, str):
        return ""
    s = s.replace("\n", " ")
    return s[:n]

out = io.open(OUT, "w", encoding="utf-8")

# 建索引：id → entry
index = {}
for f in glob.glob(os.path.join(DATA, "*.json")):
    try:
        j = json.load(io.open(f, encoding="utf-8"))
    except Exception:
        continue
    if isinstance(j, dict) and "wordhead" in j:
        index[str(j.get("id"))] = j
out.write(f"資料集 entry 數 {len(index)}\n\n")

def explain_of(v):
    """variant 可能是 str（楷化字）或 dict"""
    if isinstance(v, str):
        return v, ""
    if isinstance(v, dict):
        return v.get("wordhead", ""), v.get("explanation", "")
    return "", ""

seen_pairs = set()
for cid, key, bu in TARGETS:
    if cid in seen_pairs:
        continue
    seen_pairs.add(cid)
    out.write(f"[{cid}] 線索「{key}」（{bu}）\n")
    n = 0
    for _id, e in index.items():
        variants = e.get("variants")
        if not variants:
            continue
        for v in variants:
            vh, ve = explain_of(v)
            if not vh:
                continue
            blob = f"{vh} {ve}"
            full = json.dumps(e, ensure_ascii=False)
            if key in blob or (key in full and key in ve):
                out.write(f"    母字「{e['wordhead']}」({cps(e['wordhead'])}) 部 {e.get('radical','')}｜variant「{vh}」({cps(vh)}) 說明「{show(ve, 40)}」\n")
                n += 1
                if n >= 4:
                    break
        if n >= 4:
            break
    if n == 0:
        # 退化：直接搜整個 entry 的 variants 內容
        for _id, e in index.items():
            s = json.dumps(e, ensure_ascii=False)
            if key in s and e.get("radical"):
                vs = e.get("variants") or []
                names = [explain_of(v)[0] for v in vs]
                out.write(f"    （退回全文比對）母字「{e['wordhead']}」{cps(e['wordhead'])} 部「{e.get('radical')}」variants: "
                          + " ".join(f"{x}{cps(x)}" for x in names if x) + "\n")
                n += 1
                if n >= 3:
                    break
    if n == 0:
        out.write("    ✗ 資料集查不到這個形體 → 疑未編碼，需書影／IDS 或《汗簡》《四聲韻》對照\n")
    out.write("\n")
out.close()
print("done")
