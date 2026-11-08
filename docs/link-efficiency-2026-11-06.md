# adb 互鏈效率驗證（2026-11-06）

> 範圍依作者指示：**只驗互鏈效率**。本輪不打包、不改 `D:\accelon3`、
> **不動 `D:\2026\adb-converter` 任何檔案**（只用 `import` 唯讀呼叫 `adbtext.ts`／
> `accelon26/adb.ts`）。UI 部分只給建議清單（§5）。

## 1. 一句話結論

**瓶頸不在解析速度，而在「原文 adb 有沒有 id 索引」與「座標約定是否一致」。**
`swjz` 已經有 `字.id` 10,706 筆的 attribute 索引，`13j` 一筆 segment id 都沒有 →
`seg:` 連結在 runtime 只能退化成全文搜尋，且會**靜默落到錯誤段落**。

## 2. 資料面：同一批 69,838 條實鏈，走兩條解析路徑

樣本＝引用端（`D:\2026\gycd\interlink\accepted.tsv`）已經判定可用的全部連結
（13j 61,562 條＋shuowen 8,276 條）。

| 路徑 | 做法 | 結果 | 耗時 | 每條 |
|---|---|---|---:|---:|
| **A 現況**（13j 無 id） | 用 `quote` 在該書漢字流搜尋 → 回推落在哪個段落 | 正確 48,763（79.2%）<br>**落錯段 1,392（2.3%）**<br>歧義 1,143（1.9%）<br>搜不到 10,264（16.7%） | 697 ms | **11.3 µs** |
| **B 有 id／manifest** | `anchorId` → 段落 → 取 `a-b` 切片反解 | 通過 49,450（**70.8%**）<br>查無 anchor 6<br>切片不符 20,382（29.2%） | 2,965 ms | 42.5 µs |

一次性索引：`anchor 表 12,711 條、建置 6.0 ms`（13j 2,005＋shuowen 10,706）。

> A 比 B「快」是因為 B 多做了切片字串比對（驗證語意），不是因為搜尋比較省。
> 兩者都是 µs 級 → **速度不是問題**；A 的代價是 1,392 條**會跳對頁但指錯段落**，
> 這種錯在使用者看起來像「連結壞了」，比 dead link 更難追。

## 3. 20,382 條「切片不符」的成因分解

用「實際位置 − 宣告 `target_a`」的偏移分佈去判（`src/diag-offset.ts`）：

| 偏移 | 條數 | 判讀 |
|---|---:|---|
| ＋1 | 4,854 | **段內找得到，起點差 1 漢字** |
| ＋2 | 1,319 | 同上，差 2 |
| 0 | 504 | 起點對、終點不對（右開／右閉混用） |
| ＋3／＋5／＋6 | 495／322／214 | 長尾 |
| 換「全書／全庫座標」才對 | 都是隨機大偏移（961164、146281…） | **不是座標系問題**，假設排除 |
| 全庫都找不到 | **12,345** | 引文不在 13j 白文裡（注疏文字、異體、版本錯配） |

分層結論：

1. **機制面可救**：`＋1／＋2／0` 這 6,677 條是**引用端座標計算的 off-by-one 與右閉誤用**，
   重算即可通過（佔 13j 比對失敗的最大單類）。
2. **內容面不可救（不換版本就無解）**：12,345 條属 `prompts/swjz.md` §5 講的同類問題
   ——白文 vs 注疏、段注本 vs 大徐本。這是**版本決策**，不是 anchor 缺陷。
3. 兩條路的「搜不到／找不到」量級一致（10,264 vs 12,345）→ 互鏈失败的主因是**文字內容**，
   不是定址方式。这点必須跟作者講清楚，否則補完 id 也會誤以為修好了。

## 4. runtime 實物探針：`accelon26.exe` 看得到的索引

`bun run src/probe-attributes.ts D:\accelon3\<adb>.adb`（唯讀）

| adb | `attributes` 鍵 | 互鏈可用性 |
|---|---|---|
| `13j` | `樹.s 樹.t 書.t`（各 1）、**`書.id` 13**、`頁元.n` 13、**`頁.n` 937** | ❌ **無 `章.id`／`節.id`／`項.id`** → `seg:` 完全無法用 id 落地；`頁.n` 是 1..N 跨 13 本重複，`13j?1` 只會命中第一本 |
| `swjz` | `檔.n`、`集.c`、`集.l`、`樹.s`、**`chaptertitle.id` 31**、**`字.id` 10,706**、`字.img` 10,706 | ✅ `char:` 有 attribute 索引，O(1) 可落地；章節也有 id 可後備 |

這解釋了 §2 的差異：**shuowen 那 8,276 條是走索引，13j 那 61,562 條現在只能走文字**。
補上 2,005 個 `章/節/項 id` 之後，13j 才會跟 swjz 同級；代價是 manifest 多 2,005 條
（本區實測 172 KB TSV、索引 12,711 條 6 ms 建好）——對 2.2 MB 的 `13j.adb` 來說是零頭。

## 5. 給 accelon26 的 UI／runtime 建議（我不改碼，逐條供採納）

1. **anchor 落地順序要寫死**：`attributeValues(<tag>.id)` → manifest → `q` 文字比對 → 才允許
   `page:` legacy fallback。現在 13j 直接掉到第 3 歩，所以會發生 §2 的「跳對頁、指錯段」。
2. **解析失敗不要猜**：多候選（歧義 1,143 條）與 `landed-elsewhere` 要顯示「定位不確定，
   提供 N 個候補」的清單，而不是取第一筆。取第一筆的錯誤在使用者端不可辨認。
