# -*- coding: utf-8 -*-
"""verify-xout-haodoo.py — 反解驗證 out/haodoo-xout/*.jsonl 與 anchor manifest。

三件事：
  1) manifest：每章 textHash 是否等於現書文重算值（版本一致性）
  2) xout 記錄：anchor 存在、a-b 在章內、引文片段按序落在 [a,b)（依 conf 層級容差）
  3) 標頭 manifestHash 是否等於現 manifest 值
用法：python src/verify-xout-haodoo.py
輸出：out/verify-xout-haodoo.txt
"""
from __future__ import annotations

import bisect
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
FOLD_TSV = CCT / "data/char-fold.tsv"
VARIANT_TSV = CCT / "data/char-variant.tsv"
MANIFEST_TSV = CCT / "out/haodoo-anchor-manifest.tsv"
XOUT_DIR = CCT / "out/haodoo-xout"
OUT_TXT = CCT / "out/verify-xout-haodoo.txt"

HAN = re.compile(r"[㐀-䶿一-鿿豈-﫿]")
HAN_ANY = re.compile(
    "[㐀-䶿一-鿿豈-﫿"
    "\U00020000-\U0002A6DF\U0002A700-\U0002EBEF\U0002F800-\U0002FA1F\U00030000-\U0003134A]"
)
ELID = re.compile(r"[…⋯]+|\.{3,}")
PAREN = re.compile(r"[（(][^）)]*[）)]")
GAP = 600


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


def seq_exact(hs: str, segs: list[str]) -> list[tuple[int, int]]:
    lists = []
    for s in segs:
        ps = all_positions(hs, s)
        if not ps:
            return []
        lists.append(ps)
    spans = []
    for p0 in lists[0]:
        cur = p0 + len(segs[0])
        end = cur
        ok = True
        for si in range(1, len(segs)):
            ps = lists[si]
            k = bisect.bisect_left(ps, cur)
            if k == len(ps) or ps[k] - cur > GAP:
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


def seq_fuzzy(hs: str, segs: list[str]) -> list[tuple[int, int]]:
    def mm(s):
        return 1 if len(s) < 6 else 2

    spans = []
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
            if j == -1 or j - cursor > GAP:
                ok = False
                break
            cursor = j + len(s)
            end = cursor
        if ok:
            spans.append((pos, end))
        pos = _fuzzy_first(hs, first, mm(first), pos + 1)
    return spans


