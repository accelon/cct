#!/usr/bin/env python3
"""
decode-haodoo-text.py — 把 raw/haodoo/files/ 的書檔還原成語料純文字

    python src/decode-haodoo-text.py

輸入：raw/haodoo/manifest/files.tsv（由 fetch-haodoo-archive.mjs 的 files 階段產生）
輸出：
    raw/haodoo/text/books/<id>.txt        一本書一個純文字檔（僅正文；好讀導航索引／目錄
                                         record 0 整段丟棄，避免偽中文亂碼滲入）
    raw/haodoo/manifest/corpus.tsv        逐本統計（章數、字數、漢字數、校驗）
    raw/haodoo/manifest/chapters.tsv      逐章索引（章序、標題、字數、起始 offset）
    raw/haodoo/manifest/decode-fail.tsv   解不出來的書
    raw/haodoo/manifest/toc-cleared.tsv   被清除的 record 0 原始內容（稽核用）

格式支援
    updb / pdb / prc / mobi : Palm PDB（type=BOOK）。好讀 updb 的 creator 是 MTIU，
        record 0 是目錄（已整段不納入語料，見下方紀律），其後一筆一章，內容是**未壓縮
        UTF-16LE**，最後一筆是 \uffff 結尾。這是好讀的原生格式，比轉出的 epub 更接近原稿，
        故為首選。
    epub : zip + OPF spine + XHTML，只用在沒有 updb 的書（備援）。

紀律：不簡轉繁、不刪字；去掉 PDB 的控制碼、書籤符號與好讀導航索引字（U+3400–U+3597），
      並將直式標點（︽︾﹁﹂︱︱ 等）正規化為橫排，以利橫排閱讀與檢索（與 ADB 一致）。
      **好讀導航索引／目錄（record 0）整段捨棄**：該 record 含跨語系亂碼與「偽中文」殘片
      （導航索引二進位誤解成 UTF-16LE 後落在合法 CJK 碼位，無法以碼位過濾），為確保使用者
      絕對看不到亂碼，一律不寫入書本純文字檔；其經清洗後的原始內容存入
      raw/haodoo/manifest/toc-cleared.tsv 供稽核。
"""
from __future__ import annotations

import csv
import hashlib
import html
import io
import re
import struct
import zipfile
from pathlib import Path

ROOT = Path("raw/haodoo")
FILES = ROOT / "files"
MAN = ROOT / "manifest"
OUT = ROOT / "text/books"
OUT.mkdir(parents=True, exist_ok=True)
MAN.mkdir(parents=True, exist_ok=True)

CJK = re.compile(r"[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]")
CTRL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
# 韓文（Hangul）碼位：導航索引二進位被誤解成 UTF-16LE 時，大量落在這些碼位，故整本
# 損壞書的正文會充斥韓文垃圾；合法中文書幾乎不含韓文（全量 4163 本僅 2 本 <0.1% 且皆零星）。
HANGUL = re.compile(r"[\u1100-\u11FF\u3130-\u318F\uAC00-\uD7AF]")

# 豎排標點 → 橫排對應（與 updb2xml.py 一致）。好讀原生 updb 用直式排版符號，
# 在橫排閱讀／檢索時會顯成怪符號，故全部正規化為橫排。
VERT_TO_HORIZ = {
    # 豎排相容形式 U+FE30–FE4F
    0xFE30: "：", 0xFE31: "—", 0xFE32: "—", 0xFE33: "＿", 0xFE34: "＿",
    0xFE35: "（", 0xFE36: "）", 0xFE37: "｛", 0xFE38: "｝", 0xFE39: "〔", 0xFE3A: "〕",
    0xFE3B: "【", 0xFE3C: "】", 0xFE3D: "《", 0xFE3E: "》", 0xFE3F: "〈", 0xFE40: "〉",
    0xFE41: "「", 0xFE42: "」", 0xFE43: "『", 0xFE44: "』", 0xFE45: "」", 0xFE46: "」",
    0xFE47: "〔", 0xFE48: "〕", 0xFE49: "＿", 0xFE4A: "＿", 0xFE4B: "＿", 0xFE4C: "＿",
    0xFE4D: "＿", 0xFE4E: "＿", 0xFE4F: "～",
    # 豎排「表現形式」U+FE10–FE1F：只用於直式排版的標點，全部轉橫排對應
    0xFE10: "『", 0xFE11: "』", 0xFE12: "。", 0xFE13: "：", 0xFE14: "—",
    0xFE15: "！", 0xFE16: "？", 0xFE17: "（", 0xFE18: "）", 0xFE19: "…",
    0xFE1A: "、", 0xFE1B: "｝", 0xFE1C: "｛", 0xFE1D: "」", 0xFE1E: "「", 0xFE1F: "』",
    # 全形豎線 U+FF5C（直式分隔符，好讀目錄常用）→ 半形豎線
    0xFF5C: "|",
}
_VERT_TABLE = str.maketrans({cp: ord(h) for cp, h in VERT_TO_HORIZ.items()})


