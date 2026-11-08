# openlit 重建：現況、大架構與決策點（2026-11-06）

> 你：「openlit.adb 有很多小說，你可以重建 open https://open-lit.com/ 到 d:\2026\openlit」
> 本區已有 2005 年的舊轉換器（`gen.js`／`booknames.js`／`eudc.js`／`errata.js`），
> 我沿用它的書目資產，但**擲回它的實作假設**（下面 §2 那三條已失效）。

## 1. 現況盤點（都是實測）

| 項目 | 值 |
|---|---|
| 舊成品 | `D:\accelon3\openlit.adb` **184,125,681 B**，mtime **2005-07-27** |
| adb header | `dbname=openlit`、`dbtype=0`、containers：source/tokens/tags/tables/attributes/caches（**無 resources**） |
| 樹宣告 | `樹.s`＝`*書｜*｜$頁`、`書.t`＝`章,節,項.` |
| 實際收錄 | **`書.id` 279 筆**，值是補零三位數（`243`、`080`、`059`…），279/279 純數字 |
| 舊書目資產 | `booknames.js` **657 條**（id→書名）；`eudc.js`（BMP 缺字對照）、`errata.js`、`pitaka.json`、`bmp/` |
| 舊管線 | `gen.js`：`zip/lit_<id>.zip` → `off/<id>.off`（**accelon offtext 格式**，非 adb），依賴 `pitaka/cli` |

## 2. 站點事實（2026-11-06 實測，推翻舊假設）

| 舊 `gen.js` 假設 | 現在實際 |
|---|---|
| Big5／EUC 內碼 | **UTF-8 HTML5**（`<meta charset="utf-8">`） |
| 每頁砍前 23 行、後 29 行去樣板 | 樣板是 `<head>`＋尾端 StatCounter；**頁尾還有第二個 `<h4>`**，用 `lastIndexOf("</h4>")` 會把整段內文切光（我踩過） |
| 缺字是 `<img src=…BMP>`＋EUDC 表 | **缺字機制還在**（我一度說「新站沒缺字圖」是錯的，只看了 1 本就下結論）。實測 6 本：`bk112` 62 處、`bk117` 48 處、`bk096` 9 處、`bk011`/`bk279` 各 1 處、`bk296` 0 處 |
| 站點可用 | **只有 http 通**；`https://` 全部逾時（我第一次抓取就是栽在這裡） |


線上的存活度與規模（抽測）：從 657 條隨機 20 本，**20/20 HTTP 200**，
單本 zip **78,523～1,079,251 B（均值 ~489 KB）** → 657 本約 **320 MB** 下載量。
Wayback 有 `20260521162211` 快照可當後備來源。

## 3. 大架構（三段，已全部跑通一本書）

```text
① 取源   node src/fetch-convert.mjs --ids=data/books.txt
           GET http://www.open-lit.com/html/GetFile.php?getType=lit&getId=<bkId> → raw/<id>.zip
② 解壓   PowerShell Expand-Archive raw/<id>.zip raw/<id>      （不新增 jszip 依賴，不動你的 package.json）
③ 轉換   同腳本：index.html → 書名＋章清單；各章頁 → <書>/<章> ＋段落行 → out/<id>.txt
④ 打包   bun run src/pack-openlit.ts   → out/openlit.adb ＋ 讀回驗證（out/pack-report.txt）
```

標記層（與 cct 四庫同一套 segment 思路，不用頁碼）：

```xml
<集>開文庫小說</集>
<隱><樹 s="*" t="書">目錄</樹></隱>
<書 id="bk243" t="章.">九雲記</書>
<章 id="第十四回日本國潛師犯青州楊元帥練兵出濟南">第十四回　日本國潛師犯青州　楊元帥練兵出濟南</章>
　　且說七月七日太后娘娘千秋節……
```

- `書.id` ＝ `bk`＋補零三位（不拿純數字開頭，符合你的命名偏好，也便於日後拆庫改名）
- `章.id` ＝ 回目原文去空白（視同詞條，比照 `jing` 的規則）；**撞名才加 `#N`**
- 沒有 `<頁>`：網頁分頁不是引用單位
- 行長 ≤4,000（打包器會硬擋，不靜默錯位）

### 已驗證的單本結果（bk243《九雲記》）

```text
轉換：36 章、1,701 行、最長行 2,977（<4000 ✓）、撞名章 0、殘留標籤 0、639,631 B
打包：out/openlit.adb 671,327 B  sha256 2cd215de64bd…
      行 1,710、tags 集/隱/樹/書/章＋閉、caches 書 章 集、tokens 4,035／hits 211,669
讀回：書.id 1（bk243）、章.id 36（36/36 唯一）→ PASS
```

