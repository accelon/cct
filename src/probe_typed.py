# -*- coding: utf-8 -*-
"""probe_typed.py — 探測候選命名空間是否為「打字稿（真實文字）」或「掃描轉錄殘樁」。
對每個候選 prefix：列出頁面，抓第一個「卷/篇」頁，判斷是否為 stub（含 <pages 或 transclude pages）。
"""
import sys, re, time, random, json, subprocess
from pathlib import Path

API = 'https://zh.wikisource.org/w/api.php'
UA = 'cct-corpus/1.0 (Chinese Citation Texts corpus sourcing; polite)'

def curl_json(params, tries=5):
    cmd = ['curl', '-sS', '--compressed', '-A', UA, '--max-time', '120', '--get', API]
    for k, v in params.items():
        cmd += ['--data-urlencode', f'{k}={v}']
    last = None
    for i in range(tries):
        try:
            out = subprocess.run(cmd, capture_output=True, timeout=150)
            if out.returncode != 0:
                raise RuntimeError(f'curl exit {out.returncode}')
            body = out.stdout.strip()
            if not body or not body.startswith(b'{'):
                if b'too many requests' in body.lower():
                    wait = 60 * (i + 1)
                    print(f'    … 限流，等 {wait}s', flush=True)
                    time.sleep(wait); last = RuntimeError('rl'); continue
                raise RuntimeError(f'non-JSON: {body[:80]!r}')
            return json.loads(body.decode('utf8'))
        except Exception as e:                      # noqa
            last = e; time.sleep(3.0 * (i + 1))
    raise RuntimeError(f'fail: {last}')

def list_pages(prefix):
    out, kw = [], {}
    while True:
        r = curl_json(dict(action='query', list='allpages', apprefix=prefix,
                           aplimit='500', format='json', **kw))
        out += [p['title'] for p in r.get('query', {}).get('allpages', [])]
        c = r.get('continue')
        if not c:
            return out
        kw = {'apcontinue': c['apcontinue']}

def fetch_content(title):
    r = curl_json(dict(action='query', format='json', prop='revisions',
                       rvprop='content', rvslots='main', titles=title))
    for page in r.get('query', {}).get('pages', {}).values():
        rv = (page.get('revisions') or [None])[0]
        if rv:
            return rv['slots']['main']['*']
    return None

def is_stub(text):
    if text is None:
        return True
    h = text[:400]
    return ('<pages ' in text or 'transclude pages' in text or
            '{{transclude' in text or '<pages' in text)

# (work_id, [候選 prefix...])
CANDIDATES = {
    'suwen': ['黄帝内經素問 (四庫全書本)', '素問 (四庫全書本)', '黃帝內經素問 (四庫全書本)'],
    'jiyun': ['集韻 (四庫全書本)', '集韻', '欽定四庫全書/集韻', '集韻 (漢文數位典藏)'],
    'erya':  ['爾雅 (四庫全書本)', '爾雅', '爾雅注疏', '爾雅 (四部備要本)'],
}

def first_real_page(pages, prefix):
    # 過濾掉 序/目録/凡例/校勘 等，找第一個卷/篇
    cand = []
    for t in pages:
        name = t[len(prefix):] if t.startswith(prefix) else t
        if name in ('序.wiki', '序', '目錄', '目録', '凡例', '校勘記') or '序' in name:
            continue
        cand.append(t)
    cand.sort()
    return cand[0] if cand else (pages[0] if pages else None)

for wid, prefs in CANDIDATES.items():
    print(f'\n===== {wid} =====', flush=True)
    for pref in prefs:
        try:
            pages = list_pages(pref + '/')
            match = [p for p in pages if p.startswith(pref + '/')]
            if not match:
                print(f'  [{pref}] 0 命中', flush=True)
                time.sleep(1.0); continue
            # 取第一個卷頁
            t = first_real_page(match, pref + '/')
            if not t:
                print(f'  [{pref}] 命中 {len(match)} 但無卷頁', flush=True)
                time.sleep(1.0); continue
            txt = fetch_content(t)
            stub = is_stub(txt)
            size = len(txt.encode('utf8')) if txt else 0
            print(f'  [{pref}] 命中 {len(match):>3} 頁 | 取「{t}」 len={size:>6} {"STUB" if stub else "TEXT(可能打字稿)"}', flush=True)
            if not stub and size > 500:
                # 再多抓一頁確認
                idx = match.index(t)
                t2 = match[idx+1] if idx+1 < len(match) else None
                if t2:
                    txt2 = fetch_content(t2)
                    print(f'          複驗「{t2}」 len={len(txt2.encode("utf8")) if txt2 else 0} {"STUB" if is_stub(txt2) else "TEXT"}', flush=True)
        except Exception as e:
            print(f'  [{pref}] ERROR {e}', flush=True)
        time.sleep(random.uniform(2, 4))
