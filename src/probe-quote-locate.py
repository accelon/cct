# -*- coding: utf-8 -*-
"""probe-quote-locate.py — 驗證 xdhycd 書證引文能否在好讀語料中「字元級」定位。

目的：證明「字典引文 → book?chapter#a-b」可行（a-b = 章內漢字序）。
只讀不寫任何既有資料；輸出 out/probe-quote-locate.tsv 與終端摘要。

定位階梯（逐級放寬，前一級失敗才進下一級）：
  L0 精確       引文片段（剝括注、切省略號）在該書漢字流中原樣出現
  L1 異體摺疊   經 char-variant.tsv（語義異體）＋char-fold.tsv（NFKC→OpenCC s2t→VMAP）摺疊後命中
  L2 模糊       摺疊後允許 ≤2 字差（短片段 ≤1）仍按序命中
  未命中         依相似度分「有部分重合」與「幾乎無重合」
另有 title_collision：書名撞名但作者不合（字典引峻青《海嘯》，好讀是田中芳樹），
這類不是找不到，是**不同書**，不進分母。

用法：python src/probe-quote-locate.py [limit]
"""
from __future__ import annotations

import csv
import re
import sys
from collections import defaultdict
from pathlib import Path

CCT = Path(__file__).resolve().parents[1]
BOOKS_DIR = CCT / "raw/haodoo/text/books"
CHAPS_TSV = CCT / "raw/haodoo/manifest/chapters.tsv"
CORPUS_TSV = CCT / "raw/haodoo/manifest/corpus.tsv"
VARIANT_TSV = CCT / "data/char-variant.tsv"
FOLD_TSV = CCT / "data/char-fold.tsv"
QUOTES_CSV = Path("D:/2026/xdhycd/out/quotes/quotes.csv")
OUT_TSV = CCT / "out/probe-quote-locate.tsv"

HAN = re.compile(r"[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]")
ELID = re.compile(r"[…⋯]+|\.{3,}")
PAREN = re.compile(r"[（(][^）)]*[）)]")
GAP = 600  # 省略號兩段之間允許的最大漢字間隔


def han_only(s: str) -> str:
    return "".join(c for c in s if HAN.match(c))


def load_fold() -> dict[str, str]:
    m: dict[str, str] = {}
    for path in (VARIANT_TSV, FOLD_TSV):
        with open(path, encoding="utf-8-sig") as f:
            for line in f:
                if line.startswith("#"):
                    continue
                p = line.rstrip("\n").split("\t")
                if len(p) >= 2 and p[0] and p[1]:
                    m.setdefault(p[0], p[1])
    return m


FOLD: dict[str, str] = {}


def foldstr(s: str) -> str:
    return "".join(FOLD.get(c, c) for c in s)


def load_corpus():
    by_title = defaultdict(list)
    with open(CORPUS_TSV, encoding="utf-8-sig", newline="") as f:
        for row in csv.DictReader(f, delimiter="\t"):
            by_title[row["title"]].append(row)
    return by_title


def load_chapters():
    by_book = defaultdict(list)
    with open(CHAPS_TSV, encoding="utf-8-sig", newline="") as f:
        for row in csv.DictReader(f, delimiter="\t"):
            by_book[row["id"]].append(row)
    for rows in by_book.values():
        rows.sort(key=lambda r: int(r["ch_index"]))
    return by_book


_BOOK_CACHE: dict[str, dict] = {}


def load_book(book_id: str, chapters_by_book) -> dict:
    if book_id in _BOOK_CACHE:
        return _BOOK_CACHE[book_id]
    path = BOOKS_DIR / f"{book_id}.txt"
    text = path.read_text(encoding="utf-8-sig", errors="replace")
    han_chars = [c for c in text if HAN.match(c)]
    han_str = "".join(han_chars)
    rows = chapters_by_book.get(book_id, [])
    bounds = [int(r["char_offset"]) for r in rows] + [len(text)]
    ch_han_start = []
    total = 0
    for i in range(len(rows)):
        ch_han_start.append(total)
        total += sum(1 for c in text[bounds[i]:bounds[i + 1]] if HAN.match(c))
    data = {
        "han_str": han_str,
        "fold_str": foldstr(han_str),
        "ch_rows": rows,
        "ch_han_start": ch_han_start,
    }
    _BOOK_CACHE[book_id] = data
    return data


def _seq_match(hs: str, segs: list[str], maxmis_fn) -> list[tuple[int, int]]:
    """依序（可有間隔）匹配各段；回傳 [(起, 末), …]。maxmis_fn(seg) → 允許字差。"""
    out = []
    first = segs[0]
    pos = hs.find(first) if maxmis_fn(first) == 0 else -1
    if maxmis_fn(first) != 0:
        pos = _fuzzy_first(hs, first, maxmis_fn(first))
    while pos != -1:
        cursor = pos + len(first)
        last_end = cursor
        ok = True
        for s in segs[1:]:
            mm = maxmis_fn(s)
            j = hs.find(s, cursor) if mm == 0 else _fuzzy_first(hs[cursor:], s, mm)
            if mm != 0 and j != -1:
                j += cursor
            if j == -1 or j - cursor > GAP:
                ok = False
                break
            cursor = j + len(s)
            last_end = cursor
        if ok:
            out.append((pos, last_end))
        nxt = hs.find(first, pos + 1) if maxmis_fn(first) == 0 else _fuzzy_first(hs[pos + 1:], first, maxmis_fn(first))
        if maxmis_fn(first) != 0 and nxt != -1:
            nxt += pos + 1
        pos = nxt
    return out


