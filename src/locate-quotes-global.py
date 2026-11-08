# -*- coding: utf-8 -*-
"""locate-quotes-global.py — 把 xdhycd 現代書證引文在好讀 6.3 億字全庫做字元級回定位。

目的：不依賴書目配對，直接把引文句子丟進 4,163 本全文搜尋，補上 86,440 次
「接不住」的現代引文（異稱、合集收錄、讀者分享書都能被撈回來）。

設計：
  探針   每個引文取第一個 ≥8 字片段的中段 8-gram（loc 折疊後）→ 找候選書
         （若片段真在書中，其 8-gram 必在 → L0/L1 召回完整）
  階梯   候選書內：L0 原字精確 → L1 折疊精確 → L2 模糊（L2 僅限書目命中書）
  判級   全庫唯一 / 撞名書偏好 → 發 anchor；多處 → 只記錄不發
  口徑   漢字流 = BMP CJK（與 probe-quote-locate.py 一致）；a-b = 章內漢字序 [a,b)

折疊：
  loc  = char-variant.tsv + char-fold.tsv + NFKC 兜底（召回優先，定位用）
  hash = char-fold.tsv + NFKC 兜底（spec §4.4；textHash 見 build-haodoo-xout.py）

用法：python src/locate-quotes-global.py [--limit N] [--books N]
輸出：out/locate-quotes-global.tsv、out/locate-quotes-global-report.txt
不改任何既有檔。
"""
from __future__ import annotations

import argparse
import bisect
import csv
import re
import time
import unicodedata
from collections import defaultdict
from pathlib import Path

CCT = Path(__file__).resolve().parents[1]
BOOKS_DIR = CCT / "raw/haodoo/text/books"
CHAPS_TSV = CCT / "raw/haodoo/manifest/chapters.tsv"
CORPUS_TSV = CCT / "raw/haodoo/manifest/corpus.tsv"
VARIANT_TSV = CCT / "data/char-variant.tsv"
FOLD_TSV = CCT / "data/char-fold.tsv"
QUOTES_CSV = Path("D:/2026/xdhycd/out/quotes/quotes.csv")
OUT_TSV = CCT / "out/locate-quotes-global.tsv"
OUT_REPORT = CCT / "out/locate-quotes-global-report.txt"

HAN = re.compile(r"[㐀-䶿一-鿿豈-﫿]")
HAN_ANY = re.compile(
    "[㐀-䶿一-鿿豈-﫿"
    "\U00020000-\U0002A6DF\U0002A700-\U0002EBEF\U0002F800-\U0002FA1F\U00030000-\U0003134A]"
)
ELID = re.compile(r"[…⋯]+|\.{3,}")
PAREN = re.compile(r"[（(][^）)]*[）)]")
GAP = 600
PROBE_N = 8
MODERN_TYPES = ("現代專書／單篇", "無標題")


def _load_map(path: Path) -> dict[str, str]:
    m: dict[str, str] = {}
    with open(path, encoding="utf-8-sig") as f:
        for line in f:
            if line.startswith("#"):
                continue
            p = line.rstrip("\n").split("\t")
            if len(p) >= 2 and p[0] and p[1]:
                m.setdefault(p[0], p[1])
    return m


def _nfkc_first_han(c: str) -> str:
    s = unicodedata.normalize("NFKC", c)
    for ch in s:
        if HAN_ANY.match(ch):
            return ch
    return c


def build_translate(src: dict[str, str]) -> dict[int, str]:
    table: dict[int, str] = {}
    for cp in range(0x10000):
        c = chr(cp)
        f = src.get(c)
        if f is None:
            f = _nfkc_first_han(c)
        if f != c:
            table[cp] = f
    return table


def han_only(s: str) -> str:
    return "".join(c for c in s if HAN.match(c))


def all_positions(hs: str, s: str) -> list[int]:
    out: list[int] = []
    j = hs.find(s)
    while j != -1:
        out.append(j)
        j = hs.find(s, j + 1)
    return out


