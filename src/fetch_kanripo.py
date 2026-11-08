# -*- coding: utf-8 -*-
"""
fetch_kanripo.py — 從 Kanseki Repository (github.com/kanripo, CC BY-SA 4.0) 擷取
爾雅、集韻 等「站上僅掃描版」作品的乾淨全文。

Kanripo 每本一個 repo，文字為 mandoku 格式：
    #+TITLE / #+PROPERTY: JUAN 卷一   （org 頭）
    <pb:KRxxx_WYG_000-1a>             （分頁標記）
    …文字…¶…文字…                    （¶ = 段落分隔）

清理：去掉 # 開頭行、<pb:...> 標記，¶ 轉成換行。
用法：
    python3 fetch_kanripo.py
    python3 fetch_kanripo.py erya jiyun
"""
import sys, re, json, time, subprocess
from datetime import datetime, timezone, timedelta
from pathlib import Path

ROOT = Path(r'D:/2026/cct')
RAW = ROOT / 'raw'

# (work_id, kanripo_repo, 顯示名, cat)
REPOS = [
    ('erya',  'kanripo/KR1j0004', '爾雅注疏',  'JING'),
    ('jiyun', 'kanripo/KR1j0057', '集韻',      'XIAO'),
]

CST = timezone(timedelta(hours=8))
UA = 'cct-corpus/1.0 (Chinese Citation Texts corpus sourcing; polite)'


def curl_get(url, binary=False, tries=5):
    cmd = ['curl', '-sS', '--compressed', '-A', UA, '--max-time', '120', url]
    last = None
    for i in range(tries):
        try:
            out = subprocess.run(cmd, capture_output=True, timeout=150)
            if out.returncode != 0:
                raise RuntimeError(f'curl exit {out.returncode}')
            return out.stdout
        except Exception as e:                      # noqa
            last = e
            time.sleep(3.0 * (i + 1))
    raise RuntimeError(f'curl_get failed {url}: {last}')


def list_txt(repo):
    url = f'https://api.github.com/repos/{repo}/contents/'
    body = curl_get(url)
    import json as _j
    data = _j.loads(body.decode('utf8'))
    return [x['name'] for x in data if x['name'].endswith('.txt')]


_PB = re.compile(r'<pb:[^>]*>')
_SHARP = re.compile(r'^\s*#.*$', re.M)


def clean(text):
    text = _PB.sub('', text)
    text = text.replace('¶', '\n')
    text = _SHARP.sub('', text)
    # 摺疊多餘空白行
    text = re.sub(r'\n{3,}', '\n\n', text)
    return text.strip()


def juan_name(raw):
    m = re.search(r'#\+PROPERTY:\s*JUAN\s+(\S+)', raw)
    if not m:
        return None
    j = m.group(1).strip()
    return None if j in ('0', '') else j


def fetch_work(wid, repo, title, cat):
    files = list_txt(repo)
    files.sort()
    d = RAW / wid
    d.mkdir(parents=True, exist_ok=True)
    metas = []
    used = set()
    for fn in files:
        raw = curl_get(f'https://raw.githubusercontent.com/{repo}/master/{fn}').decode('utf8')
        juan = juan_name(raw)
        if juan:
            base = juan
        else:
            base = '目錄' if fn.endswith('_000.txt') else Path(fn).stem
        name = base + '.wiki'
        if name in used:
            name = Path(fn).stem + '.wiki'
        used.add(name)
        text = clean(raw)
        (d / name).write_text(text, encoding='utf8', newline='\n')
        metas.append(dict(file=name, bytes=len(text.encode('utf8')),
                          source_file=fn,
                          sha256=__import__('hashlib').sha256(text.encode('utf8')).hexdigest()[:16]))
        print(f'  {fn} -> {name}  ({len(text.encode("utf8"))} B)', flush=True)
        time.sleep(0.5)
    mf = dict(source=f'github.com/{repo} (Kanseki Repository, CC BY-SA 4.0)',
              fetched=datetime.now(CST).isoformat(timespec='seconds'),
              license='CC BY-SA 4.0',
              note='Kanripo mandoku 文字，去除 org 頭/<pb>/¶ 後之純文字',
              work=wid, title=title, cat=cat, pages=len(metas), manifest=metas)
    (d / 'manifest.json').write_text(json.dumps(mf, ensure_ascii=False, indent=1), encoding='utf8')
    total = sum(m['bytes'] for m in metas)
    print(f'[{wid}] 完成：{len(metas)} 檔，{total/1024:.0f} KB', flush=True)


def main():
    want = set(sys.argv[1:]) or None
    for wid, repo, title, cat in REPOS:
        if want and wid not in want:
            continue
        print(f'\n##### {wid}  <- github.com/{repo} #####', flush=True)
        fetch_work(wid, repo, title, cat)
        time.sleep(1)


if __name__ == '__main__':
    main()