def clean_pdb_text(s: str) -> str:
    """去掉 PDB 書籤／控制碼、私用區與好讀導航索引字（U+3400–U+3597），直排標點轉橫排；
    保留換行與全形空格。"""
    s = s.replace("\r\n", "\n").replace("\r", "\n")
    s = CTRL.sub("", s)
    s = s.replace("\ufeff", "").replace("\uffff", "").replace("\ufffd", "")
    s = re.sub(r"[†\x1b]+", "", s)          # 好讀目錄／書籤標記
    s = re.sub(r"[\u3400-\u3597]", "", s)   # 好讀導航索引字（㐀…㖗），非作者正文，全數去除
    s = re.sub(r"[\uE000-\uF8FF]", "", s)   # 私用區（mis-decoded binary）
    # 導航索引被當 UTF-16LE 解出來的跨語系亂碼（吉木基/僧伽羅/格拉哥里/科普特/巴厘/蒙古/BopomofoExt/Tifinagh），
    # 這些語系絕不會出現在中文正文，視為 junk 去除（韓文不在此列，可能是合法韓文引用）。
    s = re.sub(r"[\u0A00-\u0A7F\u0D80-\u0DFF\u2C00-\u2C5F\u2C80-\u2CFF\u1B00-\u1B7F\u1800-\u18AF\u1A00-\u1A1F\u2D30-\u2D7F]", "", s)
    s = s.translate(_VERT_TABLE)            # 豎排標點 → 橫排對應
    s = re.sub(r"[ \t]+\n", "\n", s)
    s = re.sub(r"\n{4,}", "\n\n\n", s)
    return s.strip()


# 目錄 record 的「保留集」：CJK、CJK 標點/符號、全/半形表意形式、ASCII 可印、空白。
# 好讀導航索引被當 UTF-16LE 解出來的跨語系亂碼（僧伽羅文/古木基文/科普特文/諺文/私用區…）
# 都不在此集內，視為 junk 去除；真實章名（如「羅開系列一 鬼鐘」）則完整保留。
_TOC_KEEP = re.compile(
    r"[^"
    r"\u3400-\u4dbf"   # CJK Ext-A
    r"\u4e00-\u9fff"   # CJK
    r"\uf900-\ufaff"   # CJK 相容
    r"\u3000-\u303f"   # CJK 符號/標點
    r"\uff00-\uffef"   # 全/半形表意形式
    r"\u0020-\u007e"   # ASCII 可印
    r"\n\r\t"
    r"]"
)


def clean_toc_text(s: str) -> str:
    """目錄 record 含導航索引的跨語系亂碼，只保留中文/CJK 標點/全形/ASCII，其餘去除。"""
    s = re.sub(r"[\u3400-\u3597]", "", s)   # 導航索引字
    s = re.sub(r"[\uE000-\uF8FF]", "", s)   # 私用區
    s = s.replace("\ufffd", "")
    s = s.translate(_VERT_TABLE)            # 直排轉橫排
    s = _TOC_KEEP.sub("", s)                # 去跨語系亂碼
    s = re.sub(r"[ \t\u3000]+", " ", s)     # 折疊空白但保留換行
    s = re.sub(r"\n{3,}", "\n\n", s)        # 過多換行壓成雙換行
    return s.strip()


def _toc_looks_garbled(s: str) -> bool:
    """判斷清洗後的目錄是否仍含偽中文亂碼，僅用於 log 分類（不影響清除決策）。

    真實中文 TOC 的漢字成詞成句（連續 run≥2）；偽中文則是單個漢字黏在拉丁字母／符號旁，
    如 081110N15 的「輀^{z洰豻z」。這類偽中文落在合法 CJK 碼位，無法用碼位過濾區分，
    故政策上整段丟棄 record 0。
    """
    if not s.strip():
        return True
    if re.search(r"[\u3400-\u9fff][A-Za-z]|[A-Za-z][\u3400-\u9fff]", s):
        return True
    runs = re.findall(r"[\u3400-\u9fff]+", s)
    if runs and sum(1 for r in runs if len(r) == 1) / len(runs) > 0.5 \
            and sum(len(r) for r in runs) < 200:
        return True
    return False


