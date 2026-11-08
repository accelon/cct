#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""genre-control.py —— 文類控制的歷時比較。

問題：直接按十年算頻率，會把「文類構成變化」誤讀成「語言變化」。
      1970s 幾乎由武俠撐起、1990s 有八成是歷史讀物，兩者的用詞本來就不同。

做法：直接標準化（direct standardization）
  ① 只保留在所有比較年代都有足夠樣本的文類（common support）——沒有共同支撐就不比較。
  ② 以這些文類的合併字數為權重，重算每個年代的「標準化頻率」。
  ③ 同時給出 crude（未控制）與 standardized（已控制）兩條線；
     兩者分道揚鑣，就說明原本的趨勢是文類造成的。

每個頻率都附 Poisson 95% 區間；樣本不足的格子明確標「樣本不足」，不給數字。

用法：
  python src/genre-control.py 小姐 同志
  python src/genre-control.py --min-conf C --min-base 200000 先生
"""
from __future__ import annotations

import argparse
import csv
import math
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BOOK_ERA = ROOT / "out/haodoo-book-era.tsv"
BOOKS = ROOT / "raw/haodoo/manifest/books.tsv"
TEXT_DIR = ROOT / "raw/haodoo/text/books"

Z = 1.96


def load_tsv(path: Path) -> list[dict]:
    with path.open(encoding="utf-8-sig", newline="") as f:
        lines = (ln for ln in f if not ln.startswith("#"))
        return [r for r in csv.DictReader(lines, delimiter="\t") if r]


def decade(y: int) -> str:
    return f"{(y // 10) * 10}s"


def poisson_ci(n: int, base: int) -> tuple[float, float, float]:
    """回傳 (rate, lo, hi)，單位：每百萬字。"""
    if base <= 0:
        return 0.0, 0.0, 0.0
    rate = n / base * 1e6
    se = math.sqrt(n) / base * 1e6 if n > 0 else 0.0
    return rate, max(0.0, rate - Z * se), rate + Z * se


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("terms", nargs="*")
    ap.add_argument("--file")
    ap.add_argument("--min-conf", default="C", choices=["A", "B", "C", "D"])
    ap.add_argument("--min-base", type=int, default=200_000,
                    help="每個「文類×十年」格子的最低字數，低於此不計入")
    ap.add_argument("--compare", nargs=2, metavar=("D1", "D2"),
                    help="指定兩個年代做比較，如 --compare 1930s 2000s；預設取首末可用年代")
    ap.add_argument("--out", default="out/genre-control-report.txt")
    args = ap.parse_args()

    terms = list(args.terms)
    if args.file:
        terms += [ln.strip() for ln in Path(args.file).read_text(encoding="utf-8").splitlines()
                  if ln.strip() and not ln.startswith("#")]
    terms = [t for t in dict.fromkeys(terms) if t]
    if not terms:
        ap.error("請給詞，或用 --file")

    limit = "ABCD".index(args.min_conf)
    era = {}
    for r in load_tsv(BOOK_ERA):
        if (r["era_year"] and r.get("era_class") == "現代"
                and "ABCD".index(r["conf"]) <= limit):
            era[r["book_id"]] = r

    genre_of = {}
    for r in load_tsv(BOOKS):
        genre_of[f"{r['mode']}__{r['code']}"] = (r.get("category") or "").strip() or "未分類"

    chars: dict[str, Counter] = defaultdict(Counter)   # genre -> decade -> chars
    books: dict[str, Counter] = defaultdict(Counter)   # genre -> decade -> count
    counts: dict[str, dict[str, Counter]] = {t: defaultdict(Counter) for t in terms}

    for bid, e in era.items():
        p = TEXT_DIR / f"{bid}.txt"
        if not p.exists():
            continue
        g = genre_of.get(bid, "未分類")
        d = decade(int(e["era_year"]))
        n = int(e["chars"])
        chars[g][d] += n
        books[g][d] += 1
        if not terms:
            continue
        text = p.read_text(encoding="utf-8-sig", errors="replace")
        for t in terms:
            c = text.count(t)
            if c:
                counts[t][g][d] += c

    all_decades = sorted({d for g in chars for d in chars[g]}, key=lambda s: int(s[:-1]))
    genres = sorted(chars)
    total_chars = sum(sum(c.values()) for c in chars.values())

    L: list[str] = []
    rows_out: list[dict] = []
    L.append("=== 文類控制歷時比較 ===")
    L.append(f"範圍：conf≤{args.min_conf}、era_class=現代，{len(era)} 本，"
             f"{total_chars:,} 字；格子門檻 {args.min_base:,} 字")
    L.append("")

    # ---- ① 文類構成漂移：為什麼 crude 會失真 ----
    L.append("① 文類構成（各十年內字數占比，僅列 ≥10% 者）")
    L.append("   十年     主導文類")
    for d in all_decades:
        tot = sum(chars[g][d] for g in genres) or 1
        share = [(g, chars[g][d] / tot) for g in genres if chars[g][d] >= args.min_base]
        share.sort(key=lambda kv: -kv[1])
        txt = "、".join(f"{g} {s * 100:.0f}%" for g, s in share if s >= 0.10)
        L.append(f"   {d:6s} {txt or '（單一樣本，無從比較）'}")
    L.append("")

    # ---- ② 每個詞：crude vs 標準化 ----
    for t in terms:
        L.append(f"② {t}")
        # 可用文類：至少在兩個年代達到門檻
        usable = [g for g in genres
                  if sum(1 for d in all_decades if chars[g][d] >= args.min_base) >= 2]
        if not usable:
            L.append("   沒有任何文類跨兩個年代達到樣本門檻，無法做控制比較。")
            L.append("")
            continue

        # 各文類內的走勢
        for g in usable:
            ds = [d for d in all_decades if chars[g][d] >= args.min_base]
            L.append(f"   ▸ {g}（{len(ds)} 個年代可用）")
            for d in ds:
                n = counts[t][g][d]
                rate, lo, hi = poisson_ci(n, chars[g][d])
                L.append(f"      {d:6s} {n:5d} 次 / {chars[g][d] / 1e4:6.0f}萬字"
                         f"  = {rate:7.1f}  [{lo:.1f}, {hi:.1f}]")

        # 共同支撐：兩個年代都達門檻的文類
        supported = [d for d in all_decades
                     if sum(chars[g][d] for g in genres) >= args.min_base]
        if len(supported) < 2:
            L.append("   ▸ 只有一個年代達到門檻，無法比較。")
            L.append("")
            continue

        pairs = []
        if args.compare:
            a, b = args.compare
            pairs = [(a, b)]
        else:
            pairs = [(supported[0], supported[-1])]

        def rate(n, base):
            return n / base * 1e6 if base else 0.0

        for d1, d2 in pairs:
            common = [g for g in genres
                      if chars[g][d1] >= args.min_base and chars[g][d2] >= args.min_base]
            D1 = next((d for d in all_decades if d == d1), None)
            D2 = next((d for d in all_decades if d == d2), None)
            if D1 is None or D2 is None:
                L.append(f"   ▸ {d1} → {d2}：年代不存在")
                continue
            L.append(f"   ▸ {d1} → {d2}　共同支撐文類：{('、'.join(common)) or '無'}")

            b1 = sum(chars[g][D1] for g in genres)
            b2 = sum(chars[g][D2] for g in genres)
            n1 = sum(counts[t][g][D1] for g in genres)
            n2 = sum(counts[t][g][D2] for g in genres)
            c1, c2 = rate(n1, b1), rate(n2, b2)
            logr = math.log(c2 / c1) if c1 > 0 and c2 > 0 else None
            se = math.sqrt((1 / n1 if n1 else 0) + (1 / n2 if n2 else 0)) if logr else None
            ctxt = (f"比值 {c2 / c1:.2f}×" if logr else "比值不可算（有零）")
            null_evidence = False
            if se:
                lo_r, hi_r = math.exp(logr - Z * se), math.exp(logr + Z * se)
                ctxt += f"  95%CI [{lo_r:.2f}, {hi_r:.2f}]"
                null_evidence = lo_r <= 1.0 <= hi_r
            L.append(f"      crude          {c1:7.1f} → {c2:7.1f}   {ctxt}")
            if null_evidence:
                L.append("      ○ crude 的 95%CI 跨過 1：這兩個年代之間沒有可偵測的差異，"
                         "不宜宣稱「變多」或「變少」。")

            if not common:
                L.append("      ⚠ 兩年代沒有共同文類達門檻——沒有證據可做控制比較，"
                         "上面這條 crude 不能當結論。")
                rows_out.append(dict(term=t, d1=d1, d2=d2, genres="", crude1=f"{c1:.1f}",
                                     crude2=f"{c2:.1f}", crude_ratio=f"{c2/c1:.2f}" if logr else "",
                                     std1="", std2="", std_ratio="", verdict="no-support"))
                continue

            wbase = {g: sum(chars[g][d] for d in (D1, D2)) for g in common}
            wsum = sum(wbase.values())
            s1 = sum(wbase[g] / wsum * rate(counts[t][g][D1], chars[g][D1]) for g in common)
            s2 = sum(wbase[g] / wsum * rate(counts[t][g][D2], chars[g][D2]) for g in common)
            verdict = ""
            if s1 > 0 and s2 > 0:
                L.append(f"      standardized   {s1:7.1f} → {s2:7.1f}   比值 {s2 / s1:.2f}×")
                if null_evidence:
                    verdict = "null"
                    L.append("      ○ 原始差異的 CI 已跨過 1，趨勢判定不成立；"
                             "standardized 比值只作描述，不當結論。")
                elif logr:
                    gap = abs(math.log((c2 / c1) / (s2 / s1)))
                    if gap > math.log(1.5):
                        over = abs(math.log(c2 / c1)) > abs(math.log(s2 / s1))
                        verdict = "confounded-over" if over else "confounded-under"
                        L.append(
                            f"      ⚠ 標準化後比值 {s2 / s1:.2f}× 與 crude {c2 / c1:.2f}× "
                            f"相差超過 1.5 倍：crude {'誇大' if over else '低估'}了變化幅度"
                            f"（文類構成在起作用），應以 standardized 為準。"
                        )
                    else:
                        verdict = "robust"
                        L.append("      ✓ 標準化與 crude 方向、量級一致：變化不太可能只由文類構成解釋。")
            else:
                verdict = "zero"
                L.append("      （標準化後出現零頻，比值不可算）")
            rows_out.append(dict(
                term=t, d1=d1, d2=d2, genres="、".join(common),
                crude1=f"{c1:.1f}", crude2=f"{c2:.1f}",
                crude_ratio=f"{c2/c1:.2f}" if logr else "",
                std1=f"{s1:.1f}" if s1 else "", std2=f"{s2:.1f}" if s2 else "",
                std_ratio=f"{s2/s1:.2f}" if (s1 and s2) else "", verdict=verdict,
            ))

            if len(common) == 1:
                L.append(f"      （僅 {common[0]} 一個文類可比，standardized 即該文類內的頻率）")
        L.append("")

    L.append("方法備註：")
    L.append("  · 標準化是直接標準化，權重取共同支撐文類在全部年代的合併字數。")
    L.append("  · 區間為 Poisson 近似 95% CI；重疊的兩個點不可宣稱有差異。")
    L.append("  · 門檻以下的格子直接不給數字——樣本不足就不要說話。")

    cells_tsv = ROOT / (args.out.rsplit(".", 1)[0] + "-cells.tsv")
    with cells_tsv.open("w", encoding="utf-8", newline="") as f:
        w = csv.writer(f, delimiter="\t")
        w.writerow(["term", "genre", "decade", "count", "chars", "per_million", "ci_lo", "ci_hi"])
        for t in terms:
            for g in genres:
                for d in all_decades:
                    if chars[g][d] < args.min_base:
                        continue
                    n = counts[t][g][d]
                    r, lo, hi = poisson_ci(n, chars[g][d])
                    w.writerow([t, g, d, n, chars[g][d], f"{r:.1f}", f"{lo:.1f}", f"{hi:.1f}"])

    if rows_out:
        tsv = ROOT / (args.out.rsplit(".", 1)[0] + ".tsv")
        with tsv.open("w", encoding="utf-8", newline="") as f:
            w = csv.DictWriter(f, fieldnames=list(rows_out[0].keys()), delimiter="\t")
            w.writeheader()
            w.writerows(rows_out)
        L.append("")
        L.append(f"機器可讀結果：{tsv.name}")

    text = "\n".join(L)
    out = ROOT / args.out
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(text + "\n", encoding="utf-8")
    print(text)


if __name__ == "__main__":
    main()
