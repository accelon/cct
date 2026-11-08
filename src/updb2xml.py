#!/usr/bin/env python3
"""
updb2xml.py — 把好讀 updb 轉成 Accelon XML 行（updb → accelon 文字層）

依 raw/haodoo/manifest/adb-plan.tsv 的分組，把每本書的 updb 解成章節，
輸出成「一行一個 adb 行」的 XML 文字檔，供 haodoo-pack.ts 呼叫 authorAdb 打包成 .adb。

每個 ADB 檔的開頭先放一棵隱藏的目錄樹宣告（參考 ys.adb / vault-plan.ts）：

    <隱><樹 s="*" t="書,章.">好讀目錄</樹></隱>

每本書的結構（書名／作者作為 <書> 的內文，自閉標籤，參考 yinshun）：

    <書 id="book__435">魯迅《吶喊》</書>
    <章>目錄</章>
    （目錄各行）
    <章>第一篇：一件小事</章>
    （該章各行）
    ...
    <章>本站讀者勘誤表</章>      ← 若有勘誤檔才附加
    （勘誤各行）

規範（沿用 adb-knowhow.md / off2accelon.md）：
  - 一行一個 adb 行；超 4000 字由 haodoo-pack.ts 的 splitLongLine 負責折行。
  - 正文裡的 `<` `>` 全部轉全形 `＜` `＞`，避免被當成標籤（好讀正文極少出現，安全且 faithful）。
  - 不簡轉繁、不改標點、不刪字；直式標點原樣保留。
  - 勘誤表（站方與網友無私付出）一律附在書末，與正文同檔留存。
  - <樹>/<隱> 是建庫用隱藏資訊（render_accelon3.ts 的 HIDDEN_TAGS），不會進入本文。
  - 章節標題用 <章>…</章> 的內文當樹節點標籤；不要用 n= 屬性（會被 nodeLabel 的
    pickName 優先選成「0／勘誤」等，蓋掉標題）。書名同理用 <書> 內文，不用 n=。

用法：
    python src/updb2xml.py                 # 全部 18 個 ADB
    python src/updb2xml.py --adb haodoo-top100-1   # 只做某一個（試做用）
    python src/updb2xml.py --limit 20      # 每個 ADB 只取前 N 本（除錯）
"""
from __future__ import annotations

import argparse
import csv
import pathlib
import re
import struct
import sys
import zipfile

ROOT = pathlib.Path("raw/haodoo")
MAN = ROOT / "manifest"
FILES_TSV = MAN / "files.tsv"
PLAN_TSV = MAN / "adb-plan.tsv"
ERRATA_DIR = ROOT / "text/errata"
OUT = pathlib.Path("out/haodoo-adb")
OUT.mkdir(parents=True, exist_ok=True)

CJK = re.compile(r"[㐀-䶿一-鿿豈-﫿]")
CTRL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
ESC = {"<": "＜", ">": "＞"}

# 豎排標點（CJK 相容形式 U+FE30–FE4F）→ 橫排對應。好讀原稿是直式排版，用了大量
# ︽《》︾（書名號）、﹁﹂（引號）等豎排符號；在橫排閱讀器裡會顯成怪符號，故全部正規化。
# 對照表依 Unicode 官方相容分解（橫排對應），ASCII 括號/底線等改為全形，少量模糊字給合理退路。
VERT_TO_HORIZ = {
    # 豎排相容形式 U+FE30–FE4F（原稿直式排版用的書名號／引號／括號／破折號…）
    0xFE30: "：", 0xFE31: "—", 0xFE32: "—", 0xFE33: "＿", 0xFE34: "＿",
    0xFE35: "（", 0xFE36: "）", 0xFE37: "｛", 0xFE38: "｝", 0xFE39: "〔", 0xFE3A: "〕",
    0xFE3B: "【", 0xFE3C: "】", 0xFE3D: "《", 0xFE3E: "》", 0xFE3F: "〈", 0xFE40: "〉",
    0xFE41: "「", 0xFE42: "」", 0xFE43: "『", 0xFE44: "』", 0xFE45: "」", 0xFE46: "」",
    0xFE47: "〔", 0xFE48: "〕", 0xFE49: "＿", 0xFE4A: "＿", 0xFE4B: "＿", 0xFE4C: "＿",
    0xFE4D: "＿", 0xFE4E: "＿", 0xFE4F: "～",
    # 豎排「表現形式」U+FE10–FE1F：只為直式排版存在的標點，全部轉橫排對應（用家回報 ︙ 漏轉）
    0xFE10: "『", 0xFE11: "』", 0xFE12: "。", 0xFE13: "：", 0xFE14: "—",
    0xFE15: "！", 0xFE16: "？", 0xFE17: "（", 0xFE18: "）", 0xFE19: "…",
    0xFE1A: "、", 0xFE1B: "｝", 0xFE1C: "｛", 0xFE1D: "」", 0xFE1E: "「", 0xFE1F: "』",
    # 全形豎線 U+FF5C（直式分隔符，好讀目錄常用）→ 半形豎線（用家回報 ｜ 漏轉）
    0xFF5C: "|",
}
_VERT_TABLE = str.maketrans({cp: ord(h) for cp, h in VERT_TO_HORIZ.items()})


