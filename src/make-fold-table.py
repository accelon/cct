"""make-fold-table.py — 依 gycd 的 norm_char(tier=1) 產生逐字摺疊表

为什么要在 cct 區內放一份「表」而不是直接 import gycd：
  builder 是 TS（bun），母區紀律又不能依賴別區的執行期；把 gycd 的
  NFKC → OpenCC s2t → VMAP 結果凍結成資料表，TS 端只需查表 + sha256，
  就能復現 ancient-book-xref-spec.md §4.4 的 textHash。

用法：
  python src/make-fold-table.py out/13j.xml out/swjz.xml
輸出：
  data/char-fold.tsv   （首行是 provenance 註解）
"""
import ast
import hashlib
import os
import re
import sys
import unicodedata

try:
    from opencc import OpenCC
except ImportError:
    sys.exit("需要 opencc：pip install opencc-python-reimplemented（或官方 OpenCC 綁定）")

GycdSrc = r"D:\2026\gycd\interlink-coverage.py"
# 漢字定義一律用 gycd 同一套（regex 模組的 \p{Script=Han}；Python 內建 re 不支援）
try:
    import regex  # type: ignore
    HAN = regex.compile(r"\p{Script=Han}")
except ImportError:
    sys.exit("需要 regex 模組（pip install regex），與 gycd 同一套漢字定義")


def extract_vmap(path: str) -> dict:
    """從 gycd 的原始碼讀 VMAP 字面值，不手抄、不憑記憶。"""
    src = open(path, encoding="utf-8").read()
    m = re.search(r"^VMAP\s*=\s*(\{.*?^\})", src, re.S | re.M)
    if not m:
        raise SystemExit(f"找不到 VMAP：{path}")
    return ast.literal_eval(m.group(1))


def norm_char(c: str, cc, vmap: dict) -> str:
    """完全照 ancient-book-xref-spec.md §4.4 的五步。"""
    n = unicodedata.normalize("NFKC", c)
    hs = HAN.findall(n)
    x = hs[0] if hs else c
    y = cc.convert(x)
    yh = HAN.findall(y)
    x = yh[0] if yh else x
    return vmap.get(x, x)


def main() -> None:
    corpus_paths = sys.argv[1:] or ["out/13j.xml"]
    vmap = extract_vmap(GycdSrc)
    cc = OpenCC("s2t")

    chars = set()
    for p in corpus_paths:
        text = open(p, encoding="utf-8").read()
        text = re.sub(r"<[^>]*>", "", text)          # 去標籤，只留正文
        chars.update(HAN.findall(text))

    src_sha = hashlib.sha256(open(GycdSrc, "rb").read()).hexdigest()[:12]
    rows = []
    changed = 0
    for c in sorted(chars):
        f = norm_char(c, cc, vmap)
        if f != c:
            changed += 1
        rows.append(f"{c}\t{f}")

    os.makedirs("data", exist_ok=True)
    header = "\n".join([
        f"# provenance: gycd/interlink-coverage.py VMAP ({len(vmap)} entries), sha256[:12]={src_sha}",
        "# rule: unicodedata.NFKC -> first \\p{Script=Han} -> OpenCC s2t -> first Han -> VMAP",
        f"# corpus chars={len(chars)} 摺疊後不同={changed} 相同={len(chars) - changed}",
        f"# sources={','.join(corpus_paths)}",
    ])
    with open("data/char-fold.tsv", "w", encoding="utf-8") as fh:
        fh.write(header + "\n")
        fh.write("\n".join(rows) + "\n")

    print(f"chars={len(chars)} folded_diff={changed} vmap={len(vmap)} src_sha={src_sha} -> data/char-fold.tsv")


if __name__ == "__main__":
    main()
