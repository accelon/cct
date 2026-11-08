#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""build-era-axis.py —— 为好读语料建「书 → 年代」轴。

三层来源，精度递降：
  1. data/work-years.tsv   成書／初版年           → conf A/B/C，誤差 0–3 年
  2. data/authors-life.tsv 作者生卒推出的活躍期中點 → conf D，誤差 ±15 年
  3. 两者皆無                                       → conf X，不進年代統計

輸出：
  out/haodoo-book-era.tsv    每本书一行（書目事實＋年代判斷＋依據）
  out/haodoo-anchor-era.tsv  每条 anchor 掛上年代（供歷時分析直接吃）
  out/era-axis-report.txt    覆蓋率與分佈報告

不改任何既有檔、不寫 xout、不碰正文。
"""
from __future__ import annotations

import csv
import re
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CORPUS = ROOT / "raw/haodoo/manifest/corpus.tsv"
AUTHORS = ROOT / "data/authors-life.tsv"
WORKS = ROOT / "data/work-years.tsv"
ANCHORS = ROOT / "out/haodoo-quote-anchors.tsv"
OUT_BOOK = ROOT / "out/haodoo-book-era.tsv"
OUT_ANCHOR = ROOT / "out/haodoo-anchor-era.tsv"
OUT_REPORT = ROOT / "out/era-axis-report.txt"

CURRENT_YEAR = 2026

# 作者活躍期假設：20 歲起筆、卒年為終；在世者截到「生年+60」與今年取小
ACTIVE_START_AGE = 25
ACTIVE_SPAN_FOR_LIVING = 60
SPAN_D = 15  # 作者層誤差帶（±年）

SUFFIX = re.compile(r"(主編|選注|選編|校注|校訂|編選|編|著|譯|等|口述|整理)$")
SPLIT = re.compile(r"[、，,／/]")


def load_tsv(path: Path) -> list[dict]:
    rows: list[dict] = []
    with path.open(encoding="utf-8-sig", newline="") as f:
        # 跳過註解行（# 開頭），保留表頭
        lines = (ln for ln in f if not ln.startswith("#"))
        for row in csv.DictReader(lines, delimiter="\t"):
            if row and any((v or "").strip() for v in row.values()):
                rows.append(row)
    return rows


def name_candidates(raw: str) -> list[str]:
    """作者名可能带后缀、也可能是合著／合编，产生若干候选键。"""
    raw = (raw or "").strip()
    if not raw:
        return []
    out: list[str] = [raw]
    stripped = SUFFIX.sub("", raw).strip()
    if stripped and stripped != raw:
        out.append(stripped)
    for part in SPLIT.split(stripped or raw):
        part = part.strip()
        if part:
            out.append(part)
            p2 = SUFFIX.sub("", part).strip()
            if p2 and p2 != part:
                out.append(p2)
    # 去重保序
    seen, uniq = set(), []
    for c in out:
        if c not in seen:
            seen.add(c)
            uniq.append(c)
    return uniq


def decade(y: int) -> str:
    d = (y // 10) * 10
    return f"{d}s"


def era_class(y: int) -> str:
    """歷時分析要先分清語體年代：這批語料主體是 1911 後白話，
    但也混進了少量古籍（元稹、近思錄、古詩十九首），不能混在一條曲線上。"""
    if y >= 1840:
        return "現代"
    if y >= 1644:
        return "近世"
    return "古代"


def main() -> None:
    corpus = load_tsv(CORPUS)
    authors = {r["author"]: r for r in load_tsv(AUTHORS)}
    works = {r["book_id"]: r for r in load_tsv(WORKS)}

    book_era: dict[str, dict] = {}
    stat = Counter()

    for b in corpus:
        bid = b["id"]
        title = (b.get("title") or "").strip()
        author = (b.get("author") or "").strip()
        chars = int(b.get("chars") or 0)

        rec = {
            "book_id": bid,
            "title": title,
            "author": author,
            "chars": chars,
            "era_year": "",
            "era_end": "",
            "era_span": "",
            "era_class": "",
            "conf": "X",
            "basis": "",
            "note": "",
        }

        w = works.get(bid)
        if w and (w.get("year") or "").strip().isdigit():
            y0 = int(w["year"])
            y1 = int((w.get("year_end") or w["year"]).strip() or y0)
            # 語料元數據偶有缺書名（如 book__399《圍城》），用年表的書名補
            if not title:
                title = (w.get("title") or "").strip()
                rec["title"] = title
            if not author:
                author = (w.get("author") or "").strip()
                rec["author"] = author
            rec.update(
                era_year=str((y0 + y1) // 2),
                era_end=str(y1),
                era_span="0" if w.get("conf") == "A" else "3",
                era_class=era_class((y0 + y1) // 2),
                conf=w.get("conf") or "B",
                basis="work",
                note=w.get("note") or "",
            )
            stat[f"work_{rec['conf']}"] += 1
            book_era[bid] = rec
            continue

        hit = None
        for cand in name_candidates(author):
            if cand in authors and (authors[cand].get("birth") or "").strip().isdigit():
                hit = authors[cand]
                break
        if hit:
            birth = int(hit["birth"])
            death_s = (hit.get("death") or "").strip()
            death = int(death_s) if death_s.isdigit() else None
            start = birth + ACTIVE_START_AGE
            end = death if death else min(birth + ACTIVE_SPAN_FOR_LIVING, CURRENT_YEAR)
            if end < start:
                end = start
            rec.update(
                era_year=str((start + end) // 2),
                era_end=str(end),
                era_span=str(SPAN_D),
                era_class=era_class((start + end) // 2),
                conf="D",
                basis="author",
                note=(f"作者生卒 {birth}–{death_s or '在世'}"
                      f"（{hit.get('conf')}）；活躍期 {start}–{end} 取中"),
            )
            stat["author_D"] += 1
            book_era[bid] = rec
            continue

        rec.update(conf="X", basis="none", note="作者生卒與成書年均不可考")
        stat["none_X"] += 1
        book_era[bid] = rec

    # ---- 每條 anchor 掛年代 ----
    anchors = load_tsv(ANCHORS)
    anch_stat = Counter()
    by_decade = Counter()
    by_decade_conf = defaultdict(Counter)
    era_rows = []
    for a in anchors:
        bid = a.get("book_id", "")
        e = book_era.get(bid)
        if not e or not e["era_year"]:
            anch_stat["no_era"] += 1
            era_rows.append({**a, "era_year": "", "conf": "X", "basis": "", "decade": ""})
            continue
        y = int(e["era_year"])
        anch_stat[f"conf_{e['conf']}"] += 1
        if e["era_class"] != "現代":
            anch_stat["pre_modern"] += 1
        else:
            by_decade[decade(y)] += 1
            by_decade_conf[decade(y)][e["conf"]] += 1
        era_rows.append({**a, "era_year": str(y), "conf": e["conf"],
                         "basis": e["basis"], "decade": decade(y)})

    # ---- 輸出 ----
    cols = ["book_id", "title", "author", "chars", "era_year", "era_end",
            "era_span", "era_class", "conf", "basis", "note"]
    with OUT_BOOK.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=cols, delimiter="\t")
        w.writeheader()
        for bid in sorted(book_era):
            w.writerow(book_era[bid])

    acols = list(era_rows[0].keys()) if era_rows else []
    with OUT_ANCHOR.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=acols, delimiter="\t")
        w.writeheader()
        for r in era_rows:
            w.writerow(r)

    total_b = len(book_era)
    dated_b = sum(1 for e in book_era.values() if e["era_year"])
    total_a = len(anchors)
    dated_a = total_a - anch_stat["no_era"]

    rep = []
    rep.append("=== era-axis report ===")
    rep.append(f"書 {total_b}：有年代 {dated_b}（{dated_b / total_b * 100:.1f}%）")
    rep.append(f"  work 層 A {stat['work_A']}／B {stat['work_B']}／C {stat['work_C']}")
    rep.append(f"  author 層 D {stat['author_D']}")
    rep.append(f"  無年代 X {stat['none_X']}")
    rep.append("")
    rep.append(f"anchor {total_a}：可掛年代 {dated_a}（{dated_a / total_a * 100:.1f}%）")
    for k in ("conf_A", "conf_B", "conf_C", "conf_D", "no_era"):
        rep.append(f"  {k:8s} {anch_stat[k]:6d}  {anch_stat[k] / total_a * 100:5.1f}%")
    rep.append(f"  其中非現代（1840 前，如元稹、近思錄）不計入十年分佈：{anch_stat['pre_modern']}")
    rep.append("")
    rep.append("按十年分佈（anchor 數 / 該十年已定年語料字數）與最高可信度：")
    char_by_dec: Counter = Counter()
    for e in book_era.values():
        if e["era_year"] and e["era_class"] == "現代":
            char_by_dec[decade(int(e["era_year"]))] += e["chars"]
    for d in sorted(by_decade, key=lambda s: int(s[:-1])):
        confs = by_decade_conf[d]
        best = min(confs, key=lambda c: "ABCD".index(c)) if confs else "?"
        rep.append(
            f"  {d:6s} {by_decade[d]:5d}  {char_by_dec.get(d, 0) / 1e4:8.1f}萬字  最高 {best}"
        )
    rep.append("")
    rep.append(f"輸出：{OUT_BOOK.name}／{OUT_ANCHOR.name}")
    text = "\n".join(rep)
    OUT_REPORT.write_text(text + "\n", encoding="utf-8")
    print(text)


if __name__ == "__main__":
    main()
