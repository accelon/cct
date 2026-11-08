# -*- coding: utf-8 -*-
"""
fetch-wikisource.py — 從 zh.wikisource.org 抓取古籍原文 wikitext 到 D:/2026/cct/raw/<workId>/

用法：
    python src/fetch-wikisource.py                 # 全部 work
    python src/fetch-wikisource.py shiji laozi     # 只抓指定 work

設計要點：
    * 走 curl（urllib 對 wikimedia 的 chunked 回應會 IncompleteRead，curl 實測穩定）。
    * prop=revisions 支援多標題：一次 API 呼叫帶 40 頁，內容＋revid＋timestamp 一次取回。
    * #REDIRECT / #重定向 頁以單頁請求解析一層並改存目標頁。
    * 每個 work 產出 manifest.json（頁清單、revid、sha256、大小、來源、授權、抓取時間）。
    * 斷點續抓：目錄掃描已存在 .wiki 檔即跳過。
    * 禮貌節流：批次間 3–5 秒；API 429 限流則退避 60–120 秒。
"""
import hashlib
import json
import random
import re
import subprocess
import sys
import time
from datetime import datetime, timezone, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]          # D:/2026/cct
RAW = ROOT / 'raw'
API = 'https://zh.wikisource.org/w/api.php'
UA = 'cct-corpus/1.0 (Chinese Citation Texts corpus sourcing; polite; contact via Wikimedia account)'
BATCH = 40
CST = timezone(timedelta(hours=8))

# 各 work：prefix（站上命名空間）＋ 標題過濾 regex（只收正文卷／篇頁）
WORKS = [
    dict(id='shiji',       prefix='史記/',     pat=r'^史記/卷\d{3}$'),
    dict(id='shiji3',       prefix='史記三家註/', pat=r'^史記三家註/卷\d{3}$'),
    dict(id='hanshu',       prefix='漢書/',     pat=r'^漢書/卷\d{3}(上|下)?$'),
    dict(id='houhanshu',    prefix='後漢書/',   pat=r'^後漢書/卷\d+(上|下)?$'),
    dict(id='sanguozhi',    prefix='三國志/',   pat=r'^三國志/卷\d{1,2}(上|下)?$'),
    dict(id='wenxuan',      prefix='昭明文選/',  pat=r'^昭明文選/(卷\d{1,2}|序)$'),
    dict(id='guoyu',        prefix='國語/',     pat=r'^國語/卷\d{1,2}$'),
    dict(id='zhanguoce',    prefix='戰國策/',   pat=r'^戰國策/卷\d{1,2}$'),
    dict(id='zhuangzi',     prefix='莊子/',     pat=r'^莊子/[^/]+$'),
    dict(id='xunzi',        prefix='荀子/',     pat=r'^荀子/[^/]+$'),
    dict(id='hanfeizi',     prefix='韓非子/',   pat=r'^韓非子/[^/]+$'),
    dict(id='huainanzi',    prefix='淮南子/',   pat=r'^淮南子/[^/]+$'),
    dict(id='lvshichunqiu', prefix='呂氏春秋/', pat=r'^呂氏春秋/[^/]+$'),
    dict(id='lunheng',      prefix='論衡/',     pat=r'^論衡/[^/]+$'),
]
# 單頁 work（非 prefix 結構）
SINGLES = [
    dict(id='laozi', pages=['道德經 (王弼本)']),
]


def curl_json(params, tries=5):
    """GET API → dict。回應非 JSON（錯誤頁／429）一律重試。"""
    cmd = ['curl', '-sS', '--compressed', '-A', UA, '--max-time', '120', '--get', API]
    for k, v in params.items():
        cmd += ['--data-urlencode', f'{k}={v}']
    last = None
    for i in range(tries):
        try:
            out = subprocess.run(cmd, capture_output=True, timeout=150)
            if out.returncode != 0:
                raise RuntimeError(f'curl exit {out.returncode}: {out.stderr.decode("utf8", "replace")[:200]}')
            body = out.stdout.strip()
            if not body or not body.startswith(b'{'):
                if b'too many requests' in body.lower():
                    wait = 60 * (i + 1)
                    print(f'    … API 限流，等 {wait}s', flush=True)
                    time.sleep(wait)
                    last = RuntimeError('rate limited')
                    continue
                raise RuntimeError(f'non-JSON response: {body[:80]!r}')
            return json.loads(body.decode('utf8'))
        except Exception as e:                      # noqa: BLE001
            last = e
            time.sleep(3.0 * (i + 1))
    raise RuntimeError(f'curl_json failed after {tries} tries: {last}')


