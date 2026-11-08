# -*- coding: utf-8 -*�
"""
works-registry.py — cct 第二波擷取工作冊（100 本缺口中，走 Wikisource 的 69 本）

來源：zh.wikisource.org（MediaWiki API）
分類：13 經 / 古典中小型 / 巨型正史編年 / 小學
id 直接用書名（raw/<id>/ 資料夾），builder 再對照 works.tsv 的 work_id。

注意：prefix 為最佳猜測，需經 validate-works.py 確認；命中為 0 或異常者再人工修正。
"""
import re


def _pat(name):
    return r'^' + re.escape(name) + r'/.+'


# 13 經
JING = ['周易', '尚書', '詩經', '周禮', '儀禮', '禮記', '左傳', '公羊傳',
        '穀梁傳', '論語', '孝經', '爾雅', '孟子']
# 古典中小型（<50 萬字，經史子集／總集）
MID = ['楚辭', '列子', '墨子', '管子', '抱朴子', '世說新語', '水經注', '山海經',
       '顏氏家訓', '逸周書', '文心雕龍', '素問', '齊民要術', '鹽鐵論', '西廂記',
       '桃花扇', '西廂記諸宮調', '閱微草堂筆記', '福惠全書', '南齊書', '梁書',
       '北齊書', '周書']
# 巨型（>=50 萬字：正史／編年／醫農／總集／筆記）
BIG = ['新唐書', '晉書', '宋史', '資治通鑑', '宋書', '南史', '舊唐書', '明史',
       '魏書', '北史', '隋書', '續資治通鑑', '朱子語類', '本草綱目', '太平廣記',
       '樂府詩集', '書信集', '野獲編', '古今小說', '清史稿']
# 小學（字書／韻書／辭書；四庫已有，仍依用戶指示納入）
XIAO = ['玉篇', '龍龕手鑑', '正字通', '字彙補', '改併四聲篇海', '字彙',
        '篇海類編', '說文通訓定聲', '集韻', '廣韻', '廣雅', '方言']

CAT = {'JING': '經部', 'MID': '古典中小型', 'BIG': '巨型正史編年', 'XIAO': '小學'}


def _build(names, cat):
    out = []
    for n in names:
        out.append(dict(id=n, prefix=n + '/', pat=_pat(n), cat=cat))
    return out


WS_WORKS = (_build(JING, 'JING') + _build(MID, 'MID') +
            _build(BIG, 'BIG') + _build(XIAO, 'XIAO'))

# 小說 18 本（github.com/accelon/lit，需 zip 來源；冊中實有 id 才抓）
# (書名, booknames.js 的 id；None = 冊中未見，需另尋來源)
NOVELS = [
    ('紅樓夢', 6), ('水滸全傳', 19), ('儒林外史', 10), ('三國演義', 12),
    ('聊齋誌異', 90), ('西遊記', 14), ('初刻拍案驚奇', 92), ('兒女英雄傳', 87),
    ('醒世恆言', 96), ('二刻拍案驚奇', 97), ('警世通言', 100), ('老殘遊記', 39),
    ('官場現形記', 91),
    ('金瓶梅', None), ('二十年目睹之怪現狀', None), ('醒世姻緣傳', None),
    ('子夜', None), ('清史稿', None),
]

if __name__ == '__main__':
    print(f'WS_WORKS: {len(WS_WORKS)} 本')
    for c in ('JING', 'MID', 'BIG', 'XIAO'):
        print(f'  {CAT[c]}: {len([w for w in WS_WORKS if w["cat"]==c])}')
    print(f'NOVELS: {len(NOVELS)} 本（其中 id=None {len([n for n in NOVELS if n[1] is None])}）')