def clean_pdb_text(s: str) -> str:
    s = s.replace("\r\n", "\n").replace("\r", "\n")
    s = CTRL.sub("", s)
    s = s.replace("\ufeff", "").replace("\uffff", "")
    s = re.sub(r"[†‡\x1b]+", "", s)
    # 好讀內部書籤／目錄索引字（㐀…㖗 U+3400–U+3597，含 㐳 U+3433 等），非作者正文，全數去除
    # （這些碼位只出現在 record 0 的導航索引，正文裡幾乎不可能出現真實的擴A字）
    s = re.sub(r"[㐀-㖗]", "", s)
    s = re.sub(r"[ \t]+\n", "\n", s)
    s = re.sub(r"\n{4,}", "\n\n\n", s)
    s = s.translate(_VERT_TABLE)          # 豎排標點 → 橫排（︽→《 等）
    return s.strip()


def _is_garbage_script(ch: str) -> bool:
    """該字是否屬於『絕不可能出現在中文書裡』的文種。真正的繁簡中文只會用 CJK 系列、
    CJK 標點、全形半形、注音符號（ㄅㄆㄇ）、幾何／製表符號、少量 ASCII／Latin-1；一旦
    出現下列『非中文文種』的碼位，幾乎可斷定是 updb record 解碼錯誤的亂碼（好讀的目錄
    索引二進位區被當成 UTF-16LE 解開，會落進諺文／天城體／泰文／巴厘文等區段）。"""
    o = ord(ch)
    # 注音符號、諺文相容（ㄱ 等）不是亂碼，但真正的諺文音節／加畫是垃圾
    if 0x1100 <= o <= 0x11FF:  return True   # 諺文 字母
    if 0xAC00 <= o <= 0xD7A3:  return True   # 諺文 音節
    if 0x3130 <= o <= 0x318F:  return True   # 諺文 相容字母
    if 0x0900 <= o <= 0x097F:  return True   # 天城體（梵文）
    if 0x0980 <= o <= 0x09FF:  return True   # 孟加拉文
    if 0x0A00 <= o <= 0x0A7F:  return True   # 古木基文
    if 0x0B00 <= o <= 0x0B7F:  return True   # 奧里亞文
    if 0x0B80 <= o <= 0x0BFF:  return True   # 坦米爾文
    if 0x0C00 <= o <= 0x0C7F:  return True   # 泰盧固文
    if 0x0C80 <= o <= 0x0CDF:  return True   # 卡納達文
    if 0x0D00 <= o <= 0x0D7F:  return True   # 馬拉雅拉姆文
    if 0x0D80 <= o <= 0x0DFF:  return True   # 僧伽羅文
    if 0x0E00 <= o <= 0x0E7F:  return True   # 泰文
    if 0x0E80 <= o <= 0x0EFF:  return True   # 寮文
    if 0x1000 <= o <= 0x109F:  return True   # 緬甸文
    if 0x1780 <= o <= 0x17FF:  return True   # 高棉文
    if 0x1B00 <= o <= 0x1B7F:  return True   # 巴厘文
    if 0x1200 <= o <= 0x137F:  return True   # 衣索比亞文
    if 0x0400 <= o <= 0x04FF:  return True   # 西里爾字母
    if 0x0530 <= o <= 0x058F:  return True   # 亞美尼亞文
    if 0x10A0 <= o <= 0x10FF:  return True   # 喬治亞文
    if 0x0590 <= o <= 0x05FF:  return True   # 希伯來文
    if 0x0600 <= o <= 0x06FF:  return True   # 阿拉伯文
    return False


