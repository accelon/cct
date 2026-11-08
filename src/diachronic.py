#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""diachronic.py —— 在好讀語料上做「詞語的歷時分佈」查詢。

給定一個或多個詞，輸出：
  ① 逐十年的出現次數與每百萬字頻率（分母＝該十年已定年語料的漢字數）
  ② 首次／末次出現的書證位置（book?ch#a-b，與 xout 同一套地址）
  ③ 按類別（武俠／科幻／言情…）的分解，用來判斷年代差異是不是文類造成的

用法：
  python src/diachronic.py 先生 小姐 同志
  python src/diachronic.py --file terms.txt --min-conf B
  python src/diachronic.py 洋火 --genre

重要方法論限制（輸出也會印）：
  · 這批語料的年代構成極不均衡（1970s 有近一億字，1910s 只有七萬字），
    每百萬字頻率只能當「量級」看，不能當「趨勢」看。
  · 同一 decade 內文類混雜（1970s 幾乎是倪匡支撐），年代差異很容易其實是文類差異。
    因此本工具一律同時輸出文類分解；沒有文類分解支撐的年代差異不應採信。
  · conf D 的年代是作者活躍期中點，誤差 ±15 年，只用於分桶，不可用於精確斷代。
"""
from __future__ import annotations

import argparse
import bisect
import csv
import re
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BOOK_ERA = ROOT / "out/haodoo-book-era.tsv"
CHAPTERS = ROOT / "raw/haodoo/manifest/chapters.tsv"
BOOKS = ROOT / "raw/haodoo/manifest/books.tsv"
TEXT_DIR = ROOT / "raw/haodoo/text/books"

HAN = re.compile(r"[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]")


def load_tsv(path: Path) -> list[dict]:
    with path.open(encoding="utf-8-sig", newline="") as f:
        lines = (ln for ln in f if not ln.startswith("#"))
        return [r for r in csv.DictReader(lines, delimiter="\t") if r]


def decade(y: int) -> str:
    return f"{(y // 10) * 10}s"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("terms", nargs="*", help="要查的詞（漢字）")
    ap.add_argument("--file", help="從檔案讀詞，一行一個")
    ap.add_argument("--min-conf", default="B",
                    choices=["A", "B", "C", "D"],
                    help="只用可信度不低於此級的書（A 最嚴）")
    ap.add_argument("--genre", action="store_true", help="輸出文類分解")
    ap.add_argument("--min-year", type=int, default=1840)
    ap.add_argument("--author", help="只查某位作者（控制作者變量，避免文類／年代混淆）")
    ap.add_argument("--by-book", action="store_true", help="逐書列出命中次數")
    ap.add_argument("--out", default="out/diachronic-report.txt")
    args = ap.parse_args()

    terms = list(args.terms)
    if args.file:
        terms += [ln.strip() for ln in Path(args.file).read_text(encoding="utf-8").splitlines()
                  if ln.strip() and not ln.startswith("#")]
    terms = [t for t in dict.fromkeys(terms) if t]
    if not terms:
        ap.error("請給詞，或用 --file")

    order = "ABCD"
    limit = order.index(args.min_conf)

    era: dict[str, dict] = {}
    for r in load_tsv(BOOK_ERA):
        if r["era_year"] and r.get("era_class") == "現代" \
                and order.index(r["conf"]) <= limit \
                and int(r["era_year"]) >= args.min_year:
            era[r["book_id"]] = r
    if args.author:
        era = {k: v for k, v in era.items() if args.author in (v.get("author") or "")}
        if not era:
            ap.error(f"沒有符合 --author {args.author} 的已定年書")
    # corpus 的 id = mode + "__" + code（book__437 / share__09D3），據此接文類
    genre: dict[str, str] = {}
    for r in load_tsv(BOOKS):
        genre[f"{r['mode']}__{r['code']}"] = (r.get("category") or "").strip()
    genre = {bid: genre.get(bid, "") for bid in era}

    ch_offsets: dict[str, list[int]] = defaultdict(list)
    for r in load_tsv(CHAPTERS):
        if r["id"] in era:
            ch_offsets[r["id"]].append(int(r["char_offset"]))
    for v in ch_offsets.values():
        v.sort()

    chars_by_dec: Counter = Counter()
    genre_chars: dict[str, Counter] = defaultdict(Counter)
    for bid, e in era.items():
        d = decade(int(e["era_year"]))
        n = int(e["chars"])
        chars_by_dec[d] += n
        genre_chars[d][genre.get(bid, "")] += n

    counts: dict[str, Counter] = {t: Counter() for t in terms}
    gcounts: dict[str, dict[str, Counter]] = {t: defaultdict(Counter) for t in terms}
    bcounts: dict[str, Counter] = {t: Counter() for t in terms}
    first: dict[str, tuple] = {}
    last: dict[str, tuple] = {}

    def anchor_at(bid: str, text: str, i: int, tlen: int) -> str:
        offs = ch_offsets.get(bid) or [0]
        k = bisect.bisect_right(offs, i) - 1
        if k < 0:
            k = 0
        ch_start = offs[k]
        a = len(HAN.findall(text[ch_start:i]))
        return f"{bid}?ch{k}#{a}-{a + tlen}"

    for bid, e in era.items():
        p = TEXT_DIR / f"{bid}.txt"
        if not p.exists():
            continue
        text = p.read_text(encoding="utf-8-sig", errors="replace")
        y = int(e["era_year"])
        d = decade(y)
        g = genre.get(bid, "")
        for t in terms:
            c = text.count(t)
            if not c:
                continue
            counts[t][d] += c
            gcounts[t][d][g] += c
            bcounts[t][bid] = c
            i0 = text.find(t)
            if t not in first or y < first[t][0]:
                first[t] = (y, anchor_at(bid, text, i0, len(t)), e["title"], e["author"], e["conf"])
            i1 = text.rfind(t)
            if t not in last or y > last[t][0]:
                last[t] = (y, anchor_at(bid, text, i1, len(t)), e["title"], e["author"], e["conf"])

    decades = sorted(chars_by_dec, key=lambda s: int(s[:-1]))
    lines: list[str] = []
    lines.append("=== 歷時分佈查詢 ===")
    lines.append(f"範圍：已定年且 era_class=現代、conf≤{args.min_conf} 的書 {len(era)} 本，"
                 f"漢字基數 {sum(chars_by_dec.values()):,}")
    lines.append(f"十年基數：{', '.join(f'{d}:{chars_by_dec[d]/1e4:.0f}萬' for d in decades)}")
    lines.append("")

    for t in terms:
        lines.append(f"■ {t}   總計 {sum(counts[t].values())} 次")
        lines.append("  十年      次數    每百萬字   該十年文類構成")
        for d in decades:
            n = counts[t][d]
            base = chars_by_dec[d] or 1
            gs = sorted(genre_chars[d].items(), key=lambda kv: -kv[1])[:3]
            gtxt = "、".join(f"{k or '未分類'} {v / chars_by_dec[d] * 100:.0f}%" for k, v in gs)
            lines.append(f"  {d:6s} {n:6d}  {n / base * 1e6:9.2f}   {gtxt}")
        if t in first:
            y, anc, title, author, conf = first[t]
            lines.append(f"  首見 {y}：《{title}》{author}（conf {conf}）  {anc}")
            y, anc, title, author, conf = last[t]
            lines.append(f"  末見 {y}：《{title}》{author}（conf {conf}）  {anc}")
        if args.by_book:
            rows = sorted(((int(era[bid]["era_year"]), era[bid]["title"], n, era[bid]["conf"])
                           for bid, n in bcounts[t].items()), key=lambda x: x[0])
            lines.append("  逐書：")
            for y, title, n, conf in rows:
                lines.append(f"    {y}  {n:5d}  《{title}》  conf {conf}")
        if args.genre:
            lines.append("  文類分解：")
            gs = Counter()
            for d in decades:
                for g, n in gcounts[t][d].items():
                    gs[g] += n
            for g, n in gs.most_common():
                lines.append(f"    {g or '未分類':10s} {n}")
        lines.append("")

    lines.append("注意：")
    lines.append("  · 各十年語料量相差三個數量級，每百萬字頻率只可用來看量級，不可直接讀成趨勢。")
    lines.append("  · 年代差異須以同文類內的比較佐證；否則很可能是文類構成變化，而非語言變化。")
    lines.append("  · conf D 的年代誤差 ±15 年，只用於分桶。")

    text = "\n".join(lines)
    out = ROOT / args.out
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(text + "\n", encoding="utf-8")
    print(text)


if __name__ == "__main__":
    main()