def _fuzzy_first(hs: str, seg: str, maxmis: int) -> int:
    n, m = len(hs), len(seg)
    if m == 0 or m > n:
        return -1
    for i in range(n - m + 1):
        mis = 0
        for j in range(m):
            if hs[i + j] != seg[j]:
                mis += 1
                if mis > maxmis:
                    break
        else:
            return i
    return -1


def chapter_of(data: dict, han_pos: int) -> tuple[int, str]:
    rows = data["ch_rows"]
    starts = data["ch_han_start"]
    ch = 0
    for i, st in enumerate(starts):
        if st <= han_pos:
            ch = i
        else:
            break
    return ch, (rows[ch]["ch_title"] if rows else "")


def main():
    limit = int(sys.argv[1]) if len(sys.argv) > 1 else 0
    global FOLD
    FOLD = load_fold()
    by_title = load_corpus()
    chapters_by_book = load_chapters()
    OUT_TSV.parent.mkdir(parents=True, exist_ok=True)

    stats = defaultdict(int)
    per_book = defaultdict(lambda: defaultdict(int))
    rows_out = []

    with open(QUOTES_CSV, encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        for qi, row in enumerate(reader):
            if limit and qi >= limit:
                break
            title = (row.get("歸併後書名") or row.get("主要書名") or "").strip()
            author = (row.get("作者標記") or "").strip()
            quote = (row.get("引文") or "").strip()
            head = (row.get("字頭") or "").strip()
            if not title or not quote:
                stats["empty"] += 1
                continue
            cands = by_title.get(title, [])
            if not cands:
                stats["title_not_in_haodoo"] += 1
                continue
            # 作者消歧：撞名但作者不合 → 不同書，不進分母
            matched = [c for c in cands if author and c["author"] == author]
            if not matched and len(cands) > 1:
                stats["title_collision"] += 1
                rows_out.append((qi, head, title, author, quote, "title_collision",
                                 "|".join(c["id"] for c in cands), "", "", "", "", "", ""))
                continue
            cand = matched[0] if matched else cands[0]
            book_id = cand["id"]
            stats["in_scope"] += 1

            q2 = PAREN.sub("", quote)
            segs = [han_only(p) for p in ELID.split(q2)]
            segs = [s for s in segs if len(s) >= 2]
            if not segs:
                stats["too_short"] += 1
                rows_out.append((qi, head, title, author, quote, "too_short",
                                 book_id, "", "", "", "", "", ""))
                continue

            data = load_book(book_id, chapters_by_book)

            # L0 精確
            hits = _seq_match(data["han_str"], segs, lambda s: 0)
            level = "L0"
            # L1 異體/簡繁摺疊
            if not hits:
                fsegs = [foldstr(s) for s in segs]
                hits = _seq_match(data["fold_str"], fsegs, lambda s: 0)
                level = "L1"
            # L2 模糊
            if not hits:
                fsegs = [foldstr(s) for s in segs]
                hits = _seq_match(data["fold_str"], fsegs,
                                  lambda s: 1 if len(s) < 6 else 2)
                level = "L2"

            if not hits:
                stats["not_found"] += 1
                rows_out.append((qi, head, title, author, quote, "not_found",
                                 book_id, "", "", "", "", "", ""))
                continue
            a_book, b_book = hits[0]
            ch, ch_title = chapter_of(data, a_book)
            ch_start = data["ch_han_start"][ch]
            a = a_book - ch_start
            b = b_book - ch_start
            status = f"{level}_unique" if len(hits) == 1 else f"{level}_x{len(hits)}"
            stats[f"{level}_{'unique' if len(hits) == 1 else 'multi'}"] += 1
            per_book[book_id][level] += 1
            rows_out.append((qi, head, title, author, quote, status, book_id,
                             ch, ch_title, a, b, len(hits), len("".join(segs))))

    with open(OUT_TSV, "w", encoding="utf-8", newline="") as f:
        w = csv.writer(f, delimiter="\t")
        w.writerow(["qid", "head", "title", "author", "quote", "status", "book_id",
                    "ch_index", "ch_title", "a", "b", "occurrences", "seg_han"])
        for r in rows_out:
            w.writerow(r)

    in_scope = stats["in_scope"]
    located = sum(stats[k] for k in stats if k.startswith(("L0_", "L1_", "L2_")))
    print(f"quotes scanned        : {sum(stats.values())}")
    for k in ("in_scope", "L0_unique", "L0_multi", "L1_unique", "L1_multi",
              "L2_unique", "L2_multi", "not_found", "too_short",
              "title_collision", "title_not_in_haodoo", "empty"):
        if stats[k]:
            print(f"  {k:22s}: {stats[k]}")
    if in_scope:
        print(f"\n字元級定位率（同書引文）  : {located}/{in_scope} = {located / in_scope * 100:.1f}%")
        u = stats["L0_unique"] + stats["L1_unique"] + stats["L2_unique"]
        print(f"唯一命中（可直接發 anchor）: {u}/{in_scope} = {u / in_scope * 100:.1f}%")
    print("\nper-book（前 12，按 L0 命中數）:")
    for bid, d in sorted(per_book.items(), key=lambda kv: -kv[1].get("L0_unique", 0))[:12]:
        print(f"  {bid}: {dict(d)}")
    print(f"\noutput: {OUT_TSV}")


if __name__ == "__main__":
    main()