def list_pages(prefix):
    """allpages 列舉某前綴下所有頁面（含分頁輪轉）。"""
    out, kw = [], {}
    while True:
        r = curl_json(dict(action='query', list='allpages', apprefix=prefix,
                           aplimit='500', format='json', **kw))
        out += [p['title'] for p in r['query']['allpages']]
        c = r.get('continue')
        if not c:
            return out
        kw = {'apcontinue': c['apcontinue']}


def fetch_batch(titles):
    """一次 API 呼叫抓 ≤40 頁。回傳 (ok: title→dict, missing: [title])。"""
    r = curl_json(dict(action='query', format='json', prop='revisions',
                       rvprop='ids|timestamp|content', rvslots='main',
                       titles='|'.join(titles)))
    ok, missing = {}, []
    for page in r['query']['pages'].values():
        if 'missing' in page:
            missing.append(page.get('title', '?'))
            continue
        rv = (page.get('revisions') or [None])[0]
        if rv is None:
            missing.append(page.get('title', '?'))
            continue
        ok[page['title']] = dict(title=page['title'], revid=rv['revid'],
                                 timestamp=rv['timestamp'],
                                 content=rv['slots']['main']['*'])
    return ok, missing


def fetch_one(title):
    ok, _ = fetch_batch([title])
    return ok.get(title)


def is_redirect(text):
    head = text[:200].strip().lower()
    return head.startswith('#redirect') or head.startswith('#重定向')


def redirect_target(text):
    m = re.search(r'\[\[([^\]|#]+)', text)
    return m.group(1).strip() if m else None


def file_name_for(title, prefix):
    """title 在 prefix 下且其餘部分無 '/' → 用尾段；否則全路徑（防同名互蓋）。"""
    if prefix and title.startswith(prefix):
        rest = title[len(prefix):]
        if '/' not in rest:
            return rest + '.wiki'
    return title.replace('/', '_') + '.wiki'


def save(d, title, content, metas, seen, prefix=''):
    """存一頁；回傳是否新存。"""
    if title in seen:
        return False
    name = file_name_for(title, prefix)[:-5]
    p = d / (name + '.wiki')
    p.write_text(content, encoding='utf8', newline='\n')
    metas.append(dict(title=title, file=p.name, bytes=p.stat().st_size,
                      sha256=hashlib.sha256(content.encode('utf8')).hexdigest()[:16]))
    seen.add(title)
    return True


