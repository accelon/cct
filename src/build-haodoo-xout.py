# -*- coding: utf-8 -*-
"""build-haodoo-xout.py — 由定位結果產正式 anchor manifest 與 xout 記錄。

輸入：out/locate-quotes-global.tsv（anchorable=yes）、好讀書文、chapters.tsv
輸出：
  out/haodoo-anchor-manifest.tsv   全部章節 anchor（book?ch → 漢字範圍 + textHash）
  out/haodoo-anchor-books.tsv      書級 manifestHash（xout 標頭用）
  out/haodoo-quote-anchors.tsv     可發 anchor 的引文明細（含原文切片）
  out/haodoo-xout/xout_<book>.jsonl 依 spec XOUT1 形狀，每書一桶
  out/build-haodoo-xout-report.txt

xout 記錄形狀（沿用 link-swjzz-to-jing.ts）：
  ["XOUT1", book, 筆數, "sha256:<manifestHash>", "xdhycd"]
  [srcAnchor, -1, sA, sB, targetAnchor, a, b, quote, kind, conf, tHash]
  srcAnchor  = "char:<字頭>"        targetAnchor = "seg:ch<章序>"
  a-b        = 章內漢字序 [a,b)     quote = 引文片段（「……」連接）
  conf       = L0=40｜L1=35（異體/簡繁摺疊）｜L2=30（模糊 ≤2 字差）
  tHash      = sha256(摺疊後章漢字)[:16]，spec §4.4；0 漢字 → 空字串
"""
from __future__ import annotations

import csv
import hashlib
import json
import re
import unicodedata
from collections import defaultdict
from pathlib import Path

CCT = Path(__file__).resolve().parents[1]
BOOKS_DIR = CCT / "raw/haodoo/text/books"
CHAPS_TSV = CCT / "raw/haodoo/manifest/chapters.tsv"
CORPUS_TSV = CCT / "raw/haodoo/manifest/corpus.tsv"
FOLD_TSV = CCT / "data/char-fold.tsv"
LOCATE_TSV = CCT / "out/locate-quotes-global.tsv"
OUT_MANIFEST = CCT / "out/haodoo-anchor-manifest.tsv"
OUT_BOOKS = CCT / "out/haodoo-anchor-books.tsv"
OUT_ANCHORS = CCT / "out/haodoo-quote-anchors.tsv"
OUT_XOUT_DIR = CCT / "out/haodoo-xout"
OUT_REPORT = CCT / "out/build-haodoo-xout-report.txt"

HAN = re.compile(r"[㐀-䶿一-鿿豈-﫿]")
HAN_ANY = re.compile(
    "[㐀-䶿一-鿿豈-﫿"
    "\U00020000-\U0002A6DF\U0002A700-\U0002EBEF\U0002F800-\U0002FA1F\U00030000-\U0003134A]"
)
ELID = re.compile(r"[…⋯]+|\.{3,}")
PAREN = re.compile(r"[（(][^）)]*[）)]")
CONF = {"L0": 40, "L1": 35, "L2": 30}


def _load_fold() -> dict[str, str]:
    m: dict[str, str] = {}
    with open(FOLD_TSV, encoding="utf-8-sig") as f:
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


def build_hash_translate(src: dict[str, str]) -> dict[int, str]:
    table: dict[int, str] = {}
    for cp in range(0x10000):
        c = chr(cp)
        f = src.get(c)
        if f is None:
            f = _nfkc_first_han(c)
        if f != c:
            table[cp] = f
    return table


def text_hash(han: str, tbl: dict[int, str]) -> str:
    """spec §4.4：sha256(摺疊後漢字串)[:16]；0 漢字 → 空字串。"""
    if not han:
        return ""
    n1 = han.translate(tbl)
    return hashlib.sha256(n1.encode("utf-8")).hexdigest()[:16]


def han_only(s: str) -> str:
    return "".join(c for c in s if HAN.match(c))


def quote_segments(q: str) -> list[str]:
    q2 = PAREN.sub("", q)
    segs = [han_only(p) for p in ELID.split(q2)]
    return [s for s in segs if len(s) >= 2]