def seq_exact(hs: str, segs: list[str], gap: int = GAP) -> list[tuple[int, int]]:
    """各段依序出現（段間 ≤ gap）→ [(起, 末半開), …]。以位置清單合併，抗常見首段。"""
    lists: list[list[int]] = []
    for s in segs:
        ps = all_positions(hs, s)
        if not ps:
            return []
        lists.append(ps)
    spans: list[tuple[int, int]] = []
    for p0 in lists[0]:
        cur = p0 + len(segs[0])
        end = cur
        ok = True
        for si in range(1, len(segs)):
            ps = lists[si]
            k = bisect.bisect_left(ps, cur)
            if k == len(ps) or ps[k] - cur > gap:
                ok = False
                break
            cur = ps[k] + len(segs[si])
            end = cur
        if ok:
            spans.append((p0, end))
    return spans


def _fuzzy_first(hs: str, seg: str, maxmis: int, start: int = 0) -> int:
    n, m = len(hs), len(seg)
    if m == 0 or m > n - start:
        return -1
    for i in range(start, n - m + 1):
        mis = 0
        for j in range(m):
            if hs[i + j] != seg[j]:
                mis += 1
                if mis > maxmis:
                    break
        else:
            return i
    return -1


def seq_fuzzy(hs: str, segs: list[str], gap: int = GAP) -> list[tuple[int, int]]:
    def mm(s: str) -> int:
        return 1 if len(s) < 6 else 2

    spans: list[tuple[int, int]] = []
    first = segs[0]
    pos = _fuzzy_first(hs, first, mm(first))
    guard = 0
    while pos != -1 and guard < 2000:
        guard += 1
        cursor = pos + len(first)
        end = cursor
        ok = True
        for s in segs[1:]:
            j = _fuzzy_first(hs, s, mm(s), cursor)
            if j == -1 or j - cursor > gap:
                ok = False
                break
            cursor = j + len(s)
            end = cursor
        if ok:
            spans.append((pos, end))
        pos = _fuzzy_first(hs, first, mm(first), pos + 1)
    return spans


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--books", type=int, default=0)
    args = ap.parse_args()
    t0 = time.time()

    # variant 優先（與 probe-quote-locate.py 的 setdefault 序一致）
    loc_src = {**_load_map(FOLD_TSV), **_load_map(VARIANT_TSV)}
    loc_tbl = build_translate(loc_src)
    print(f"fold：variant+fold {len(loc_src)} 條，translate {len(loc_tbl)} 條")

    books: list[dict] = []
    with open(CORPUS_TSV, encoding="utf-8-sig", newline="") as f:
        for row in csv.DictReader(f, delimiter="\t"):
            books.append(row)
    if args.books:
        books = books[: args.books]
    book_by_id = {b["id"]: b for b in books}

    chapters_by_book: dict[str, list[dict]] = defaultdict(list)
    with open(CHAPS_TSV, encoding="utf-8-sig", newline="") as f:
        for row in csv.DictReader(f, delimiter="\t"):
            chapters_by_book[row["id"]].append(row)
    for rows in chapters_by_book.values():
        rows.sort(key=lambda r: int(r["ch_index"]))

    quotes: list[dict] = []
    probe_owner: dict[str, list[int]] = defaultdict(list)
    with open(QUOTES_CSV, encoding="utf-8-sig", newline="") as f:
        for row in csv.DictReader(f):
            if row.get("標題類型") not in MODERN_TYPES:
                continue
            qid = int(row["序號"])
            if args.limit and qid >= args.limit:
                break
            title = (row.get("歸併後書名") or row.get("主要書名") or "").strip()
            author = (row.get("作者標記") or "").strip()
            quote = (row.get("引文") or "").strip()
            head = (row.get("字頭") or "").strip()
            q2 = PAREN.sub("", quote)
            segs = [han_only(p) for p in ELID.split(q2)]
            segs = [s for s in segs if len(s) >= 2]
            fsegs = [s.translate(loc_tbl) for s in segs]
            probe = None
            for s in fsegs:
                if len(s) >= PROBE_N:
                    probe = s[(len(s) - PROBE_N) // 2: (len(s) - PROBE_N) // 2 + PROBE_N]
                    break
            if probe is not None:
                probe_owner[probe].append(qid)
            quotes.append(dict(qid=qid, head=head, title=title, author=author,
                               ttype=row.get("標題類型", ""), quote=quote,
                               segs=segs, fsegs=fsegs, probe=probe,
                               title_books=set(), hits=[]))
    by_qid = {q["qid"]: q for q in quotes}
    print(f"引文 {len(quotes)} 條，探針 {len(probe_owner)} 個")

    by_title: dict[str, list[dict]] = defaultdict(list)
    for b in books:
        by_title[b["title"]].append(b)
    for q in quotes:
        cands = by_title.get(q["title"], [])
        if not cands:
            continue
        matched = [c for c in cands if q["author"] and c["author"] == q["author"]]
        if matched:
            q["title_books"] = {c["id"] for c in matched}
        elif len(cands) == 1:
            q["title_books"] = {cands[0]["id"]}
        else:
            q["title_books"] = {c["id"] for c in cands}

    title_qids_by_book: dict[str, set[int]] = defaultdict(set)
    for q in quotes:
        for bid in q["title_books"]:
            title_qids_by_book[bid].add(q["qid"])

    book_ch: dict[str, tuple[list[int], list[str]]] = {}   # bid → (ch_han_start, ch_titles)
    ladder_calls = 0

    for bi, b in enumerate(books):
        bid = b["id"]
        text = (BOOKS_DIR / f"{bid}.txt").read_text(encoding="utf-8-sig", errors="replace")
        han = "".join(HAN.findall(text))
        folded = han.translate(loc_tbl)

        rows = chapters_by_book.get(bid, [])
        bounds = [int(r["char_offset"]) for r in rows] + [len(text)]
        ch_han_start: list[int] = []
        total = 0
        for i in range(len(rows)):
            ch_han_start.append(total)
            total += sum(1 for c in text[bounds[i]:bounds[i + 1]] if HAN.match(c))
        if not rows:
            ch_han_start = [0]
        book_ch[bid] = (ch_han_start, [r["ch_title"] for r in rows])

        cand: set[int] = set()
        if probe_owner:
            n = len(folded)
            for i in range(n - PROBE_N + 1):
                g = folded[i:i + PROBE_N]
                if g in probe_owner:
                    cand.update(probe_owner[g])
        cand |= title_qids_by_book.get(bid, set())

        for qid in sorted(cand):
            q = by_qid[qid]
            if not q["segs"]:
                continue
            ladder_calls += 1
            is_title = qid in title_qids_by_book.get(bid, set())
            # L0 原字精確
            spans = seq_exact(han, q["segs"])
            level = "L0"
            if not spans:
                # L1 折疊精確
                spans = seq_exact(folded, q["fsegs"])
                level = "L1"
            if not spans and is_title:
                # L2 模糊（僅書目命中書）
                spans = seq_fuzzy(folded, q["fsegs"])
                level = "L2"
            for a, bnd in spans:
                q["hits"].append((bid, a, bnd, level))

        if (bi + 1) % 200 == 0 or bi == len(books) - 1:
            tot = sum(len(q["hits"]) for q in quotes)
            print(f"  [{bi+1}/{len(books)}] {bid}  候選 {len(cand)}  累計命中 {tot}  {time.time()-t0:.0f}s")

    # ---- 分級 ----
    out_rows: list[tuple] = []
    st2 = defaultdict(int)
    per_book_anchor = defaultdict(int)

    def chapter_of(bid: str, han_pos: int):
        starts, titles = book_ch[bid]
        ch = 0
        for i, stp in enumerate(starts):
            if stp <= han_pos:
                ch = i
            else:
                break
        return ch, (titles[ch] if ch < len(titles) else "")

    for q in quotes:
        qid = q["qid"]
        hits = q["hits"]
        tbooks = q["title_books"]
        if not q["segs"]:
            status = "too_short" if q["quote"] else "empty"
            out_rows.append((qid, q["head"], q["title"], q["author"], q["ttype"], q["quote"],
                             status, "", "", "", "", "", 0, 0, "no", ""))
            st2[status] += 1
            continue
        if q["probe"] is None and not tbooks:
            out_rows.append((qid, q["head"], q["title"], q["author"], q["ttype"], q["quote"],
                             "no_probe", "", "", "", "", "", 0, 0, "no", ""))
            st2["no_probe"] += 1
            continue
        if not hits:
            out_rows.append((qid, q["head"], q["title"], q["author"], q["ttype"], q["quote"],
                             "not_found", "", "", "", "", "", 0, 0, "no", ""))
            st2["not_found"] += 1
            continue
        occ = len(hits)
        in_title = [h for h in hits if h[0] in tbooks]
        if occ == 1:
            bid, a, bnd, level = hits[0]
            pref = "unique"
        elif len(in_title) == 1:
            bid, a, bnd, level = in_title[0]
            pref = "titlepref"
        else:
            bid, a, bnd, level = hits[0]
            pref = "multi"
        ch, ch_title = chapter_of(bid, a)
        starts, _ = book_ch[bid]
        A = a - starts[ch]
        B = bnd - starts[ch]
        anchorable = "no" if pref == "multi" else "yes"
        status = f"{level}_{pref}"
        st2[status] += 1
        if anchorable == "yes":
            per_book_anchor[bid] += 1
        out_rows.append((qid, q["head"], q["title"], q["author"], q["ttype"], q["quote"],
                         status, level, bid, ch, ch_title, f"{A}-{B}", occ,
                         len(in_title), anchorable,
                         ";".join(sorted({h[0] for h in hits}))))

    OUT_TSV.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT_TSV, "w", encoding="utf-8", newline="") as f:
        w = csv.writer(f, delimiter="\t")
        w.writerow(["qid", "head", "title", "author", "title_type", "quote", "status",
                    "level", "book_id", "ch_index", "ch_title", "ab", "occ_total",
                    "occ_in_title_book", "anchorable", "books_hit"])
        for r in out_rows:
            w.writerow(r)

    anchorable = sum(1 for r in out_rows if r[14] == "yes")
    located = sum(1 for r in out_rows if r[7])
    rep = [
        "=== locate-quotes-global：xdhycd 現代引文 × 好讀全庫字元級回定位 ===",
        f"引文 {len(quotes)} 條（{'、'.join(MODERN_TYPES)}）；掃書 {len(books)} 本；{time.time()-t0:.0f}s",
        f"探針 gram {len(probe_owner)} 個；(qid,書) 階梯呼叫 {ladder_calls} 次",
        "",
        "狀態分佈：",
    ]
    for k, v in sorted(st2.items(), key=lambda kv: -kv[1]):
        rep.append(f"  {k:22s}: {v}")
    rep += [
        "",
        f"有定位（任意層級）            : {located}/{len(quotes)} = {located / max(len(quotes), 1) * 100:.1f}%",
        f"可發 anchor（unique+titlepref）: {anchorable}/{len(quotes)} = {anchorable / max(len(quotes), 1) * 100:.1f}%",
        "",
        "可發 anchor 的書（前 20）：",
    ]
    for bid, n in sorted(per_book_anchor.items(), key=lambda kv: -kv[1])[:20]:
        b = book_by_id.get(bid, {})
        rep.append(f"  {bid:18s} {n:5d}  《{b.get('title', '?')}》 {b.get('author', '')}")
    rep.append("")
    rep.append(f"輸出：{OUT_TSV}")
    OUT_REPORT.write_text("\n".join(rep) + "\n", encoding="utf-8")
    print("\n".join(rep))


if __name__ == "__main__":
    main()
