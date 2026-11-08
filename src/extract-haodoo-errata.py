#!/usr/bin/env python3
"""
extract-haodoo-errata.py — 把好讀書頁裡的勘誤表完整留下來

    python src/extract-haodoo-errata.py

好讀最珍貴的不是書，是二十年來無數讀友逐字校對的痕跡。書頁上的勘誤段長這樣：

    <a href="?M=hd&P=pr">勘誤表</a>：<br>
    (蟻滿長安 2017/4/7)<br>
    卻也到許多新慰安/卻也得到許多新慰安<br>
    幾處不知於何時/幾處不知起於何時<br>
    (A Yung 2014/6/6)<br>
    以下二處有些舊版書確誤作……<br>
    煞了苦痛/熬了苦痛<br>
    (未改，原也正確。……)<br>

本腳本做三件事，一層都不丟：
  1. text/errata/<id>.txt        逐字原文（含所有說明、未改備註、空行），最完整的保存
  2. manifest/errata.tsv         逐條結構化：貢獻者／日期／錯字／正字／備註
  3. manifest/errata-people.tsv  逐位貢獻者統計（人次、改字數、橫跨幾本書、起訖日期）

另外把站方的勘誤文獻（周劍輝《勘誤需知》、徵初步整理清單 1a/1b/2/3）
另外抄一份到 text/errata/site/，方便單獨閱讀。

紀律：原文不改字、不簡轉繁、不重排；結構化只是「另外」加一層索引，不取代原文。
"""
from __future__ import annotations

import csv
import hashlib
import html
import re
from collections import defaultdict
from pathlib import Path

ROOT = Path("raw/haodoo")
BOOKS = ROOT / "html/books"
SITE = ROOT / "html/site"
MAN = ROOT / "manifest"
ERRATA = ROOT / "text/errata"
SITE_ERRATA = ERRATA / "site"
for d in (MAN, ERRATA, SITE_ERRATA):
    d.mkdir(parents=True, exist_ok=True)

CTRL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
GROUP = re.compile(r"^\((.+?)\s+(\d{4}[/-]\d{1,2}[/-]\d{1,2})\)\s*$")
DATE_ANY = re.compile(r"\d{4}[/-]\d{1,2}[/-]\d{1,2}")


def main_region(s: str) -> str:
    a = s.find("Main content - Include html file here")
    start = s.find("-->", a) + 3 if a > 0 else 0
    end = len(s)
    for mark in ("<!-- </table> -->", "好讀第25年了", "寫信給黃河"):
        i = s.find(mark, start + 100)
        if i > 0:
            end = min(end, i)
    region = s[start:end]
    return region if len(region) > 100 else s


def to_text(fragment: str) -> str:
    t = re.sub(r"<(script|style)\b[\s\S]*?</\1>", "", fragment, flags=re.I)
    t = re.sub(r"<br\s*/?>", "\n", t, flags=re.I)
    t = re.sub(r"</(?:p|div|tr|td|li)>", "\n", t, flags=re.I)
    t = re.sub(r"<[^>]+>", "", t)
    t = html.unescape(t)
    t = CTRL.sub("", t).replace("\ufeff", "").replace("\r", "")
    t = re.sub(r"[ \t\u3000]+\n", "\n", t)
    t = re.sub(r"\n{3,}", "\n\n", t)
    return t.strip()


def errata_section(region: str) -> str | None:
    """切出「勘誤表：」之後的整段。只用帶連結的精確寫法，避免誤抓簡介裡提到的『勘誤』。"""
    for pat in (r'<a\s+href="\?M=hd&P=pr"[^>]*>\s*勘誤表\s*</a>', r'勘誤表\s*</a>'):
        m = re.search(pat, region, flags=re.I)
        if m:
            return region[m.start():]
    return None


def parse_lines(text: str, rid: str, title: str, author: str, src: str):
    rows = []
    contributor, date, gno = "", "", -1
    for lno, raw in enumerate(text.split("\n")):
        line = raw.strip()
        if not line:
            continue
        m = GROUP.match(line)
        if m:                                   # 新的一批勘誤：(貢獻者 日期)
            contributor, date = m.group(1).strip(), m.group(2).strip()
            gno += 1
            rows.append([rid, title, author, gno, contributor, date, lno,
                         "group", "", "", "", line, src])
            continue
        # 「(未改…)、(原也正確…)、(人民文學出版社…)」是備註，不是新的貢獻者
        if line.startswith("("):
            rows.append([rid, title, author, gno, contributor, date, lno,
                         "note", "", "", line.strip("()"), line, src])
            continue
        if "/" in line and not line.startswith("http"):
            wrong, correct = line.split("/", 1)
            wrong, correct = wrong.strip(), correct.strip()
            note = ""
            cm = re.search(r"\s*(\([^/]*\))\s*$", correct)   # 尾端括號備註
            if cm:
                note = cm.group(1)
                correct = correct[:cm.start()].strip()
            if wrong and correct:
                rows.append([rid, title, author, gno, contributor, date, lno,
                             "fix", wrong, correct, note, line, src])
                continue
        rows.append([rid, title, author, gno, contributor, date, lno,
                     "context", "", "", line, line, src])
    return rows


