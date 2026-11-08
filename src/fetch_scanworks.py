# -*- coding: utf-8 -*-
"""
fetch_scanworks.py — 擷取「掃描轉錄（DjVu/Page 命名空間）」型作品。

這類作品在 main 命名空間只有 <pages .../> 或 {{transclude pages|...djvu}} 殘樁，
真實 OCR 文字在 Page: 命名空間。直接用 prop=revisions 只會拿到殘樁，
因此改以 action=parse（prop=text）讓 MediaWiki 伺服器端展開 transclusion，
再把渲染後的 HTML 還原成純文字。

用法：
    python3 fetch_scanworks.py            # 擷取 SPEC 內全部
    python3 fetch_scanworks.py erya       # 只擷取指定 work_id
"""
import sys, re, json, hashlib, time, random, subprocess
from datetime import datetime, timezone, timedelta
from pathlib import Path

ROOT = Path(r'D:/2026/cct')
RAW = ROOT / 'raw'
API = 'https://zh.wikisource.org/w/api.php'
UA = 'cct-corpus/1.0 (Chinese Citation Texts corpus sourcing; polite; contact via Wikimedia account)'

# (work_id, ws_prefix, cat)
SPEC = [
    ('erya',  '爾雅 (四部叢刊本)',      'JING'),
    ('jiyun', '集韻 (四庫全書本)',      'XIAO'),
]

CST = timezone(timedelta(hours=8))


def curl_json(params, tries=6):
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
                    print(f'    … API 限流，等 {wait}s', flush=True)
                    time.sleep(wait)
                    last = RuntimeError('rate limited')
                    continue
                raise RuntimeError(f'non-JSON: {body[:80]!r}')
            return json.loads(body.decode('utf8'))
        except Exception as e:                      # noqa
            last = e
            time.sleep(4.0 * (i + 1))
    raise RuntimeError(f'curl_json failed: {last}')


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


def parse_text(title):
    r = curl_json(dict(action='parse', page=title, prop='text', format='json'))
    return r.get('parse', {}).get('text', {}).get('*', '')


_BR = re.compile(r'</(p|div|tr|li|h[1-6]|dd|dt)>', re.I)
_BR2 = re.compile(r'<(br|/tr|/table|/ul|/ol)[^>]*>', re.I)
_STYLE = re.compile(r'<style[^>]*>.*?</style>', re.S | re.I)
_SCRIPT = re.compile(r'<script[^>]*>.*?</script>', re.S | re.I)
_TAG = re.compile(r'<[^>]+>')
_ARROW = re.compile(r'←[^→]*→')
_WS = re.compile(r'[ \t]+')
_NL = re.compile(r'\n{2,}')


def clean(html):
    html = _STYLE.sub(' ', html)
    html = _SCRIPT.sub(' ', html)
    html = _BR.sub('\n', html)
    html = _BR2.sub('\n', html)
    txt = _TAG.sub(' ', html)
    txt = _ARROW.sub(' ', txt)
    txt = _WS.sub(' ', txt)
    txt = txt.replace('\u200b', '')          # zero-width space
    txt = txt.replace('\u3000', ' ')         # ideographic space -> normal
    txt = _NL.sub('\n', txt)
    return txt.strip()


def file_name_for(title, prefix):
    rest = title[len(prefix):] if title.startswith(prefix) else title
    if rest.startswith('/'):
        rest = rest[1:]
    return rest.replace('/', '_') + '.wiki'


def fetch_work(wid, prefix, cat):
    titles = [t for t in list_pages(prefix + '/') if t.startswith(prefix + '/')]
    titles.sort()
    d = RAW / wid
    d.mkdir(parents=True, exist_ok=True)
    metas = []
    done = 0
    for t in titles:
        name = file_name_for(t, prefix)
        fp = d / name
        if fp.exists():
            metas.append(dict(title=t, file=name, bytes=fp.stat().st_size, cached=True))
            continue
        try:
            html = parse_text(t)
            text = clean(html)
        except Exception as e:
            print(f'  !! 解析失敗 {t}: {e}', flush=True)
            time.sleep(5)
            continue
        if not text:
            print(f'  !! 空文字 {t}', flush=True)
            continue
        fp.write_text(text, encoding='utf8', newline='\n')
        metas.append(dict(title=t, file=name, bytes=fp.stat().st_size,
                          sha256=hashlib.sha256(text.encode('utf8')).hexdigest()[:16],
                          method='action=parse+OCR'))
        done += 1
        if done % 10 == 0:
            print(f'  … {done} 頁已擷取（累計 {len(metas)}）', flush=True)
        time.sleep(random.uniform(1.5, 3.0))
    mf = dict(source='zh.wikisource.org (MediaWiki action=parse, OCR from Page namespace)',
              fetched=datetime.now(CST).isoformat(timespec='seconds'),
              license='CC BY-SA 4.0',
              note='OCR 文字，來自掃描版 Page: 命名空間，經 action=parse 展開轉錄後還原純文字',
              work=wid, cat=cat, pages=len(metas), manifest=metas)
    (d / 'manifest.json').write_text(json.dumps(mf, ensure_ascii=False, indent=1), encoding='utf8')
    print(f'[{wid}] 完成：{len(metas)} 頁（新擷 {done}，已有 {len(metas)-done}）', flush=True)


def main():
    want = set(sys.argv[1:]) or None
    for wid, prefix, cat in SPEC:
        if want and wid not in want:
            continue
        print(f'\n##### {wid}  (prefix={prefix}/) #####', flush=True)
        try:
            fetch_work(wid, prefix, cat)
        except Exception as e:
            print(f'[{wid}] 失敗：{e}', flush=True)
        time.sleep(2)


if __name__ == '__main__':
    main()