## 4. 等你決的三件事（跑全量前要定）

1. **範圍**：(a) 舊 adb 的 279 本（可比對、驗證最穩）；(b) `booknames.js` 全 657 本；
   (c) 先 60 本試跑看品質再決定。下載量 279 本≈136 MB／657 本≈320 MB，且**這是長程批次，
   我會分段跑、不留孤兒程序**。
2. **成品名字與位置**：現行 `openlit.adb` 是 2005 年的庫。要
   (a) 覆蓋 `D:\accelon3\openlit.adb`（我會先把舊檔備份進 `data/`，不刪除）、
   (b) 另名交付（例如 `openlit2.adb`，舊檔原樣保留——符合你一貫的做法）、
   (c) 依書拆成多庫（武俠／言情／歷史…）。
3. **舊資產要不要沿用**：`errata.js`（勘誤表）與 `eudc.js`（缺字表）在新站上大概率多餘，
   但可能有個別章頁仍殘留 BMP 圖；我的做法是**先跑偵測**（統計各 zip 的 `<img>`/bmp 出現數），
   有再啟用，沒有就不載入。

## 5. 記下來的帳（慢慢弄，不阻塞）

| 項 | 說明 |
|---|---|
| 章名跨書重名 | 「第一回」這類必定大量重複；`章.id` 唯一性要按**書內**判（我目前輸出的是全庫口徑，已在報註明） |
| 回目解析 | 舊碼用 `extractChineseNumber` 找「第X回/章」並序號校正；新版我暫用標題原文去空白，之後可加回序號校驗 |
| `</br>` 壞標籤 | 站內 `<font>第十四回</br>　　…` 是錯誤標籤；目前被一般性去標籤吸收，但要確保不把回次切錯 |
| 繁簡混雜 | 站內有簡也有繁（例：「訪問統計」）；若要 textHash 規則與 cct 一致，需先定摺疊方向 |
| readme.html | 目前當成「本書說明」一章收進來，可能要標成非引用區塊 |
| 樣板殘留 | StatCounter／百度統計 script 已切除；`text-center text-primary` 那個 div 的內容（含「訪問統計」）目前會被當內文——要加一條尾端攔截 |
| bmp/ 目錄 | 舊區有 `bmp/`（EUDC 圖）；新站若完全無缺字圖就不帶進 adb（body 已驗證 0 張） |
| 與四庫的接點 | openlit 完成後，小說引經史的部分可走同一條 `xout_<work>` 管線（`data/link-graph.tsv` 加邊即可）；runtime 仍待母區讀 `xout` |

## 6. 缺字系統（你補的這條是關鍵）

`bmp/` ＝ **缺字点阵图，檔名是倉頡碼**（794 個，共 0.11 MB；碼長 3–5 佔絕大多數：`ADW`、`ANGBT`、`AISE1`）。
`eudc.js`（807 條）是前人拿倉頡碼去认字的成果，但實測分類後：

| eudc 值的形態 | 條數 | 含意 |
|---|---:|---|
| `9`（佔位符） | **757** | **等於沒識別**——這就是「缺字修不完」的實態 |
| 真字（Ext-B 以上） | 34 | 已識別，例 `KHWR→𤞑`、`BTOR→𦞂` |
| 真字（CJK 基本） | 6 | 例 `VMD→牀`、`QTKR→掿` |
| `^d[字]`（異體＝既有字） | 6 | 例 `WBBT→^d[體]` |
| `^mc[部件…]` | 3 | 例 `LIO→^mc[虫人]`、`CYBU1→^mc[釒睿]` |
| `!!` | 1 | 未定 |
| 有圖但 eudc 查無此碼 | 2 | `HUVII`、`LTIT` |

重建器的落地規則（已實作在 `src/fetch-convert.mjs` 的 `resolveMissing()`，處理在去標籤**之前**）：

```text
真字          → 直接替換成該 Unicode 字（可搜尋）
^d[X]         → 替換成 X
^mc[部件…]    → 〔部件:虫人〕        （日后若能定码位再換字）
9 / !! / 查無 → 〔缺字:ANGBT〕       （保留倉頡碼＝保留认字線索；必要時可內嵌點陣圖當最後手段）
```

6 本試跑的實際落地（共 121 處缺字）：

```text
真字 76（63%）｜部件 2｜未決 43（35%）
```

