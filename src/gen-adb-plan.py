#!/usr/bin/env python3
"""
gen-adb-plan.py — 把 4,163 本好讀書目對應到 18 個 ADB（可重現）

原則（與使用者確認 2026-11-08）：
  - 每個 ADB 約 5 千萬字、< 1 GB。
  - 同一個「好讀分類」不切開；超過 5 千萬字的分類，再依「真實作者」貪心裝箱
    （同作者必在同一箱，箱內作者群即該 ADB 的內容），每箱 ≤ 50,000,000 字。
  - 作者欄位用 books.tsv 的 `author`（4,090/4,259 有值），不用污染的 head_author。

輸出：raw/haodoo/manifest/adb-plan.tsv
  id, mode, code, author, category, chars, adb, dbcname, dbname
此清冊是後續 updb2xml.py 與建置的唯一依據，可重跑、可檢查。
"""
from __future__ import annotations

import csv
import pathlib

ROOT = pathlib.Path("raw/haodoo")
MAN = ROOT / "manifest"
TARGET = 50_000_000

CAT_PREFIX = {
    "武俠": "wuxia",
    "小說園地": "fiction",
    "懸疑奇幻": "mystery",
    "歷史": "history",
    "隨身智囊": "selfhelp",
    "科幻": "scifi",
    "愛情": "romance",
    "(未分類)": "misc",
    "好讀100": "top100",
}
CN_NUM = "〇一二三四五六七八九十"


def cn(i: int) -> str:
    return CN_NUM[i] if 1 <= i <= 10 else str(i)


def main() -> None:
    books = list(csv.DictReader((MAN / "books.tsv").open(encoding="utf-8"), delimiter="\t"))
    corpus = {r["id"]: r for r in csv.DictReader((MAN / "corpus.tsv").open(encoding="utf-8"), delimiter="\t")}

    # (category, author, chars, id, mode, code, title)
    recs = []
    for b in books:
        cid = f"{b['mode']}__{b['code']}"
        c = corpus.get(cid)
        if not c:
            continue
        recs.append((b.get("category", "") or "(未分類)", b.get("author") or "佚名",
                     int(c["cjk_chars"]), cid, b["mode"], b["code"], c.get("title", "")))

    # 依分類分組
    by_cat: dict[str, list] = {}
    for r in recs:
        by_cat.setdefault(r[0], []).append(r)

    plan = []  # 每筆 (category, adb, dbcname, dbname, [recs])
    summary = []

    for cat in sorted(by_cat, key=lambda k: -sum(x[2] for x in by_cat[k])):
        items = by_cat[cat]
        prefix = CAT_PREFIX.get(cat, "cat")
        # 作者層彙總字數
        by_author: dict[str, list] = {}
        for r in items:
            by_author.setdefault(r[1], []).append(r)
        # 作者依總字數降序、同名依作者名升序
        authors = sorted(by_author, key=lambda a: (-sum(x[2] for x in by_author[a]), a))
        # 貪心裝箱（同作者不拆）
        bins: list[list] = []
        cur: list = []
        csum = 0
        for a in authors:
            grp = by_author[a]
            gchars = sum(x[2] for x in grp)
            if cur and csum + gchars > TARGET:
                bins.append(cur)
                cur = []
                csum = 0
            cur.extend(grp)
            csum += gchars
        if cur:
            bins.append(cur)
        # 每箱 → 一個 ADB
        for idx, b in enumerate(bins, 1):
            dbname = f"haodoo-{prefix}-{idx}"
            dbcname = f"好讀．{cat}（{cn(idx)}）"
            plan.append((cat, dbname, dbcname, b))
            summary.append((dbname, dbcname, sum(x[2] for x in b), len(b), len({x[1] for x in b})))

    # 攤平成 adb-plan.tsv
    rows = []
    for cat, dbname, dbcname, b in plan:
        for (c, author, chars, cid, mode, code, title) in sorted(b, key=lambda x: (x[1], x[6], x[4], x[5])):
            rows.append([cid, mode, code, author, cat, chars, dbname, dbcname])

    out = MAN / "adb-plan.tsv"
    with out.open("w", encoding="utf-8", newline="") as f:
        w = csv.writer(f, delimiter="\t", lineterminator="\n")
        w.writerow(["id", "mode", "code", "author", "category", "chars", "adb", "dbcname"])
        w.writerows(rows)

    print(f"寫入 {out}：{len(rows)} 本書 → {len(plan)} 個 ADB")
    print(f"\n{'ADB':<22}{'顯示名':<16}{'字數':>13}{'書':>6}{'作者':>7}")
    tot = 0
    for dbname, dbcname, chars, nbooks, nauth in summary:
        tot += chars
        print(f"{dbname:<22}{dbcname:<16}{chars:>13,}{nbooks:>6}{nauth:>7}")
    print(f"{'合計':<22}{'':<16}{tot:>13,}{len(rows):>6}")


if __name__ == "__main__":
    main()