def fetch_work(w):
    wid = w['id']
    if 'pages' in w:                                # 單頁 work
        titles = list(w['pages'])
    else:
        titles = [t for t in list_pages(w['prefix']) if re.match(w['pat'], t)]
        titles.sort()
    metas, seen = [], set()
    d = RAW / wid
    d.mkdir(parents=True, exist_ok=True)
    # 斷點續抓：目錄掃描，已存在的 .wiki 直接補進 manifest 並跳過
    prefix = w.get('prefix', '')
    for t in titles:
        name = file_name_for(t, prefix)
        fp = d / name
        if fp.exists():
            content = fp.read_text(encoding='utf8')
            metas.append(dict(title=t, file=name, bytes=fp.stat().st_size,
                              sha256=hashlib.sha256(content.encode('utf8')).hexdigest()[:16],
                              cached=True))
            seen.add(t)
    todo = [t for t in titles if t not in seen]
    print(f'[{wid}] {len(titles)} 頁（已有 {len(seen)}，待抓 {len(todo)}）', flush=True)
    redirects_done = set()
    for n0 in range(0, len(todo), BATCH):
        chunk = todo[n0:n0 + BATCH]
        ok, _missing = fetch_batch(chunk)
        for t in chunk:
            r = ok.get(t)
            if r is None:
                if t not in redirects_done:
                    print(f'  !! 缺頁或空 {t}', flush=True)
                continue
            content = r['content']
            if is_redirect(content):
                tgt = redirect_target(content)
                if tgt:
                    r2 = ok.get(tgt) or fetch_one(tgt)
                    if r2 and not is_redirect(r2['content']):
                        if save(d, r2['title'], r2['content'], metas, seen, w['prefix'] if 'prefix' in w else ''):
                            metas[-1]['redirect_from'] = t
                            metas[-1]['revid'] = r2['revid']
                redirects_done.add(t)
                continue
            if save(d, r['title'], content, metas, seen, w['prefix'] if 'prefix' in w else ''):
                metas[-1]['revid'] = r['revid']
                metas[-1]['timestamp'] = r['timestamp']
        print(f'  … {min(n0 + BATCH, len(todo))}/{len(todo)}', flush=True)
        time.sleep(random.uniform(3, 5))
    n_redir = sum(1 for m in metas if 'redirect_from' in m)
    print(f'[{wid}] 其中重定向解析 {n_redir} 頁', flush=True)
    mf = dict(source='zh.wikisource.org (MediaWiki API prop=revisions)',
              fetched=datetime.now(CST).isoformat(timespec='seconds'),
              license='CC BY-SA 4.0',
              work=wid, pages=len(metas),
              note=WORK_NOTE.get(wid, ''),
              manifest=metas)
    (d / 'manifest.json').write_text(
        json.dumps(mf, ensure_ascii=False, indent=1), encoding='utf8')
    print(f'[{wid}] 完成：{len(metas)} 頁', flush=True)


WORK_NOTE = {
    'shiji': '司馬遷；卷001–130；頁面 textquality 75%，含張文虎札記校勘記與 {{專}}{{書}} 標注',
    'shiji3': '史記三家註（裴駰集解／司馬貞索隱／張守節正義）；卷001–130',
    'hanshu': '班固；卷001–100（部分分上／下）；==節== 現代小標題',
    'houhanshu': '范曄；卷1–130 章懷太子注本',
    'sanguozhi': '陳壽；卷01–65；裴松之注以 {{*|…}} 內嵌',
    'wenxuan': '蕭統編；卷1–60＋序（站上命名「昭明文選」）',
    'guoyu': '國語；卷1–21',
    'zhanguoce': '戰國策；卷01–33 為重定向頁，正文在「戰國策 (士禮居叢書本)」國別／篇結構',
    'zhuangzi': '莊子；內7＋外15＋雜11 篇；textquality 100%，含 {{另|通行|異體}} 異文標注',
    'xunzi': '荀子；32 篇＋序；楊倞注以 {{*|…}} 內嵌',
    'hanfeizi': '韓非子；20 卷（篇）',
    'huainanzi': '淮南子；21 篇',
    'lvshichunqiu': '呂氏春秋；26 卷',
    'lunheng': '王充論衡；85 篇',
    'laozi': '老子王弼本（樓宇烈校《王弼集校釋》底本）；81 章；王弼注以 {{*|…}} 內嵌',
}


def main():
    args = sys.argv[1:]
    todo = WORKS + SINGLES
    if args:
        todo = [w for w in todo if w['id'] in args]
        unknown = [a for a in args if a not in {w['id'] for w in WORKS + SINGLES}]
        if unknown:
            print('未知 work:', unknown, '可選:', [w['id'] for w in WORKS + SINGLES])
            return 1
    RAW.mkdir(exist_ok=True)
    t0 = time.time()
    for w in todo:
        fetch_work(w)
    print(f'全部完成，用時 {time.time()-t0:.0f}s', flush=True)
    return 0


if __name__ == '__main__':
    sys.exit(main())