→ 也就是说**現有 eudc 表只能修掉六成**，剩 43 處要嘛继续认字、要嘛嵌圖。
建議的後續（帳裡）：① 用倉頡碼對照《萬國楷體》/中日韓大字符集批量认字；
② 认不出的走 `<圖 n="eudc/ANGBT.bmp">` 內嵌（794 張才 0.11 MB，成本幾乎为零，
   做法與 swjzz 內嵌 7,052 個 seal SVG 同一套）；③ `9` 那 757 條要逐條清，屬於「慢慢弄」。

## 7. 試跑成品（7 本，已被 §8 的 277 本全量取代）

```text
bk011 飛龍全傳 61 章｜bk096 醒世恆言 41｜bk112 歷史通俗演義 101｜bk117 歷史通俗演義 102
bk243 九雲記 36｜bk279 海上塵天影 61｜bk296 宣室志 12
行 14,227、textBytes 5,773,874、tokens 6,700／hits 2,870,765
out/openlit.adb 8,642,652 B  sha256 7be7a4de84c2…
讀回：書.id 7（7/7 唯一）、章.id 414（全庫 410/414 唯一——跨書同回目屬正常，唯一性按書內判）
注意：112 與 117 是**同名書《歷史通俗演義》的兩個 bkId**，目錄層要能並存（靠 bk id 区分，別用書名）
```

## 8. 交付紀錄（2026-11-06 23:08，277 本版，已被 §11 的 657 本版取代）

依你指示「覆蓋 openlit.adb，請先備份舊檔」：

```text
備份   bak/openlit-2005.adb   184,125,681 B   sha 63F0AC56073B…（與覆蓋前現行檔逐字元一致）
交付   D:\accelon3\openlit.adb  182,259,166 B  sha 821D4913DF64…
       mtime 2026-11-06 23:08；Copy-Item 無鎖檔錯誤（Accelon 當時沒占用）
讀回   dbname=openlit、dbtype=0、hasFullTextIndex=true、containers 含 attributes.sorted
       書.id 277（bk001…）、章.id 13,023、tags 集 隱 樹 書 章、書.t=章.
範圍   舊庫 279 筆 書.id 去重後 277 本（舊檔有 2 筆重複 id）→ 本次忠實重建 277 本
       另有 2 本試跑件（279、296）刻意排除，文字留在 out/extra-279.txt、extra-296.txt 供日後加入
規模   413,069 行正文、13,378 個 HTML、下載 107.3 MB、textBytes 124,380,058、tokens 1,145,000
缺字   〔缺字:倉頡碼〕 789 處、〔部件:…〕 142 處（eudc.js 只識得約六成，其餘留碼不猜字）
```

兩個踩過的坑（寫下來免得下次再踩）：
1. **端點只認不補零的 id**：`getId=001` 回 HTTP 200 但 **body 0 bytes**，`getId=1` 才是 6.2 MB。
   我第一次跑就产出 96 個 0 bytes zip，而且 Expand-Archive 的錯誤訊息是「archive is corrupted」，
   容易誤判成站點問題。規則：**檔名用補零三位（跟舊庫 `書.id` 一致），URL 用不補零**。
2. **「樣板字 25 筆」是我自己誤報**：那 25 行是小說正文裡的「百分之」「百度」等詞，
   不是 StatCounter 殘留。教訓：關鍵字式汙染偵測會被正常內文打紅，要用結構邊界（切除註解起點）而不是詞。

## 9. 交付後的驗證（2026-11-06 23:2x）

`bun run src/verify-shipped.ts D:\accelon3\openlit.adb --books=8`，12 秒跑完，兩條獨立證據：

```text
② 逐字相符：隨機抽 8 本共 14 段正文（每段 25–45 個汉字），到 adb 源塊裡搜
   → 恰好命中 1 次 14／14，搜不到 0，多命中 0     ✅ 正文真的可引用
① 完整性：adb 解出 52,106,072 个汉字，out/277 本 52,106,058 个 → adb 多 14 个
   （277 本版與 657 本版的差值都是 14 → 常數，代表來自打包頭而非內容）
   已算實（`node src/header-han.mjs`）：`<集>開文庫小說</集>`＝7（集×2＋5）、
   `<隱><樹 t="書">目錄</樹></隱>`＝7（隱×2＋樹×2＋書＋目錄）→ 合計 14 ✅
   結論：**零內容遺失**，那 14 個字只存在於 adb（頭兩行是 packer 寫的，不在 out/<id>.txt 裡）
counters(): srcBlocks 7592、lines 413,349、totalTagHits 26,606、virtualLength 61,892,436、
            distinctTokens 11,426、compression 1、srcBlockSize 16384、resources 0
```

