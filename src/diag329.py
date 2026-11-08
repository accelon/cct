#!/usr/bin/env python3
"""診斷：比對『舊解碼器（errors=replace, 寬鬆）』與『新解碼器（嚴格+亂碼過濾）』。
只讀、低記憶體。輸出：哪些本在新解碼器下整本失敗，以及原因。"""
import glob, struct, re, sys

CJK = re.compile(r"[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]")

def old_decode_pdb(data):
    """複刻 decode-haodoo-text.py 的舊邏輯（寬鬆）。"""
    if len(data) < 78 or data[60:64] != b"BOOK": return None
    n = struct.unpack(">H", data[76:78])[0]
    offs = [struct.unpack(">I", data[78+i*8:82+i*8])[0] for i in range(n)]
    offs.append(len(data))
    out = []
    for i in range(n):
        raw = data[offs[i]:offs[i+1]]
        if len(raw) % 2: raw = raw[:-1]
        if not raw or raw in (b"\xff\xff", b""): continue
        try:
            s = raw.decode("utf-16-le")
        except UnicodeDecodeError:
            s = raw.decode("utf-16-le", errors="replace")
        s = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", "", s)
        s = s.replace("\ufeff", "").replace("\uffff", "")
        s = re.sub(r"[†\x1b]+", "", s)
        s = re.sub(r"[\u3500-\u3560]", "", s)
        if not s or not CJK.search(s): continue
        out.append(s)
    return out

def new_decode_pdb(data):
    import importlib.util
    spec = importlib.util.spec_from_file_location("u", "src/updb2xml.py")
    u = importlib.util.module_from_spec(spec); spec.loader.exec_module(u)
    try:
        return u.decode_pdb(data)
    except Exception:
        return []

files = glob.glob("raw/haodoo/files/*.updb") + glob.glob("raw/haodoo/files/*.pdb")
regress = []   # 舊有、新無
by_ext = {}
for fp in files:
    data = open(fp, "rb").read()
    if len(data) < 78 or data[60:64] != b"BOOK":
        by_ext.setdefault("notBOOK", 0); by_ext["notBOOK"] += 1; continue
    n = struct.unpack(">H", data[76:78])[0]
    if n < 2:
        by_ext.setdefault("n<2", 0); by_ext["n<2"] += 1; continue
    old = old_decode_pdb(data)
    new = new_decode_pdb(data)
    ext = "updb" if fp.endswith("updb") else "pdb"
    if old and not new:
        regress.append((fp.split("/")[-1], ext, len(old)))
        by_ext.setdefault(ext, 0); by_ext[ext] = by_ext.get(ext, 0) + 1

print("total files:", len(files))
print("regressed (old kept >=1, new 0 parts):", len(regress))
print("by ext:", by_ext)
print("--- first 25 regressed ---")
for r in regress[:25]:
    print("  ", r)
