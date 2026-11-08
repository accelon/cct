#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
attach-era-xout.py — 把年代軸接上 xout（路線圖 ②）

XOUT1 記錄形狀是 spec 定案（11 欄）不動它；年代是「目標作品」級屬性，
所以走 sidecar，兩張表：

  out/haodoo-xout/xout-era.tsv        每桶（=每書）一行：work → 年代＋manifestHash
  out/haodoo-citations-by-era.tsv     每條引證一行：字頭 → 書證按年代排序

字典端的用法：讀 xout_<work>.jsonl 時 join xout-era.tsv（key = work id），
即可把一個字頭的多條書證按時代排列；引證總表已直接排好序，編纂端拿來即用。

口徑與管線其餘部分一致：只出引文＋地址＋書目事實＋年代，不出正文。
"""
from __future__ import annotations

import csv
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ANCHORS = ROOT / "out/haodoo-quote-anchors.tsv"
BOOK_ERA = ROOT / "out/haodoo-book-era.tsv"
XOUT_DIR = ROOT / "out/haodoo-xout"
OUT_ERA = XOUT_DIR / "xout-era.tsv"
OUT_CIT = ROOT / "out/haodoo-citations-by-era.tsv"
OUT_REP = ROOT / "out/attach-era-xout-report.txt"


def load_tsv(path: Path) -> list[dict]:
    with path.open(encoding="utf-8", newline="") as f:
        return list(csv.DictReader(f, delimiter="\t"))


def main() -> None:
    era_by_book: dict[str, dict] = {}
    for r in load_tsv(BOOK_ERA):
        era_by_book[r["book_id"]] = r

    anchors = load_tsv(ANCHORS)

    # ---- 桶側：讀 xout header 對齊 manifestHash／筆數 ----
    buckets: dict[str, dict] = {}
    for p in sorted(XOUT_DIR.glob("xout_*.jsonl")):
        work = p.name[len("xout_"):-len(".jsonl")]
        with p.open(encoding="utf-8") as f:
            header = json.loads(f.readline())
            n = sum(1 for line in f if line.strip())
        buckets[work] = {
            "records": n,
            "manifest_hash": header[3] if len(header) > 3 else "",
            "src_lib": header[4] if len(header) > 4 else "",
        }

    # ---- xout-era.tsv：每桶一行 ----
    era_rows = []
    for work in sorted(buckets):
        e = era_by_book.get(work, {})
        b = buckets[work]
        era_rows.append({
            "work": work,
            "records": b["records"],
            "manifest_hash": b["manifest_hash"],
            "src_lib": b["src_lib"],
            "title": e.get("title", ""),
            "author": e.get("author", ""),
            "era_year": e.get("era_year", ""),
            "era_end": e.get("era_end", ""),
            "era_span": e.get("era_span", ""),
            "era_class": e.get("era_class", ""),
            "conf": e.get("conf", "X"),
            "basis": e.get("basis", ""),
        })
    with OUT_ERA.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(era_rows[0].keys()), delimiter="\t")
        w.writeheader()
        w.writerows(era_rows)

    # ---- citations-by-era.tsv：每條引證一行，按字頭→年代排序 ----
    cit_rows = []
    for a in anchors:
        e = era_by_book.get(a["book_id"], {})
        y = (e.get("era_year") or "").strip()
        cit_rows.append({
            "head": a["head"],
            "qid": a["qid"],
            "quote": a["quote"],
            "target": f"{a['book_id']}?ch{a['ch_index']}#{a['a']}-{a['b']}",
            "book_id": a["book_id"],
            "title": e.get("title", ""),
            "author": e.get("author", ""),
            "era_year": y,
            "era_end": e.get("era_end", ""),
            "era_span": e.get("era_span", ""),
            "era_class": e.get("era_class", ""),
            "conf": e.get("conf", "X"),
            "basis": e.get("basis", ""),
            "decade": f"{(int(y) // 10) * 10}s" if y.isdigit() else "",
            "level": a.get("level", ""),
        })
    cit_rows.sort(key=lambda r: (r["head"],
                                 int(r["era_year"]) if r["era_year"].isdigit() else 9999,
                                 int(r["qid"]) if r["qid"].isdigit() else 0))
    with OUT_CIT.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(cit_rows[0].keys()), delimiter="\t")
        w.writeheader()
        w.writerows(cit_rows)

    # ---- 報告 ----
    L = ["=== attach-era-xout ===",
         f"xout 桶 {len(buckets)} 個 → {OUT_ERA.name}（每桶年代 sidecar）",
         f"引證 {len(cit_rows)} 條 → {OUT_CIT.name}（字頭→年代排序）",
         ""]

    has_era = [r for r in cit_rows if r["era_year"]]
    L.append(f"引證年代覆蓋：{len(has_era)}/{len(cit_rows)} = {len(has_era)/len(cit_rows)*100:.1f}%"
             f"（無年代 {len(cit_rows)-len(has_era)} 條標 conf X，不進排序主體）")
    conf_c = Counter(r["conf"] for r in has_era)
    L.append("年代可信度：" + "｜".join(f"conf {k} {v}" for k, v in sorted(conf_c.items())))

    # 桶側對齊檢查
    era_sum = sum(b["records"] for b in buckets.values())
    L.append(f"桶側記錄數合計 {era_sum}；引證表 {len(cit_rows)} 條"
             + ("（一致）" if era_sum == len(cit_rows) else "（⚠ 不一致）"))

    dec_c = Counter(r["decade"] for r in has_era)
    L.append("")
    L.append("引證按十年分佈：")
    for d in sorted(dec_c, key=lambda s: int(s[:-1])):
        L.append(f"  {d:6s} {dec_c[d]:5d}")

    # 字頭的時代跨度（歷時價值指標）
    by_head: dict[str, list[dict]] = defaultdict(list)
    for r in cit_rows:
        by_head[r["head"]].append(r)

    def span_of(rows: list[dict]) -> int:
        ys = [int(r["era_year"]) for r in rows if r["era_year"].isdigit()]
        return (max(ys) - min(ys)) if len(ys) >= 2 else 0

    def decades_of(rows: list[dict]) -> int:
        return len({r["decade"] for r in rows if r["decade"]})

    multi = [(h, rs) for h, rs in by_head.items() if decades_of(rs) >= 2]
    multi.sort(key=lambda kv: (-decades_of(kv[1]), -span_of(kv[1]), -len(kv[1])))
    L.append("")
    L.append(f"跨 ≥2 個十年的字頭 {len(multi)} 個（歷時書證的直接素材）；"
             f"時代跨度最大的前 12：")
    L.append(f"  {'字頭':8s} {'跨度年':>6s} {'十年數':>5s} {'引證數':>5s}  年代帶")
    for h, rs in multi[:12]:
        ys = sorted(int(r["era_year"]) for r in rs if r["era_year"].isdigit())
        band = f"{ys[0]}–{ys[-1]}"
        L.append(f"  {h:8s} {ys[-1]-ys[0]:6d} {decades_of(rs):5d} {len(rs):5d}  {band}")

    # 範例：取跨度最大的字頭，展示按時代排列的書證
    if multi:
        h, rs = multi[0]
        L.append("")
        L.append(f"範例：字頭「{h}」的書證按時代排列（{len(rs)} 條）：")
        for r in rs[:14]:
            yr = r["era_year"] or "????"
            L.append(f"  [{yr}] {r['target']:28s} conf:{r['conf']}  "
                     f"{(r['quote'] or '')[:30]}")
        if len(rs) > 14:
            L.append(f"  …其餘 {len(rs)-14} 條見 {OUT_CIT.name}")

    L.append("")
    L.append("口徑：只出引文＋地址＋書目事實＋年代，不出正文。")
    rep = "\n".join(L)
    OUT_REP.write_text(rep + "\n", encoding="utf-8")
    print(rep)


if __name__ == "__main__":
    sys.exit(main())