def main() -> None:
    fold_src = {**_load_map(FOLD_TSV), **_load_map(VARIANT_TSV)}
    loc_tbl = build_translate(fold_src)
    hash_tbl = build_translate(_load_map(FOLD_TSV))

    # ---- manifest 對照 ----
    man: dict[tuple[str, int], tuple] = {}
    with open(MANIFEST_TSV, encoding="utf-8", newline="") as f:
        for row in csv.DictReader(f, delimiter="\t"):
            man[(row["book_id"], int(row["ch_index"]))] = (
                row["text_hash"], int(row["han_start"]), int(row["han_end"]))

    chapters_by_book: dict[str, list[dict]] = defaultdict(list)
    with open(CHAPS_TSV, encoding="utf-8-sig", newline="") as f:
        for row in csv.DictReader(f, delimiter="\t"):
            chapters_by_book[row["id"]].append(row)
    for rows in chapters_by_book.values():
        rows.sort(key=lambda r: int(r["ch_index"]))

    st = defaultdict(int)
    bad: list[str] = []
    book_state: dict[str, dict] = {}     # bid → {ch: han_str, mhash, bounds_ok}

    def load_book(bid: str) -> dict:
        if bid in book_state:
            return book_state[bid]
        text = (BOOKS_DIR / f"{bid}.txt").read_text(encoding="utf-8-sig", errors="replace")
        rows = chapters_by_book.get(bid, [])
        if not rows:
            rows = [{"ch_index": 0, "kind": "chapter", "ch_title": ""}]
        bounds = [int(r["char_offset"]) for r in rows] + [len(text)]
        ch_han: dict[int, str] = {}
        pairs = []
        total = 0
        for i in range(len(rows)):
            h = han_only(text[bounds[i]:bounds[i + 1]])
            ch_han[int(rows[i]["ch_index"])] = h
            th = "" if not h else hashlib.sha256(
                h.translate(hash_tbl).encode("utf-8")).hexdigest()[:16]
            pairs.append(f"ch{rows[i]['ch_index']}\t{th}")
            total += len(h)
        mhash = hashlib.sha256("\n".join(pairs).encode("utf-8")).hexdigest()[:16]
        book_state[bid] = {"ch_han": ch_han, "mhash": mhash}
        return book_state[bid]

    # 1) manifest hash 全庫比對（章數 118,450；只驗有 xout 的書 + 抽樣其餘）
    xout_files = sorted(XOUT_DIR.glob("xout_*.jsonl"))
    xout_books = {p.stem.replace("xout_", "") for p in xout_files}
    for bid in sorted(xout_books):
        state = load_book(bid)
        for ch, h in state["ch_han"].items():
            th = "" if not h else hashlib.sha256(
                h.translate(hash_tbl).encode("utf-8")).hexdigest()[:16]
            key = (bid, ch)
            if key not in man:
                st["manifest_missing"] += 1
                bad.append(f"  ✗ manifest 缺 {bid}?ch{ch}")
            elif man[key][0] != th:
                st["manifest_hash_bad"] += 1
                bad.append(f"  ✗ manifest hash 不符 {bid}?ch{ch}：表 {man[key][0]} 現 {th}")
            else:
                st["manifest_ok"] += 1

    # 2) xout 記錄
    for p in xout_files:
        lines = [l for l in p.read_text(encoding="utf-8").splitlines() if l]
        head = json.loads(lines[0])
        assert head[0] == "XOUT1"
        bid = head[1]
        state = load_book(bid)
        if head[3] != f"sha256:{state['mhash']}":
            st["header_mhash_bad"] += 1
            bad.append(f"  ✗ {p.name} 標頭 manifestHash 不符")
        n = 0
        for l in lines[1:]:
            r = json.loads(l)
            srcA, sA, sB, tgt, a, b, quote, kind, conf, thash = r[0], r[2], r[3], r[4], r[5], r[6], r[7], r[8], r[9], r[10]
            st["records"] += 1
            n += 1
            m = re.fullmatch(r"seg:ch(\d+)", tgt)
            if not m:
                st["bad_anchor"] += 1
                bad.append(f"  ✗ {p.name} anchor 形狀 {tgt}")
                continue
            ch = int(m.group(1))
            h = state["ch_han"].get(ch)
            if h is None:
                st["no_anchor"] += 1
                bad.append(f"  ✗ {p.name} anchor 不存在 {bid}?ch{ch}")
                continue
            th = "" if not h else hashlib.sha256(
                h.translate(hash_tbl).encode("utf-8")).hexdigest()[:16]
            if thash != th:
                st["thash_bad"] += 1
                bad.append(f"  ✗ {p.name} tHash 不符 {bid}?ch{ch}")
                continue
            if not (0 <= a < b <= len(h)):
                st["ab_range_bad"] += 1
                bad.append(f"  ✗ {p.name} a-b 越界 {bid}?ch{ch}#{a}-{b}（章長 {len(h)}）")
                continue
            # 依層級反解：quote 片段是否正好落在 [a,b)
            segs = [han_only(x) for x in PAREN.sub("", quote).replace("……", "\x00").split("\x00")]
            segs = [s for s in segs if len(s) >= 2]
            if not segs:
                st["quote_empty"] += 1
                continue
            level = {40: "L0", 35: "L1", 30: "L2"}.get(conf, "?")
            if level == "L0":
                spans = seq_exact(h, segs)
            elif level == "L1":
                spans = seq_exact(h.translate(loc_tbl), [s.translate(loc_tbl) for s in segs])
            else:
                spans = seq_fuzzy(h.translate(loc_tbl), [s.translate(loc_tbl) for s in segs])
            if (a, b) in spans:
                st["ok"] += 1
            else:
                st["slice_bad"] += 1
                bad.append(f"  ✗ {p.name} 切片不符 {bid}?ch{ch}#{a}-{b}（{level}）「{quote[:18]}」")

    rep = [
        "=== verify-xout-haodoo ===",
        f"xout 桶 {len(xout_files)} 個（{len(xout_books)} 書）",
        f"manifest 章比對   ：ok {st['manifest_ok']}｜缺 {st['manifest_missing']}｜hash 不符 {st['manifest_hash_bad']}",
        f"xout 記錄          ：{st['records']} 筆",
        f"  通過             ：{st['ok']}",
        f"  anchor 不存在    ：{st['no_anchor']}",
        f"  anchor 形狀錯    ：{st['bad_anchor']}",
        f"  tHash 不符       ：{st['thash_bad']}",
        f"  a-b 越界         ：{st['ab_range_bad']}",
        f"  切片不符         ：{st['slice_bad']}",
        f"  標頭 mHash 不符  ：{st['header_mhash_bad']}",
        "",
    ]
    for s in bad[:40]:
        rep.append(s)
    if len(bad) > 40:
        rep.append(f"  …其餘 {len(bad) - 40} 條")
    rep.append("")
    verdict = "PASS" if (st["ok"] == st["records"] and not st["manifest_hash_bad"]
                         and not st["manifest_missing"] and not st["header_mhash_bad"]) else "FAIL"
    rep.append(f"結論：{verdict}（{st['ok']}/{st['records']} 反解通過）")
    OUT_TXT.write_text("\n".join(rep) + "\n", encoding="utf-8")
    print("\n".join(rep))


if __name__ == "__main__":
    main()