踩到的坑（寫下來）：`AdbReader.documents()` 對 **dbtype=0 回空陣列**（`counters().documents` 卻報 1），
所以逐字驗證只能走 `sourceText(塊號)`；`physicalText`／`docText` 這條在舊型庫上不可用。

另外修了一个可重現性缺陷：`.gitignore` 的 `*.txt` 會連**重建輸入清單**
`data/books.txt`（657 id）、`data/books-legacy.txt`（277 id）一起忽略掉，
等於重建能力不在版控裡。已加反向放行 `!data/*.txt`，`git check-ignore` 現在指到該放行規則，
`git status` 也看得到 `data/`（尚未 commit，等你要的時候再 commit）。

## 10. 本輪新增/改動（透明度）

- 新增：`src/fetch-convert.mjs`（下載＋解壓偵測＋缺字解析）、`src/pack-openlit.ts`、`src/verify-shipped.ts`、
  `src/header-han.mjs`（算打包頭汉字數）、`src/eudc-audit.mjs`、`src/eudc-classes.mjs`、
  `data/books.txt`（657）、`data/books-legacy.txt`（277）、`docs/rebuild-plan.md`（本檔）、
  `bak/openlit-2005.adb`（舊檔備份，已驗 sha）。
- 產物：`raw/*`（107.3 MB zip＋解壓目錄）、`out/<id>.txt`（277 本）、`out/openlit.adb`、
  `out/convert-report.txt`、`out/pack-report.txt`、`out/eudc-*.txt|tsv`。
- 改動：`.gitignore` 我先前用 `Add-Content` 追加，因原檔無行尾換行而把 `*.txt` 黏成 `*.txtbak/`，
  已整檔修正為明列 `bak/ raw/ out/ *.adb`（這是本輪唯一改到你原有檔案的地方）。
- **未改**：`gen.js`、`package.json`、`booknames.js`、`eudc.js`、`errata.js`；未 commit；
  母區 `adb-converter` 只 import 唯讀。
- **已覆蓋**：`D:\accelon3\openlit.adb`（依你指示；舊 2005 版在 `bak/openlit-2005.adb`，可原樣還原）。

## 11. 第二版：收站點全部 657 本（2026-11-06 23:32）

你說「不必完全忠於原 adb，有新書你順便下」→ 範圍從舊庫 277 本改成站點全集 657 本。

```text
下載   raw/*.zip 657 個、220 MB、0 個空檔、0 筆下載失敗（端點一律用不補零 id）
解壓   657 個目錄都有 index.html，24,122 個 HTML，Expand-Archive 失敗 0
轉換   out/<id>.txt 657 本，convert-report 658 列、0 異常（無「尚未解壓／沒有 index」）
打包   out/openlit.adb 390,846,721 B  sha 4ef138ab5b4c
交付   D:\accelon3\openlit.adb 同上 sha、mtime 23:31:57（Copy-Item 無鎖檔錯誤）
驗回   counters: lines 1,139,843、srcBlocks 16,307、totalTagHits 48,240、textBytes 267,159,036、
       distinctTokens 33,244、virtualLength 132,805,071、resources 0、hasFullTextIndex true
       書.id 657（全唯一）、書.t 全为 `章.`、章.id 23,460（跨書重名 1,875 筆，屬常態）
逐字   ② 抽 10 本 11 段 → 恰好命中 1 次 11／11，搜不到 0，多命中 0
       ① adb 110,862,527 vs out/657 本 110,862,513 → 差 14，與 277 本版同一常數（§9 已證＝打包頭）
規模   舊庫 277 本 → 657 本；檔案 184,125,681 B（2005）→ 390,846,721 B；汉字 110.9 M
```

只有 2 章的那批（bk029 人虎傳、bk031 龍城錄、bk079 負情儂傳、bk161 達摩出身傳燈傳、
bk164 李娃傳、bk167 中山狼傳…）我查過：**是唐傳奇／單篇短制，本來就 1–2 頁**，正文行 15–529，
不是解析走樣（抽 `out/164.txt` 逐行看過，標記與正文分離正常）。

沒做的一件事：**277 本版沒有留快照**（直接被 657 本版蓋掉 `out/openlit.adb`）。
可還原，因為 `data/books-legacy.txt` 仍在版控範圍內，重跑 `--ids=data/books-legacy.txt` 就還原得回來。