def decode_pdb(data: bytes, rid: str | None = None,
               cleared: list | None = None) -> list[tuple[str, str]]:
    """回傳 [(kind, text), ...]；kind = chapter。

    record 0 是好讀的導航索引／目錄，內含跨語系亂碼與「偽中文」殘片（導航索引二進位被
    誤解成 UTF-16LE 後，恰好落在合法 CJK 碼位，無法以碼位過濾區分，例如 081110N15 的
    「困獸輀^{z洰豻z…」）。為確保使用者絕對看不到亂碼，本管線**整段丟棄 record 0**，
    其經 clean_toc_text 清洗後的原始內容（含乾淨章名清單）存入 cleared 供稽核，
    不寫入書本純文字檔。record 1+ 為正文，用 clean_pdb_text。
    """
    if len(data) < 78 or data[60:64] != b"BOOK":
        raise ValueError("不是 PDB BOOK 容器")
    # 編碼判定：好讀原生 updb 的 creator 為 b"MTIU"，內文是未壓縮 UTF-16LE；
    # 部分書（早期書／分享區）是標準 Palm PDB，creator 為 b"MTIT"，內文為 Big5。
    # 兩者檔頭都是 BOOK 容器，但 creator 不同，必須據此切換解碼編碼，
    # 否則 Big5 書會被當 UTF-16LE 整本誤解成韓文亂碼（book__257 / share__0961 即此例）。
    creator = data[64:68]
    enc = "utf-16-le" if creator == b"MTIU" else "big5"
    n = struct.unpack(">H", data[76:78])[0]
    offs = [struct.unpack(">I", data[78 + i * 8:82 + i * 8])[0] for i in range(n)]
    offs.append(len(data))
    out: list[tuple[str, str]] = []
    for i in range(n):
        raw = data[offs[i]:offs[i + 1]]
        if enc == "utf-16-le" and len(raw) % 2:   # UTF-16 需雙位元組對齊；Big5 奇數長度是正常的
            raw = raw[:-1]
        if not raw or raw in (b"\xff\xff", b""):
            continue
        try:
            raw_dec = raw.decode(enc)
        except UnicodeDecodeError:
            raw_dec = raw.decode(enc, errors="replace")
        if i == 0:
            # record 0 = 目錄／導航索引：整段清除，原始（已清洗）內容留 log 供稽核。
            if cleared is not None and rid is not None:
                toc = clean_toc_text(raw_dec)
                classification = "garbage" if _toc_looks_garbled(toc) else "clean"
                cleared.append((rid, len(toc), classification,
                                re.sub(r"[\t\n\r]+", " / ", toc)[:1500]))
            continue
        s = clean_pdb_text(raw_dec)
        if not s or not CJK.search(s):
            continue
        out.append(("chapter", s))
    if not out:
        raise ValueError("PDB 內找不到可解出的正文 record（目錄 record 0 已整段清除）")
    return out


def decode_epub(data: bytes) -> list[tuple[str, str]]:
    """依 OPF spine 順序還原章節。"""
    z = zipfile.ZipFile(io.BytesIO(data))
    names = set(z.namelist())
    container = z.read("META-INF/container.xml").decode("utf-8", "replace") \
        if "META-INF/container.xml" in names else ""
    m = re.search(r'full-path="([^"]+)"', container)
    opf_path = m.group(1) if m else next((x for x in names if x.endswith(".opf")), None)
    if not opf_path or opf_path not in names:
        raise ValueError("找不到 OPF")
    opf = z.read(opf_path).decode("utf-8", "replace")
    base = opf_path.rsplit("/", 1)[0] + "/" if "/" in opf_path else ""
    # 屬性順序不固定（有些書是 href 在前、id 在後），逐標籤各自取值
    items = {}
    for tag in re.findall(r"<item\b[^>]*>", opf, flags=re.I):
        m_id = re.search(r'\bid="([^"]+)"', tag)
        m_href = re.search(r'\bhref="([^"]+)"', tag)
        if m_id and m_href:
            items[m_id.group(1)] = m_href.group(1)
    spine = []
    for tag in re.findall(r"<itemref\b[^>]*>", opf, flags=re.I):
        m_ref = re.search(r'\bidref="([^"]+)"', tag)
        if m_ref:
            spine.append(m_ref.group(1))
    out: list[tuple[str, str]] = []
    for k, sid in enumerate(spine):
        href = items.get(sid)
        if not href:
            continue
        name = base + href
        if name not in names:
            continue
        raw = z.read(name).decode("utf-8", "replace")
        raw = re.sub(r"<(script|style)\b[\s\S]*?</\1>", "", raw, flags=re.I)
        txt = html.unescape(re.sub(r"<[^>]+>", " ", raw))
        txt = re.sub(r"[\u3400-\u3597]", "", txt)   # 好讀導航索引字
        txt = re.sub(r"[\uE000-\uF8FF]", "", txt)   # 私用區
        txt = re.sub(r"[\u0A00-\u0A7F\u0D80-\u0DFF\u2C00-\u2C5F\u2C80-\u2CFF\u1B00-\u1B7F\u1800-\u18AF\u1A00-\u1A1F\u2D30-\u2D7F]", "", txt)  # 跨語系亂碼
        txt = txt.replace("\ufffd", "")
        txt = txt.translate(_VERT_TABLE)            # 直排標點 → 橫排對應
        txt = re.sub(r"[ \t\u3000]+", " ", txt)
        txt = re.sub(r"\s*\n\s*", "\n", txt).strip()
        if txt and CJK.search(txt):
            out.append(("toc" if k == 0 and "目錄" in txt[:30] else "chapter", txt))
    if not out:
        raise ValueError("EPUB 內找不到本文")
    return out


