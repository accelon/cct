# 四庫互鏈：大架構（2026-11-06）

> 作者指示：**抓大放小，不要太糾結，數據永遠修不完，記下來慢慢弄，先做出大架構。**
> 這支文件就是那個「大架構」：已驗證跑得通的管線、地址模型、缺口清單、以及那筆「慢慢弄」的帳。

## 1. 一張圖看懂

```text
                引用端（own xout）                     原文端（不存反鏈）
        ┌───────────────────────────────┐        ┌──────────────────────────┐
        │ swjzz   說文解字注（卷字版）  │ 579 條 │ jing   十三經（2,007 段） │
        │         work = shuowen        │───────▶│  13 works: yijing…mengzi │
        │ swjz    說文解字注（章節版）  │        │  （舊 13j.adb 原樣保留） │
        │         同 work、另一 edition │        └──────────────────────────┘
        │ hydzd   漢語大字典            │──▶ shuowen（引《說文》9,562 個例區）
        └───────────────────────────────│──▶ jing（書證引十三經）
                                        └── swjz ↔ swjzz 共用同一組 10,706 個 char id
```

- **連結只存在引用端**：`xout_<workId>` 容器放進引用 adb；原文 adb 不放反鏈、不建中央 xref。
- **反鏈靠 runtime 注入**（LinkBus），只涵蓋「目前已開啟的引用庫」。

## 2. 六段管線（全部可從零重跑，我这边只讀別人的 adb）

```text
① extract   bun run src/extract-adb.ts <adb> out/<名>          # 解出標記文字＋容器量測
② manifest  bun run src/build-jing.ts                          # jing 2,007 個 anchor（id＋a-b 基底）
            bun run src/build-zone-manifest.ts swjz            # char＋例（zone）層
            bun run src/build-zone-manifest.ts swjzz
            bun run src/build-hydzd-manifest.ts                # entry＋例
③ link      bun run src/link-swjzz-to-jing.ts                  # 依 data/link-graph.tsv 的邊產 xout
④ verify    bun run src/verify-xout-jing.ts                     # 反解：anchor 存在＋a-b 切片＝quote＋hash
⑤ pack      bun run src/pack-xout.ts <src.adb> <out.adb>       # xout 容器塞進 adb ＋ 讀回驗證
⑥ ship      由母區發布（我不碰 deploy／官網）
```

**已實測打通到 ⑤**：
```text
pack-xout: 來源 D:\accelon3\swjzz.adb（dbname=swjzz dbtype=2 lines=60,754 resources=7,052）
        → out/swjzz.xout.adb  20,494,744 B  sha 368f7fed5656
        10 個 xout 容器全部讀回筆數一致（shijing 201／zuozhuan 109／liji 83／yijing 43／
        mengzi 37／shangshu 29／erya 26／lunyu 25／zhouli 24／gongyang 2 ＝ 579）
        標籤與來源無差異、來源檔未被修改 → 結論 PASS
④ 反解：579／579 通過（anchor 存在 100%、切片摺疊後＝quote 100%、targetTextHash 一致 100%）
```

## 3. 地址模型（三層，人機各取所需）

```text
機器地址（寫進 xout、穩定）    work?anchorId#a-b      a-b＝anchor 內漢字序，0 起、右開
人可核對地址（衍生、方便校對）  書名／篇名／行／字元    由 manifest 的 line、textEnd、segBodyLines 換算
內部記錄（xout 第 11 欄）       targetTextHash         spec §4.4 那套正規化（判 stale 用）
```

三條地基規則（都驗過，不是口頭約定）：
1. **anchorId 用未摺疊的原字頭**（篇名／`w…`／字頭原文）。`textHash` 的正規化鏈含 OpenCC s2t，
   hydzd 實測 **6,102 組不同字頭摺疊後會合成同一串**（阿房宫/阿房宮、锕/錒…）→ hash 只能判
   「同一 anchor 內容有沒有變」，**不能當 key、不能判兩條是不是同一字**。
2. **a-b 用原始漢字序，比對在摺疊空間做**：摺疊是逐字 **1→1**、長度不變，
   所以摺疊索引＝原始索引。日後誰把摺疊改成 1→N（展開多字），這條等價關係就斷、a-b 全偏移。
3. **補 id 不推動 VA**（每個非 skip 標籤固定 4，與屬性長度無關）——在 `jing.adb` 真檔上實證
   `vaDiff=0`；但**換標籤**會位移（swjz 實測 +260）。

## 4. 現況分數

