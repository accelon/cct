# -*- coding: utf-8 -*-
"""
fetch-more.py — cct 第二波擷取驅動（自含 Wikisource primitives，依 works-registry.py）

用法：
    python3 D:/2026/cct/src/fetch-more.py --validate            # 驗證命名空間（list_pages 計數）
    python3 D:/2026/cct/src/fetch-more.py --validate 周易 楚辭   # 只驗證指定
    python3 D:/2026/cct/src/fetch-more.py                       # 擷取 works-registry.WS_WORKS 全部
    python3 D:/2026/cct/src/fetch-more.py 周易 楚辭             # 只擷取指定 id

注意：本檔自含 Wikisource API primitives（不 import fetch_wikisource，避免跨檔案路徑問題）。
"""
import sys
import re
import json
import hashlib
import random
import time
import subprocess
from datetime import datetime, timezone, timedelta
from pathlib import Path

sys.path.insert(0, r'D:/2026/cct/src')     # 確保同目錄的 works_registry 可被 import
# 下列 registry 直接內聯（避免依賴同目錄檔案；sandbox 下 Python 無法開啟 sibling 檔案）
CAT = {'JING': '經部', 'MID': '古典中小型', 'BIG': '巨型正史編年', 'XIAO': '小學'}


def _pat(name):
    return r'^' + re.escape(name) + r'/.+'


# 每項 = (work_id, ws_base)；work_id = raw/<dir> 名（對齊 works.tsv），
# ws_base = Wikisource 命名空間基名（不含尾斜杠）。
# 13 經 work_id 直接採 works.tsv 既有值；4 本主頁是重定向/空，指向真實命名空間。
_JING = [
    ('yijing', '周易'), ('shangshu', '尚書'), ('shijing', '詩經'),
    ('zhouli', '周禮'), ('yili', '儀禮'), ('liji', '禮記'),
    ('lunyu', '論語'), ('erya', '爾雅 (四部叢刊本)'), ('mengzi', '孟子'),
    ('zuozhuan', '春秋左傳註疏'), ('gongyang', '春秋公羊傳'),
    ('guliang', '春秋穀梁傳'), ('xiaojing', '孝經注疏 (四庫全書本)'),
]
# 古典中小型（21 本；福惠全書/西廂記諸宮調 站上無完整本，已剔除）
_MID = [
    ('chuci', '楚辭'), ('liezi', '列子'), ('mozi', '墨子'), ('guanzi', '管子'),
    ('baopuzi', '抱朴子'), ('shishuoxinyu', '世說新語'), ('shuijingzhu', '水經注'),
    ('shanhaijing', '山海經'), ('yanshijiaxun', '顏氏家訓'), ('yizhouhu', '逸周書'),
    ('wenxindiaolong', '文心雕龍'), ('suwen', '黄帝内經素問 (四庫全書本)'),  # typed 版（原 四部叢刊本 為掃描殘樁）
    ('qiminyishu', '齊民要術'), ('yantielun', '鹽鐵論'), ('xixiangji', '西廂記'),
    ('taohuashan', '桃花扇'), ('yueweicaotangbiji', '閱微草堂筆記'),
    ('nanqishu', '南齊書'), ('liangshu', '梁書'), ('beiqishu', '北齊書'), ('zhoushu', '周書'),
]
# 巨型正史/編年（19 本；書信集 站上無對應單書，已剔除）
_BIG = [
    ('xintangshu', '新唐書'), ('jinshu', '晉書'), ('songshi', '宋史'),
    ('zizhitongjian', '資治通鑑'), ('songshu', '宋書'), ('nanshi', '南史'),
    ('jiutangshu', '舊唐書'), ('mingshi', '明史'), ('weishu', '魏書'),
    ('beishi', '北史'), ('suishu', '隋書'), ('xuzizhitongjian', '續資治通鑑'),
    ('zhuziyulei', '朱子語類'), ('bencaogangmu', '本草綱目'),
    ('taipingguangji', '太平廣記'), ('yuefushiji', '樂府詩集'),
    ('yehuobian', '萬曆野獲編'), ('gujinxiaoshuo', '喻世明言'), ('qingshigao', '清史稿'),
    ('yuanshi', '元史'),   # 補：100 本清冊正史漏選，站上 元史/ 211 頁
]
# 小學（6 本；正字通/字彙/字彙補/改併四聲篇海/篇海類編/說文通訓定聲 站上缺完整本，已剔除）
_XIAO = [
    ('yupian', '玉篇 (四庫全書本)'), ('longkanshoujian', '龍龕手鑑 (四庫全書本)'),
    ('jiyun', '集韻 (四庫全書本)'), ('guangyun', '廣韻 (四庫全書本)'),
    ('guangya', '廣雅 (四庫全書本)'), ('fangyan', '方言'),
]


def _build(specs, cat):
    out = []
    for wid, base in specs:
        prefix = base + '/'
        out.append(dict(id=wid, prefix=prefix, pat=_pat(base), cat=cat))
    return out


