# -*- coding: utf-8 -*-
"""sz-which-txt.py — 找出現行 swjzz.adb 是哪一份文字打包出來的

比對：行數、字頭數、<圖> 數、與 out/swjzz.xml（adb 實解）逐行相同率。
用法：python src/sz-which-txt.py
"""
import io
import os

SHIPPED = "out/swjzz.xml"
CANDS = ["swjz.txt", "swjz2.txt", "swjz-seal.txt", "swjz-punct.txt", "swjzzsrc.txt", "swjz-old.txt"]

ship = io.open(SHIPPED, encoding="utf-8").read().split("\n")
while ship and ship[-1] == "":
    ship.pop()

print(f"adb 實解 {SHIPPED}: {len(ship)} 行, <字 id {sum(1 for l in ship if 'id=\"w' in l)} 行, <圖 {sum(l.count('<圖') for l in ship)} 個")
head_ship = [l for l in ship if 'id="w' in l]

for name in CANDS:
    p = os.path.join(r"D:\2026\swjzz\build", name)
    if not os.path.exists(p):
        print(f"{name}: 不存在")
        continue
    txt = io.open(p, encoding="utf-8").read().split("\n")
    while txt and txt[-1] == "":
        txt.pop()
    heads = [l for l in txt if 'id="w' in l]
    same = sum(1 for a, b in zip(txt, head_ship) if a == b)
    print(f"{name}: {len(txt)} 行, 字頭行 {len(heads)}, <圖 {sum(l.count('<圖') for l in txt)}, "
          f"與 adb 實解前 {len(head_ship)} 行逐字相同 {same}")
