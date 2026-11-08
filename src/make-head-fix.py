# -*- coding: utf-8 -*-
"""make-head-fix.py — 用「码位」生成 data/shuowen-head-fix.tsv（罕用字不手打）

教訓：上一版我手打真字，自檢抓出 4 個錯（刘/劉 碼位打錯、兼容碼位 U+2F896 打成了 U+38C7、
`从二` 放錯欄）。所以真字一律由 hex 生成，再讓 verify-head-fix.py 反查。

用法：python src/make-head-fix.py && python src/verify-head-fix.py
"""
import io

# (行號, 現況字頭, 前後文條件, 真字码位 list 或 None, 信心, 說明, 證據出處)
ROWS = [
    (15095, "（图164A-01）", "古文死如此", [0x20481], "high",
     "死 之重文「古文死如此」；另有 𣥴、𠑾 亦古文死", "swjzz variants＋詞典網陳昌治本"),
    (48670, "（图616B-01）", "古文奴", [0x4EC5], "high",
     "奴 之重文「古文奴从人」（人＋又）；注意 仅 是現代簡体常用字，字頭搜尋會導向此條", "swjzz variants"),
    (49760, "（图627A-01）", "古文民", [0x2063D], "high",
     "民 之重文「古文民」", "swjzz variants"),
    (45340, "（图575B-01）", "籒文䲊", [0x29F10], "high",
     "䲊 之籒文", "swjzz variants"),
    (53440, "（图675A-06）", "古文省", [0x27492], "high",
     "蠭 之重文「古文省」（省䖵旁）", "swjzz variants"),
    (58739, "（图746B-01）", "古文申", [0x24C36], "high",
     "申 之古文；籒文申＝U+2245A 是另一筆，勿混", "swjzz variants"),
    (12899, "⿲矢𦣝亏", "古文⿱知白", [0x253FE], "high",
     "𥏼 之古文；現況是把 IDS 拆寫出來", "swjzz variants"),
    (15055, "⿰歹𦟀", "畜産疫病也", [0x3C7B], "high",
     "歺部正篆本字（从歺从羸，郎果切）；現況把构件寫成 IDS", "漢典 zdic ＋ probe2 母字命中"),
    (36693, "（图456A-02）", "古文。", [0x2F896], "high",
     "㣇 之「古文」為 CJK 兼容表意文字 U+2F896（母字已是 U+38C7）→ 兩形同字異码位，anchorId 要用未摺疊原字頭", "swjzz variants"),
    (20966, "（图242B-02）", "古文杶", [0x677B], "contested",
     "資料集作「古文杶=杻」，但段注明說「集韵徑作杻。非也。」→ 作者判", "swjzz variants vs 段注"),
    (56390, "⿰金⿱丣刀", "从金刀", [0x5289], "contested",
     "段注「其義訓殺、則其文定當作劉…今輒更正篆文」；二徐原作 鐂 U+9402；異體字典 A00376 另列 𠭱/𡭈",
     "段注＋教育部異體字字典 A00376"),
    (17881, "（图200B-01）", "籒文𢀩", None, "unencoded",
     "籒文𢀩 从二；資料集 variant 的 wordhead 是空字串 → 形體未編碼，套用圖＋defect 旗標", "swjzz variants（空）"),
    (25634, "（图309A-01）", "象旌旗之游", None, "unencoded",
     "㫃 之古文；資料集 variant wordhead 空", "swjzz variants（空）"),
    (50372, "（图637B-01）", "古文曲", None, "unencoded",
     "曲 之古文（段注：小徐無）；資料集 variant wordhead 空", "swjzz variants（空）"),
    (45315, "\ufffd", "亦古文雲", None, "unencoded",
     "現況字頭是 U+FFFD（轉碼丢字）；該形體未編碼 → 回源檔修轉碼＋改圖，不要猜字", "swjzz variants（空）"),
    (23068, "（图270B-01）", "古文柙", None, "pending",
     "柙 之古文；資料集 柙 條沒有 variants → 待查《汗簡》《古文四聲韻》", "swjzz variants（缺）"),
]

hdr = "line\toldHead\tcontextMustContain\tnewHead\tcodepoint\tconfidence\tnote\tevidence"
out = io.open("data/shuowen-head-fix.tsv", "w", encoding="utf-8", newline="\n")
out.write(hdr + "\n")
for line, old, ctx, cps, conf, note, ev in ROWS:
    head = "".join(chr(c) for c in cps) if cps else ""
    cp = " ".join("U+%04X" % c for c in cps) if cps else ""
    out.write("\t".join([str(line), old, ctx, head, cp, conf, note, ev]) + "\n")
out.close()
print(f"rows={len(ROWS)} 可修={sum(1 for r in ROWS if r[3])} 未編碼/待查={sum(1 for r in ROWS if not r[3])}")