def main() -> None:
    hash_tbl = build_hash_translate(_load_fold())

    # ---- 定位結果（先讀，決定哪些書要留切片）----
    anchors_by_book: dict[str, list[dict]] = defaultdict(list)
    with open(LOCATE_TSV, encoding="utf-8", newline="") as f:
        for row in csv.DictReader(f, delimiter="\t"):
            if row["anchorable"] != "yes":
                continue
            A, B = (int(x) for x in row["ab"].split("-"))
            segs = quote_segments(row["quote"])
            if not segs:
                continue
            anchors_by_book[row["book_id"]].append(dict(
                qid=row["qid"], head=row["head"], ch=int(row["ch_index"]),
                a=A, b=B, level=row["level"], status=row["status"],
                quote="……".join(segs), orig=row["quote"], segs=segs))

    # ---- 書目／章節 ----
    books: dict[str, dict] = {}
    with open(CORPUS_TSV, encoding="utf-8-sig", newline="") as f:
        for row in csv.DictReader(f, delimiter="\t"):
            books[row["id"]] = row
    chapters_by_book: dict[str, list[dict]] = defaultdict(list)
    with open(CHAPS_TSV, encoding="utf-8-sig", newline="") as f:
        for row in csv.DictReader(f, delimiter="\t"):
            chapters_by_book[row["id"]].append(row)
    for rows in chapters_by_book.values():
        rows.sort(key=lambda r: int(r["ch_index"]))

    # ---- 單遍：manifest + xout ----
    manifest_rows: list[tuple] = []
    anchors_out: list[tuple] = []
    xout: dict[str, list[list]] = {}
    book_mhash: dict[str, str] = {}
    book_han_total: dict[str, int] = {}
    book_ch_count: dict[str, int] = {}
    n_cross = 0

    for bid in sorted(books):
        text = (BOOKS_DIR / f"{bid}.txt").read_text(encoding="utf-8-sig", errors="replace")
        rows = chapters_by_book.get(bid, [])
        if not rows:
            rows = [{"ch_index": 0, "kind": "chapter", "ch_title": ""}]
        bounds = [int(r["char_offset"]) for r in rows] + [len(text)]
        if len(bounds) != len(rows) + 1:
            rows = rows[: len(bounds) - 1]

        pairs: list[str] = []
        ch_han_list: list[str] = []
        total = 0
        for i in range(len(rows)):
            ch_han = han_only(text[bounds[i]:bounds[i + 1]])
            st, en = total, total + len(ch_han)
            total = en
            h = text_hash(ch_han, hash_tbl)
            r = rows[i]
            manifest_rows.append((bid, r["ch_index"], r.get("kind", "chapter"),
                                  r.get("ch_title", ""), st, en, len(ch_han), h))
            pairs.append(f"ch{r['ch_index']}\t{h}")
            ch_han_list.append(ch_han)
        book_mhash[bid] = hashlib.sha256("\n".join(pairs).encode("utf-8")).hexdigest()[:16]
        book_han_total[bid] = total
        book_ch_count[bid] = len(rows)

        recs: list[list] = []
        for anc in anchors_by_book.get(bid, []):
            ch = anc["ch"]
            if ch >= len(ch_han_list):
                continue
            if anc["b"] > len(ch_han_list[ch]):
                n_cross += 1
                continue
            sl = ch_han_list[ch][anc["a"]:anc["b"]]
            thash = text_hash(ch_han_list[ch], hash_tbl)
            anchors_out.append((anc["qid"], anc["head"], bid, ch, anc["a"], anc["b"],
                                anc["level"], anc["status"], anc["quote"], anc["orig"], sl))
            recs.append([
                f"char:{anc['head']}", -1, 0, sum(len(s) for s in anc["segs"]),
                f"seg:ch{ch}", anc["a"], anc["b"], anc["quote"], "mention",
                CONF[anc["level"]], thash,
            ])
        if recs:
            xout[bid] = recs

    with open(OUT_MANIFEST, "w", encoding="utf-8", newline="") as f:
        w = csv.writer(f, delimiter="\t")
        w.writerow(["book_id", "ch_index", "kind", "ch_title", "han_start", "han_end",
                    "han_count", "text_hash"])
        w.writerows(manifest_rows)

    with open(OUT_BOOKS, "w", encoding="utf-8", newline="") as f:
        w = csv.writer(f, delimiter="\t")
        w.writerow(["book_id", "title", "author", "chapters", "han_total", "manifest_hash"])
        for bid in sorted(books):
            w.writerow([bid, books[bid]["title"], books[bid]["author"],
                        book_ch_count.get(bid, 0), book_han_total.get(bid, 0),
                        book_mhash.get(bid, "")])

    with open(OUT_ANCHORS, "w", encoding="utf-8", newline="") as f:
        w = csv.writer(f, delimiter="\t")
        w.writerow(["qid", "head", "book_id", "ch_index", "a", "b", "level", "status",
                    "quote", "quote_orig", "slice"])
        w.writerows(anchors_out)

    OUT_XOUT_DIR.mkdir(parents=True, exist_ok=True)
    for old in OUT_XOUT_DIR.glob("xout_*.jsonl"):
        old.unlink()
    buckets = []
    for bid in sorted(xout):
        arr = xout[bid]
        lines = [json.dumps(["XOUT1", bid, len(arr), f"sha256:{book_mhash[bid]}", "xdhycd"],
                            ensure_ascii=False)]
        for r in arr:
            lines.append(json.dumps(r, ensure_ascii=False))
        (OUT_XOUT_DIR / f"xout_{bid}.jsonl").write_text("\n".join(lines) + "\n", encoding="utf-8")
        buckets.append((bid, len(arr), books[bid]["title"]))

    rep = [
        "=== build-haodoo-xout ===",
        f"章節 anchor manifest：{len(manifest_rows)} 章（{len(books)} 書）→ {OUT_MANIFEST.name}",
        f"可發 anchor 引文 {len(anchors_out)} 條 → xout 記錄 {sum(len(v) for v in xout.values())} 筆，{len(buckets)} 個桶",
        f"跨章跳過（span 出界）：{n_cross}",
        "",
        "桶（前 20，按筆數）：",
    ]
    for bid, n, t in sorted(buckets, key=lambda x: -x[1])[:20]:
        rep.append(f"  xout_{bid}.jsonl  {n:5d}  《{t}》")
    rep += ["", f"輸出：{OUT_XOUT_DIR}／{OUT_ANCHORS.name}／{OUT_BOOKS.name}"]
    OUT_REPORT.write_text("\n".join(rep) + "\n", encoding="utf-8")
    print("\n".join(rep))


if __name__ == "__main__":
    main()