def main() -> None:
    src = MAN / "files.tsv"
    if not src.exists():
        raise SystemExit(f"缺少 {src}，請先跑 bun run src/fetch-haodoo-archive.mjs files")
    with src.open(encoding="utf-8") as f:
        rows = list(csv.DictReader(f, delimiter="\t"))
    print(f"解碼 {len(rows)} 本書 → {OUT}")

    corpus, chapters, failures, cleared_toc = [], [], [], []
    for n, r in enumerate(rows, 1):
        rid, ext, path = r["id"], r["ext"], Path(r["file"])
        if not path.exists():
            failures.append([rid, ext, "檔案不存在", str(path)])
            continue
        data = path.read_bytes()
        try:
            parts = decode_epub(data) if ext == "epub" else decode_pdb(data, rid, cleared_toc)
        except Exception as e:
            if (OUT / f"{rid}.txt").exists():
                (OUT / f"{rid}.txt").unlink()
            failures.append([rid, ext, f"{type(e).__name__}: {e}", str(path)])
            continue

        text = "\n\n\n".join(t for _, t in parts)
        # 整本毀損偵測：源頭檔案即損壞的書（如 book__257 / share__0961），其導航索引被誤解成
        # UTF-16LE 後大量落入韓文（Hangul）碼位，導致正文充滿韓文垃圾。合法中文書幾乎不含
        # 韓文（全量 4163 本僅 2 本 <0.1% 且皆零星字元）。韓文佔比 >5% 即判定整本毀損，
        # 排除出語料並刪除其 .txt，絕不讓使用者看到亂碼。
        tc = len(text)
        hg = len(HANGUL.findall(text))
        if tc >= 200 and hg / tc > 0.05:
            if (OUT / f"{rid}.txt").exists():
                (OUT / f"{rid}.txt").unlink()
            failures.append([rid, ext,
                            f"corrupted: navigation-index misdecode (韓文佔比 {hg/tc:.2%})",
                            str(path)])
            continue
        (OUT / f"{rid}.txt").write_text(text, encoding="utf-8")
        sha = hashlib.sha256(text.encode("utf-8")).hexdigest()
        cjk = len(CJK.findall(text))
        corpus.append([rid, r["title"], r["author"], ext, len(parts), len(text), cjk,
                       sha, r["sha256"], str(path)])

        pos = 0
        for k, (kind, t) in enumerate(parts):
            title = next((ln.strip() for ln in t.split("\n") if ln.strip()), "")[:60]
            chapters.append([rid, k, kind, title, len(t), len(CJK.findall(t)), pos])
            pos += len(t) + 3
        if n % 200 == 0:
            print(f"  ... {n}/{len(rows)}")

    def write(name, header, data):
        with (MAN / name).open("w", encoding="utf-8", newline="") as f:
            w = csv.writer(f, delimiter="\t", lineterminator="\n")
            w.writerow(header)
            w.writerows(data)

    write("corpus.tsv",
          ["id", "title", "author", "ext", "chapters", "chars", "cjk_chars",
           "text_sha256", "source_sha256", "source_file"], corpus)
    write("chapters.tsv",
          ["id", "ch_index", "kind", "ch_title", "chars", "cjk_chars", "char_offset"], chapters)
    write("decode-fail.tsv", ["id", "ext", "error", "file"], failures)
    write("toc-cleared.tsv",
          ["id", "toc_chars", "classification", "toc_content"], cleared_toc)
    total = sum(int(c[6]) for c in corpus)
    print(f"完成：解出 {len(corpus)} 本、{len(chapters)} 章、漢字 {total:,} 字；失敗 {len(failures)} 本")
    print(f"目錄 record 0 整段清除 {len(cleared_toc)} 本，清除內容詳見 {MAN / 'toc-cleared.tsv'}")
    if failures:
        print(f"失敗詳見 {MAN / 'decode-fail.tsv'}")


if __name__ == "__main__":
    main()
