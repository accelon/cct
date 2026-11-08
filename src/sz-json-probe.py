# -*- coding: utf-8 -*-
"""sz-json-probe.py — 用 swjzz 區現成的 shuowen 資料集查那 16 個缺陷字頭的真字

兩步：
  1) 摸 data/1.json 的結構（鍵、範例值）
  2) 掃全部 data/*.json，用「定義句」找對應的字頭字元與码位

用法：python src/sz-json-probe.py
輸出：out/shuowen-defects-json.txt
"""
import glob
import io
import json
import os
import re

DATA = r"D:\2026\swjzz\src\shuowen-master\data"
OUT = "out/shuowen-defects-json.txt"

out = io.open(OUT, "w", encoding="utf-8")
def w(s):
    out.write(s + "\n")

# ---------- 1) 結構 ----------
p1 = os.path.join(DATA, "1.json")
d = json.load(io.open(p1, encoding="utf-8"))
w("=== data/1.json 結構 ===")
if isinstance(d, dict):
    w(f"型別 dict，鍵數 {len(d)}，前 8 鍵 {list(d.keys())[:8]}")
    for k in list(d.keys())[:3]:
        w(f"  [{k}] = {json.dumps(d[k], ensure_ascii=False)[:300]}")
elif isinstance(d, list):
    w(f"型別 list，長度 {len(d)}")
    for x in d[:3]:
        w(f"  {json.dumps(x, ensure_ascii=False)[:300]}")
w("")

# ---------- 2) 把整個資料集攤平成 (字頭, 全文) ----------
def flatten(x):
    """回傳這個 entry 裡所有字串（說解、重文…）"""
    buf = []
    def rec(v):
        if isinstance(v, str):
            buf.append(v)
        elif isinstance(v, list):
            for i in v:
                rec(i)
        elif isinstance(v, dict):
            for k, i in v.items():
                if isinstance(k, str):
                    buf.append(k)
                rec(i)
    rec(x)
    return buf

entries = []
files = sorted(glob.glob(os.path.join(DATA, "*.json")))
for f in files:
    try:
        j = json.load(io.open(f, encoding="utf-8"))
    except Exception:
        continue
    if isinstance(j, dict):
        for k, v in j.items():
            entries.append((k, " ".join(flatten([v]))))
    elif isinstance(j, list):
        for v in j:
            ks = [x for x in flatten([v]) if len(x) == 1]
            entries.append((ks[0] if ks else "", " ".join(flatten([v]))))
w(f"攤平 entry 數 {len(entries)}（來自 {len(files)} 個 json）")
w("")

# ---------- 3) 用缺陷檔的定義句去搜 ----------
phrases = [
    ("w1040061", ["古文⿱知白", "知白", "𦣹"]),
    ("w1310270", ["畜產疫病", "畜産疫病"]),
    ("w1320011", ["古文死如此"]),
    ("w1460021", ["籒文𢀩", "籒文𢀂"]),
    ("w2060562", ["古文杶"]),
    ("w2064121", ["古文柙"]),
    ("w2340011", ["象旌旗之游"]),
    ("w3630012", ["㣇"]),
    ("w4230012", ["亦古文雲", "古文雲"]),
    ("w4240021", ["籒文䲊", "籒文鱾"]),
    ("w4430531", ["古文奴"]),
    ("w4450011", ["古文民"]),
    ("w4600011", ["古文曲"]),
    ("w4720151", ["古文省"]),
    ("w4901860", ["从金刀", "從金刀"]),
    ("w5360011", ["古文申"]),
]

def cp(s):
    return " ".join("U+%04X" % ord(c) for c in s)

w("=== 逐筆搜（定義句 → 資料集字頭）===")
for cid, keys in phrases:
    hits = []
    for head, text in entries:
        for k in keys:
            if k and k in text:
                hits.append((head, k, text[:110]))
                break
    uniq = {}
    for h, k, t in hits:
        uniq.setdefault(h, (k, t))
    w(f"[{cid}] 查 {keys} → 命中 {len(uniq)} 個字頭")
    for h, (k, t) in list(uniq.items())[:6]:
        w(f"    字頭「{h}」 {cp(h)}｜命中片語「{k}」｜{t}")
    if not uniq:
        w("    （資料集查不到 → 該形體可能未編碼，需靠書影／IDS）")
out.close()
print("done")