def write(name, header, rows):
    with (MAN / name).open("w", encoding="utf-8", newline="") as f:
        w = csv.writer(f, delimiter="\t", lineterminator="\n")
        w.writerow(header)
        w.writerows(rows)


def main() -> None:
    # metadata：書名／作者取自 books.tsv（若尚未產生就留空）
    meta = {}
    if (MAN / "books.tsv").exists():
        with (MAN / "books.tsv").open(encoding="utf-8") as f:
            for r in csv.DictReader(f, delimiter="\t"):
                rid = f"{r.get('mode', '')}__{r.get('code', '')}"
                meta[rid] = (r.get("title", ""), r.get("author", ""))

    all_rows, with_errata, no_errata = [], 0, 0
    for f in sorted(BOOKS.glob("*.html")):
        rid = f.stem
        s = f.read_text(encoding="utf-8", errors="replace")
        region = main_region(s)
        sec = errata_section(region)
        if sec is None:
            no_errata += 1
            continue
        text = to_text(sec)
        if len(text) < 12:
            no_errata += 1
            continue
        with_errata += 1
        sha = hashlib.sha256(f.read_bytes()).hexdigest()[:16]
        title, author = meta.get(rid, ("", ""))
        header = (
            f"# 好讀勘誤表逐字留存\n"
            f"# book_id: {rid}\n"
            f"# 書名: {title}    作者: {author}\n"
            f"# 來源頁面: {f}\n"
            f"# 頁面 sha256 前 16: {sha}\n"
            f"# 以下為原文，未改字、未重排。\n\n"
        )
        (ERRATA / f"{rid}.txt").write_text(header + text + "\n", encoding="utf-8")
        all_rows.extend(parse_lines(text, rid, title, author, str(f)))

    write("errata.tsv",
          ["id", "title", "author", "group_no", "contributor", "date", "line_no",
           "kind", "wrong", "correct", "note", "raw_line", "src_page"], all_rows)

    # 逐位貢獻者統計：這份表是給「無數網友的無私付出」留個名字
    people = defaultdict(lambda: {"fix": 0, "groups": set(), "books": set(), "dates": []})
    for r in all_rows:
        if r[4] and r[7] == "group":
            p = people[r[4]]
            p["groups"].add((r[0], r[3]))
            p["dates"].append(r[5])
        elif r[4] and r[7] == "fix":
            p = people[r[4]]
            p["fix"] += 1
            p["books"].add(r[0])
            if r[5]:
                p["dates"].append(r[5])
    prows = []
    for name, p in people.items():
        ds = sorted(d for d in p["dates"] if d)
        prows.append([name, len(p["groups"]), p["fix"], len(p["books"]),
                      ds[0] if ds else "", ds[-1] if ds else ""])
    prows.sort(key=lambda x: (-x[2], -x[1], x[0]))
    write("errata-people.tsv",
          ["contributor", "batches", "fixes", "books", "first_date", "last_date"], prows)

    # 站方勘誤文獻獨立留存
    site_docs = {
        "hd__pr": "勘誤需知（周劍輝）",
        "x__prlist1a": "徵初步整理、校正（一）",
        "x__prlist1b": "徵初步整理、校正（一，續）",
        "x__prlist2": "徵初步整理清單二",
        "hd__prlist3": "徵初步整理清單三",
        "x__prlist": "徵整理清單（總目）",
    }
    kept = 0
    for stem, label in site_docs.items():
        f = SITE / f"{stem}.html"
        if not f.exists():
            continue
        txt = to_text(main_region(f.read_text(encoding="utf-8", errors="replace")))
        (SITE_ERRATA / f"{stem}.txt").write_text(
            f"# {label}\n# 來源: {f}\n\n{txt}\n", encoding="utf-8")
        kept += 1

    fixes = sum(1 for r in all_rows if r[7] == "fix")
    print(f"勘誤保存：{with_errata} 本有勘誤段（{no_errata} 本無）")
    print(f"  逐條 {len(all_rows):,} 列，其中改字 {fixes:,} 條；貢獻者 {len(prows):,} 位")
    print(f"  站方勘誤文獻 {kept} 份 → {SITE_ERRATA}")
    print(f"  逐字原文 → {ERRATA}｜清冊 → {MAN / 'errata.tsv'}、{MAN / 'errata-people.tsv'}")


if __name__ == "__main__":
    main()