WS_WORKS = (_build(_JING, 'JING') + _build(_MID, 'MID') +
            _build(_BIG, 'BIG') + _build(_XIAO, 'XIAO'))
# 小說（github.com/accelon/lit，需 zip 來源；冊中實有 id 才抓）
# ⚠️ 暫緩：用戶手邊無 haodoo 來源，本批次先不抓。清史稿屬史部已在 BIG。
NOVELS = [
    ('紅樓夢', 6), ('水滸全傳', 19), ('儒林外史', 10), ('三國演義', 12),
    ('聊齋誌異', 90), ('西遊記', 14), ('初刻拍案驚奇', 92), ('兒女英雄傳', 87),
    ('醒世恆言', 96), ('二刻拍案驚奇', 97), ('警世通言', 100), ('老殘遊記', 39),
    ('官場現形記', 91),
    ('金瓶梅', None), ('二十年目睹之怪現狀', None), ('醒世姻緣傳', None),
    ('子夜', None), ('文明小史', None),   # 100 本第 56 名小說，accelon/lit 無，需另尋來源
]

ROOT = Path(r'D:/2026/cct')
RAW = ROOT / 'raw'
API = 'https://zh.wikisource.org/w/api.php'
UA = 'cct-corpus/1.0 (Chinese Citation Texts corpus sourcing; polite; contact via Wikimedia account)'
BATCH = 40
CST = timezone(timedelta(hours=8))


# ---------- Wikisource primitives（自 fetch_wikisource.py） ----------
def curl_json(params, tries=5):
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
    if prefix and title.startswith(prefix):
        rest = title[len(prefix):]
        if '/' not in rest:
            return rest + '.wiki'
    return title.replace('/', '_') + '.wiki'


def save(d, title, content, metas, seen, prefix=''):
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
    if 'pages' in w:
        titles = list(w['pages'])
    else:
        titles = [t for t in list_pages(w['prefix']) if re.match(w['pat'], t)]
        titles.sort()
    metas, seen = [], set()
    d = RAW / wid
    d.mkdir(parents=True, exist_ok=True)
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
                        if save(d, r2['title'], r2['content'], metas, seen, w.get('prefix', '')):
                            metas[-1]['redirect_from'] = t
                            metas[-1]['revid'] = r2['revid']
                redirects_done.add(t)
                continue
            if save(d, r['title'], content, metas, seen, w.get('prefix', '')):
                metas[-1]['revid'] = r['revid']
                metas[-1]['timestamp'] = r['timestamp']
        print(f'  … {min(n0 + BATCH, len(todo))}/{len(todo)}', flush=True)
        time.sleep(random.uniform(3, 5))
    n_redir = sum(1 for m in metas if 'redirect_from' in m)
    print(f'[{wid}] 重定向解析 {n_redir} 頁', flush=True)
    mf = dict(source='zh.wikisource.org (MediaWiki API prop=revisions)',
              fetched=datetime.now(CST).isoformat(timespec='seconds'),
              license='CC BY-SA 4.0',
              work=wid, pages=len(metas),
              cat=w.get('cat', ''),
              note=w.get('note', ''),
              manifest=metas)
    (d / 'manifest.json').write_text(json.dumps(mf, ensure_ascii=False, indent=1), encoding='utf8')
    print(f'[{wid}] 完成：{len(metas)} 頁', flush=True)


# ---------- 驅動 ----------
def validate(ids=None):
    works = [w for w in WS_WORKS if ids is None or w['id'] in ids]
    print(f'驗證 {len(works)} 本 Wikisource 命名空間…', flush=True)
    bad = []
    for w in works:
        try:
            titles = list_pages(w['prefix'])
            match = [t for t in titles if re.match(w['pat'], t)]
            sample = ' / '.join(match[:3])
            if len(match) == 0:
                bad.append(w['id'])
                flag = '  <<< 0 命中，需修正 prefix/pat'
            else:
                flag = ''
            print(f'  {w["id"]:<8} prefix={w["prefix"]:<10} 總頁 {len(titles):>4} 命中 {len(match):>4}  {sample}{flag}',
                  flush=True)
        except Exception as e:                       # noqa: BLE001
            print(f'  {w["id"]:<8} ERROR {e}', flush=True)
            bad.append(w['id'])
        time.sleep(1.0)
    print(f'\n需修正：{bad if bad else "無"}', flush=True)
    return bad


def fetch(ids=None):
    works = [w for w in WS_WORKS if ids is None or w['id'] in ids]
    print(f'擷取 {len(works)} 本…', flush=True)
    for w in works:
        try:
            fetch_work(w)
        except Exception as e:                       # noqa: BLE001
            print(f'  [{w["id"]}] 失敗：{e}', flush=True)
        time.sleep(1.0)


if __name__ == '__main__':
    args = sys.argv[1:]
    if args and args[0] == '--validate':
        idss = set(args[1:]) or None
        validate(idss)
    else:
        fetch(set(args) or None)