3. **反解驗證要上 UI**：點擊時用 `a-b` 從原文取字串，與 `quote` 正規化後比對；
   不符就標 `stale`（灰色、可點、附「引文與原文目前差 N 字」提示）。
   本輪數據顯示 70.8% 通過，剩餘主要是 off-by-one，UI 若做寬容 ±3 漢字的容錯再報，
   可把「看似壞掉」降到內容層那 12,345 條。
4. **manifest 放 adb 的 `anchors` 容器**（或隨 adb 旁的 `.tsv`），欄位用本區已產出的：
   `anchorId, kind, parentBook, label, parent, path, line, struct|leaf, hanCount, textHash`。
   `struct`（純分類標題，0 漢字）要在 UI 裡**不可當作落點**，命中就自動升到最近有文字的
   子節點（gycd 那 75 筆 `usable=0` 全落在這類節點）。
5. **textHash 已復現成功**（作者指定以 gycd 值為準，演算法見母區 spec §4.4）：
   NFKC→首個漢字→OpenCC s2t→首個漢字→VMAP，再 `sha256[:16]`。本區把正規化凍結成
   `data/char-fold.tsv`（15,646 字、297 個會摺疊），TS 端只查表＋hash，
   **2,005 條中 1,929 條與 gycd 完全相同**；75 條差在 0 漢字節點的空字串慣例，真差異只剩 1 條。
   過程與 CRLF 坑見 [`text-hash-verification.md`](text-hash-verification.md)。
   → 給母區的契約修訂建議：`hanCount=0` 時 textHash 寫**空字串**，不要寫 `sha256("")`。
6. **反鏈 UI 維持「已開啟 N 個引用庫」措辭**，並在 13j 補 id 完成前於狀態列顯示
   「《十三經》段落到地未最佳化（依赖文字比對）」，讓作者與使用者都知道這是版本狀態，
   不是連結損壞。
7. **字頭樹要排除部首附錄**：`swjz` 的 `<樹 s="$字">` 目前含 11,246 筆，其中 540 筆
   是書末部首目錄（無 id、不可定位）→ 使用者打「一」會看到兩條、點第二條不會跳。
   若採納 §6 的標記正名，runtime 只要把樹的來源改成「有 `id` 的 `<字>`」即可，不必改正文。

## 6. 引用端（gycd）要修的兩件事

1. 重算 `target_a/target_b`：先修「起點 +1／+2」與「終點右閉」兩類（共 6,677 條）。
   判準＝切片 `anchorHan[a:b] === quote_normalized`，右開。
2. 內容層 12,345 條請留在 `unresolved`，不要因 13j 補 id 而誤升降級為 accepted。

## 7. 重跑方式

```powershell
cd D:\2026\cct
bun run src/verify-link-efficiency.ts      # A/B 兩條路徑的命中率與耗時（全 69,838 條）
bun run src/diag-offset.ts                 # 不符原因的偏移分佈
bun run src/probe-attributes.ts D:\accelon3\13j.adb    # runtime 看得到的 id 索引
bun run src/probe-attributes.ts D:\accelon3\swjz.adb
```

報告檔：`out/link-efficiency.txt`、`out/link-issues.tsv`、`out/diag-offset.json`、
`out/probe-13j.adb.txt`、`out/probe-swjz.adb.txt`。

## 8. 並行變動注意（影響下一輪）

- 今天 18:18–18:20，**另一個 agent 往本區 `works.tsv` 加了 17 個 work**（`shiji`、`hanshu`、
  `houhanshu`、`sanguozhi`、`wenxuan`、`guoyu`、`zhanguoce`、`zhuangzi`、`laozi`、`xunzi`、
  `hanfeizi`、`huainanzi`、`lvshichunqiu`、`lunheng`…），全部 `anchor=seg`、`status=raw`，
  並新增 `src/fetch-wikisource.py`。那些不是我寫的，我也沒動 `works.tsv`。
- 母區 `D:\2026\adb-converter` 目前也有**非我造成的未提交修改**
  （`AGENTS.md`、`docs/adb/adb-version-log.md`、`ts/tools/make-adb-index.ts`、`www/adb/index.html`
  ＋ 4 個 untracked）。我這輪對母區**只有 import 唯讀**，符合「不能動 adb-converter」的限制。
- 影響：本輪互鏈量測只涵蓋 13j／shuowen。新登記的 14 部史書／子書一旦進 `seg` 方案，
  「同名 leaf 需要幾層祖先」「0 漢字結構節點」兩類問題會重演，
  §5 的 UI 建議（落點順序、歧義不猜、`struct` 不可當落點）對它們同樣適用；
  `verify-link-efficiency.ts` 只要把 work 清單與 dump 換掉就能複用。
- 依母區紀律：**同一個 adb 同一時間只由一個工作區重建**。兩邊同時在動本區時，
  先協調再打包，避免互蓋。

## 9. 這輪沒做的事（避免誤會）

- 未生成／未覆蓋任何 `D:\accelon3\*.adb`；未跑 `authorAdb`。
- 未修改 `D:\2026\adb-converter`（含 `book-catalog.json`、閱讀器、tools）；只 import 唯讀。
- 未發布、未 commit。`docs/prompts/*` 與 `docs/README.md` 依然不是我寫的（mtime 17:38）。
- 上一輪提案裡等你拍板的三處衝突（括注進不進 id、`●人` 怎麼編、hash 演算法）**仍未定**；
  第 3 項在這輪有了實測後果：hash 兩端不同源 → `stale` 判斷目前形同不存在。