| 件 | 狀態 |
|---|---|
| `jing.adb`（2,007 segment id、章.id 259／節.id 1448／項.id 300） | ✅ 已交付 `D:\accelon3` |
| `swjz.adb`（附錄→`<部目>`、字頭構形→`<構形>`） | ✅ 已交付（舊檔備份 `out/swjz-original.adb`） |
| `swjzz` char＋例 manifest（10,706／48,257） | ✅ |
| `hydzd` entry＋例 manifest（82,280／143,044，a-b 反解 401/401） | ✅ |
| `swjzz → jing` 連結 579 條 ＋ 反解 ＋ **塞進 adb** | ✅ 到 ⑤（輸出在 `out/`，未覆蓋 accelon3） |
| `hydzd` 補 `<詞 id>`（比照 cyd）的分配表 | ✅ 表已產（82,280 列；149 組需 a=）；**尚未套用到文字／重打包** |
| `swjz → jing`、`hydzd → shuowen`、`hydzd → jing` 三條邊 | ⏳ 只有宣告（`data/link-graph.tsv`），引擎待接 |

## 5. runtime 缺口（只能建議，我不動母區）

**今天的閱讀器只讀 `xrev`（XREV1，2026-10-31 起），還沒有讀 `xout_<workId>` 的程式。**
所以第 ⑤ 段-produced 的 adb 裡那些容器目前是「寫得進、runtime 看不见」。要落地需要母區做：

1. 讀 `xout_<work>`：header `["XOUT1",work,n,"sha256:…",edition]`，逐行 JSON；
   依 `worksOfBook(adbId)` 決定要撈哪幾桶（別一次倒全部）。
2. 落點順序寫死：`attributeValues(<tag>.id)` → manifest → `q` 文字比對 → 才 `page:` legacy。
   （`jing` 補 id 前，`seg:` 只能掉到第 3 步，實測會 **2.3% 靜默落到錯誤段落**。）
3. 反解不符要標 `stale`（可點、灰色、提示「引文與現文差 N 字」），不要跳錯頁；
   0 漢字的結構節點（`struct`）不可當落點，自動升到最近有文字的子節點。
4. UI 文案維持「反向連結（已開啟 N 個引用庫）」，不承諾全網。
5. `hydzd` 補 id 後 validTags/caches 要含 `詞`；`<詞>` 加 id 使本庫 +329,120 VA
   （名稱型 `<聯 n=>` 不受影響，但任何外部 VA 地址會位移）→ 打包前要跟該區確認。

## 6. 記下來的帳（作者：慢慢弄，不阻塞架構）

| 類別 | 數量 | 位置 | 說明 |
|---|---:|---|---|
| 說文缺陷字頭已查證可修 | 9 | `docs/shuowen-headword-defects.md` A 組 | 㱻、𠒁、仅、𠘽、𩼐、𧒒、𤰶、𥏾、㣇(U+2F896) |
| 只有形體、Unicode 沒有 | 5 | 同上 B 組 | 曲／㫃／𢀩／雲之亦古文／柙；`w4230012` 現況還是 U+FFFD（轉碼丢字） |
| 有爭議等你判 | 2 | 同上 C 組 | 杶之古文＝杻？（段注說非）；⿰金⿱丣刀＝劉／鐂／異體？ |
| 經文缺字符號 | ● 177／□ 39 | `out/13j-pages.txt` | 只回報不替換（改經文需授權） |
| 引用解析未收 | 1,051＋59＋311 | `out/link-unresolved.tsv` | 找不到引文／`禮` 歧義（不猜）／引文過短 |
| 多候選需 hint | 68 | 同上報告 | 目前一律取第一處，建議先降 confidence |
| 版本内容差 | 611 條 char（5.7%） | `out/edition-compare.txt` | 段注本 swjz↔swjzz 真文字差異，靠 targetTextHash 判 |
| hydzd 無 zone 的字頭 | 21,800 | `out/hydzd-manifest.txt` | 純參見條，anchor 仍可用（entry 級） |
| xout 超 quote 上限的區 | swjzz zone >240：700／hydzd：4,888 | manifest | 要比對片段而非整區（引用端規則） |

## 7. 我這輪碰過什麼（透明度）

- 讀取：`13j.adb`、`swjz.adb`、`swjzz.adb`、`hydzd.adb`、`D:\2026\gycd\interlink\*`（只讀）。
- 新增腳本：`link-swjzz-to-jing.ts`、`verify-xout-jing.ts`、`pack-xout.ts`、`assign-hydzd-ids.ts`、
  `build-hydzd-manifest.ts`、`sz-*.py`、`make-head-fix.py`、`verify-head-fix.py`。
- 新增資料：`data/link-graph.tsv`、`data/shuowen-head-fix.tsv`；輸出 `out/xout_*.jsonl`、
  `out/swjzz.xout.adb`、`out/hydzd-id-assign.tsv`。
- **未覆蓋** `D:\accelon3` 任何檔案（這輪的產物都在 `out/`）；母區 `adb-converter` 只有 import 唯讀。
- 過程中我自己寫錯 4 次並在文件留下記錄：正則尾部 `$`、句讀切句、雙引號嵌字串、手打罕用字码位（㱻/劉/U+2F896）。