def _decode_record(raw: bytes) -> str | None:
    """解一個 PDB record；回傳清理後文字，若為二進位垃圾則回 None。"""
    if len(raw) % 2:
        raw = raw[:-1]
    if not raw or raw in (b"\xff\xff",):
        return None
    # 1) 首選標準 UTF-16LE（好讀正文絕大多數）
    try:
        s = raw.decode("utf-16-le")
    except UnicodeDecodeError:
        s = None
    # 2) 備援 GBK / Big5（極少數舊檔）
    if s is None:
        for enc in ("gbk", "big5"):
            try:
                s = raw.decode(enc)
                break
            except UnicodeDecodeError:
                continue
    if s is None:
        return None                          # 二進位（如好讀的目錄索引 record 0）
    if "\ufffd" in s:
        return None                          # 有壞位元組，不可信
    s = clean_pdb_text(s)
    if not s or not CJK.search(s):
        return None
    # 3) 非中文文種偵測：去掉控制碼/書籤字後若仍混有諺文/天城體等，即為亂碼
    exo = sum(1 for c in s if _is_garbage_script(c))
    if exo >= 2 or (exo >= 1 and len(s) > 0 and exo / max(1, len(s)) > 0.05):
        return None
    return s


def decode_pdb(data: bytes) -> list[tuple[str, str]]:
    if len(data) < 78 or data[60:64] != b"BOOK":
        raise ValueError("不是 PDB BOOK 容器")
    n = struct.unpack(">H", data[76:78])[0]
    offs = [struct.unpack(">I", data[78 + i * 8:82 + i * 8])[0] for i in range(n)]
    offs.append(len(data))
    out: list[tuple[str, str]] = []
    for i in range(n):
        s = _decode_record(data[offs[i]:offs[i + 1]])
        if not s:
            continue
        # record 0 若像目錄（含『目錄』或多行章名）就標 toc，否則視同章節
        kind = "toc" if i == 0 and ("目錄" in s[:60] or (len(CJK.findall(s)) < 200 and "\n" in s)) else "chapter"
        out.append((kind, s))
    if not out:
        raise ValueError("PDB 內找不到可解出的中文 record")
    return out


def decode_epub(data: bytes) -> list[tuple[str, str]]:
    import io, html as _html
    z = zipfile.ZipFile(io.BytesIO(data))
    names = set(z.namelist())
    container = z.read("META-INF/container.xml").decode("utf-8", "replace") if "META-INF/container.xml" in names else ""
    m = re.search(r'full-path="([^"]+)"', container)
    opf_path = m.group(1) if m else next((x for x in names if x.endswith(".opf")), None)
    if not opf_path or opf_path not in names:
        raise ValueError("找不到 OPF")
    opf = z.read(opf_path).decode("utf-8", "replace")
    base = opf_path.rsplit("/", 1)[0] + "/" if "/" in opf_path else ""
    items = {}
    for tag in re.findall(r"<item\b[^>]*>", opf, flags=re.I):
        mi = re.search(r'\bid="([^"]+)"', tag)
        mh = re.search(r'\bhref="([^"]+)"', tag)
        if mi and mh:
            items[mi.group(1)] = mh.group(1)
    spine = [re.search(r'\bidref="([^"]+)"', t).group(1) for t in re.findall(r"<itemref\b[^>]*>", opf, flags=re.I) if re.search(r'\bidref="([^"]+)"', t)]
    out = []
    for k, sid in enumerate(spine):
        href = items.get(sid)
        if not href or base + href not in names:
            continue
        raw = z.read(base + href).decode("utf-8", "replace")
        raw = re.sub(r"<(script|style)\b[\s\S]*?</\1>", "", raw, flags=re.I)
        txt = _html.unescape(re.sub(r"<[^>]+>", " ", raw))
        txt = re.sub(r"[ \t\u3000]+", " ", txt)
        txt = re.sub(r"\s*\n\s*", "\n", txt).strip()
        if txt and CJK.search(txt):
            out.append(("toc" if k == 0 and "目錄" in txt[:30] else "chapter", txt))
    if not out:
        raise ValueError("EPUB 內找不到本文")
    return out


def esc(s: str) -> str:
    return s.replace("<", ESC["<"]).replace(">", ESC[">"])


def body_lines(text: str) -> list[str]:
    """章節正文切成 adb 行：去 \r、依 \n 拆、壓掉連續空行、跳過全空行。"""
    out = []
    prev_empty = False
    for ln in text.replace("\r", "").split("\n"):
        ln = ln.strip()
        if not ln:
            if not prev_empty and out:
                out.append("")
            prev_empty = True
            continue
        prev_empty = False
        out.append(esc(ln))
    while out and out[-1] == "":
        out.pop()
    return out


def book_lines(rid: str, author: str, title: str) -> list[str]:
    """解一本書，回傳該書的 Accelon XML 行（不含開頭/結尾的 <書> 標籤）。"""
    row = FILES.get(rid)
    if not row:
        raise FileNotFoundError(f"{rid} 不在 files.tsv")
    path = pathlib.Path(row["file"])
    if not path.exists():
        raise FileNotFoundError(f"{rid} 檔案不存在：{path}")
    data = path.read_bytes()
    parts = decode_epub(data) if row["ext"] == "epub" else decode_pdb(data)

    lines = []
    for k, (kind, text) in enumerate(parts):
        if kind == "toc":
            lines.append('<章>目錄</章>')
            lines.extend(body_lines(text))
            continue
        seg = body_lines(text)
        head = seg[0] if seg else f"第{k}章"
        lines.append(f'<章>{head}</章>')
        lines.extend(seg[1:])
    # 勘誤表（網友無私付出）附於書末
    err = ERRATA_DIR / f"{rid}.txt"
    if err.exists() and err.stat().st_size > 0:
        et = err.read_text(encoding="utf-8", errors="replace").strip()
        if et:
            lines.append('<章>本站讀者勘誤表</章>')
            lines.extend(body_lines(et))
    return lines


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--adb", help="只建指定的 ADB（dbname）")
    ap.add_argument("--limit", type=int, default=0, help="每個 ADB 只取前 N 本（除錯）")
    args = ap.parse_args()

    plan = list(csv.DictReader(PLAN_TSV.open(encoding="utf-8"), delimiter="\t"))
    files_rows = list(csv.DictReader(FILES_TSV.open(encoding="utf-8"), delimiter="\t"))
    books_rows = list(csv.DictReader((MAN / "books.tsv").open(encoding="utf-8"), delimiter="\t"))
    global FILES
    FILES = {r["id"]: r for r in files_rows}
    TITLES = {f"{b['mode']}__{b['code']}": b.get("title", "") for b in books_rows}

    groups: dict[str, list] = {}
    for r in plan:
        groups.setdefault(r["adb"], []).append(r)
    if args.adb:
        if args.adb not in groups:
            raise SystemExit(f"找不到 ADB {args.adb}")
        groups = {args.adb: groups[args.adb]}

    total_books = total_chars = 0
    for dbname in sorted(groups):
        recs = groups[dbname]
        if args.limit:
            recs = recs[:args.limit]
        out_path = OUT / f"{dbname}.xml"
        nbooks = nlines = nchars = 0
        with out_path.open("w", encoding="utf-8", newline="\n") as f:
            # 隱藏的目錄樹宣告（好讀目錄：書 → 章 兩層）
            f.write('<隱><樹 s="*" t="書,章.">好讀目錄</樹></隱>\n')
            for r in recs:
                rid = r["id"]
                try:
                    bl = book_lines(rid, r["author"], TITLES.get(rid, ""))
                except Exception as e:
                    sys.stderr.write(f"  ! {rid} 解碼失敗：{e}\n")
                    continue
                title = TITLES.get(rid, "")
                name = f"{r['author']}《{esc(title).translate(_VERT_TABLE)}》" if title else (r["author"] or rid)
                # 書名／作者作為 <書> 內文（自閉標籤），直接當樹根節點標籤
                f.write(f'<書 id="{rid}">{name}</書>\n')
                f.write("\n".join(bl))
                f.write("\n")
                nbooks += 1
                nlines += len(bl) + 1
                nchars += sum(len(x) for x in bl)
        total_books += nbooks
        total_chars += nchars
        print(f"{dbname:<22} {nbooks:>5} 本  {nlines:>8} 行  {nchars:>12,} 字  → {out_path.name}")
    print(f"\n完成：{total_books} 本 → {len(groups)} 個 XML，共 {total_chars:,} 字")


if __name__ == "__main__":
    main()
