# 13j／swjz 定址分析與交叉驗證（2026-11-06）

> 本輪依作者定案＝**分析＋提案，不改正文、不改 adb**。
> 與既存契約 `docs/prompts/00-common.md`＋`docs/prompts/13j.md`＋`docs/prompts/swjz.md`
> 對齊；本檔的角色是**用獨立實作去驗證契約的數字，並記錄驗證過程挖出的缺陷**。
> 衝突處在 §6，需作者裁決處在 §7。

## 0. 可重跑的證據鏈

```powershell
cd D:\2026\cct
bun run src/extract-adb.ts D:\accelon3\13j.adb  out/13j     # 解出標記文字＋容器量測
bun run src/extract-adb.ts D:\accelon3\swjz.adb out/swjz
bun run src/analyze-dump.ts 13j                              # 節點樹、id、manifest
bun run src/analyze-dump.ts swjz                             # 字 id 結構、附錄、img、範圍
bun run src/page-scan.ts                                     # 頁碼分佈、缺字符號
bun run src/cross-check.ts                                   # 與 gycd/interlink/seg-manifest.csv 逐筆對照
```

產出（`out/`，不進版控）：`13j.xml`、`13j.meta.txt`、`13j-tree.tsv`、`13j-manifest.tsv`、
`13j-report.txt`、`13j-pages.txt`、`13j-crosscheck.txt`、`swjz.xml`、`swjz.meta.txt`、`swjz-report.txt`。
`swjzz`／`swjzzp` 在 `D:\2026\swjzz`，同一套腳本換路徑即可跑（跨版 id 交集檢查見 §5）。

---

## 1. 交叉驗證結果：兩套獨立實作互證

| 項目 | `docs/prompts/13j.md`（作者端） | 本區獨立推導 | 判定 |
|---|---|---|---|
| 語意節點總數 | 2,007 | 2,007 | ✅ |
| 各 work 節點數（69/64/340/375/17/50/511/254/254/20/18/21/14） | 同 | 同（章 259＋節 1,448＋項 300） | ✅ |
| bare id 數 | 1,002 | **1,002** | ✅（定案後變 1,004，見 §6.1） |
| 需一層祖先 | 1,003 | **1,003** | ✅ |
| 需人工處理 | 2 | **2**（周禮 `地官司徒` 下兩個 `●人`，line 5635／5673） | ✅ |
| work 內 id 重複 | 0 | 0（除上述 2 筆缺陷不編 id） | ✅ |
| `<頁 n>` | 937／`<頁元>` 13 | 同；**且每書 `n` 恰為 `1..N`、書內零重複**，跨書合併後 272 個不同值 | ✅（補強） |
| anchor 文字範圍 `hanCount` | — | 與 gycd `seg-manifest.csv` **2,006／2,007 相同**（見 §3） | ✅ |

**結論：契約 §3 的 canonical segment id 規則可以照著實作，不需要修改。**
下面是過程中的實質發現。

---

## 2. `interlink-markup-handoff.md` 需要更正的實測數字

| handoff 宣稱 | 實測 | 說明 |
|---|---|---|
| `13j` 950 個 `<頁>`、285 個不同 `n` | `<頁 n>` **937**、`<頁元 n>` **13**（950 是相加）；不同 `n` **272** | 計數定義要寫明，否則驗收收不住 |
| swjz 正文用 `<說文>`／`<說文異>`／`<段注>` | `swjz` 實際是 `<粗>` 24,322＋`<duan_note>` 23,990；**沒有** 那三個 tag | handoff §6.1 的 swjz 例是 `swjzz` 的體例，不能照抄 |
| `swjz` 有 10,706 個 `<字 id>` | ✅ 10,706、unique ✅；但 `<字` 開標籤共 **11,246** | 差額 540 筆見 §4 |

---

## 3. 交叉驗證挖出的三個真缺陷（都在**我的**工具裡，已修）

這才是 cross-check 的價值所在：

1. **漢字計數用字串長度 → 星體字被算 2 次**。`hanOf()` 原本是
   `match(HAN).join("").length`，`𠀉`（U+20009）這類 Ext-B 字在 UTF-16 是兩個 code unit，
   於是每段多算「段內星體字數」共 **239 筆**。母區 `adb-knowhow.md` §3 明定
   「一個 supplementary 字元＝1 個 VA」，是我違反規則。→ 改成數組長度（code point）。
2. **anchor 邊界誤用「同層或更淺」**。契約 §4 規定到「下一個**任意**語意節點」，
   我原本把父節點的子樹尾當段落尾，非 leaf 節點（虞書、國風…）因此得到 1,5714 漢字這種
   荒謬值。→ 拆成 `textEnd`（段落範圍）與 `endLine`（嵌套範圍）兩個欄位。
3. **標題行尾殘餘文字抓錯群組索引**：正則只有 4 個捕獲群組，我讀 `m[5]`，永遠拿到
   `undefined` → `<節>凌人</節>𠧤` 的 `𠧤` 被吃掉（契約 §4 點名的這一筆）。→ 改 `m[4]`。

修完後 `hanCount` 差異 239 → **1**：只剩 `mengzi` line 41268（gycd 2,395／本區 2,397）。
這條已排除星體字與殘餘兩個成因，差異在該段最後兩字，屬**待查邊界細節**，
不影响 id 方案；建議 builder 完成後用反解驗證（§8 案例 3）收斂。

**另一項不在我這邊的发现**：補上邊界後仍與 gycd 相同的筆數 0 →
「gycd 用 BMP-only 漢字類」的假設**不成立**（我先前口頭推測過，這裡正式撤回）。
雙邊都用 `\p{Script=Han}`；差距全在 §3 的三個實作 bug。

---

## 4. swjz 側的新事实（契約未記）

1. **540 個 `<字>` 沒有 id，是書末部首目錄附錄**（line 77,886 起）：
   `<section>` → `<section_num>說文解字第一</section_num>` → `<part_word><字>一</字>部一</part_word>` ×540。
   後果：`<樹 s="$字">字頭` 快取混入 540 筆**不可定位**的重複字頭（打「一」會同時命中字條與附錄）。
   → 建議附錄換專tag（`<部 id="buNNN">` 之類，名字請作者定），讓 `char:` 只留 10,706 筆，
   並讓「引用整個示部」這種需求有 `bu:` 地址。**這是改標記，屬正文變動，需作者許可**。
2. **字 id 結構已反推並全庫驗證**：`w` ＋ 部(3) ＋ 部內字序(3) ＋ 重文(1)；
   540 部、單部最大部內序 **464**（3 位容量未溢出）、部內序**零斷號**、id **零重複**、
   同部同序僅重文不同 **1,280** 筆。→ 這套 id 本身就是穩定 canonical，**絕對不要改**。
3. **`img` 全部指向 adb 外的圖**：10,706 筆都有 `img`（`NNNa-NN` 5,364／`NNNb-NN` 5,336／
   `nil` **6**），但 `resources` 容器只有 `accelon3_logo.png` → 「有圖位宣告、無圖檔」。
   6 筆 `img="nil"` 要明確化（留 nil 或整批拿掉），不要留不確定值。
4. **字條大小**：min 2／p50 65／p90 199／p99 479／max 1,188 漢字；
   **713 條超過 240**＝xout `quote` 上限 → 引用端要比對「字條內片段」，不是整條。
5. **31 個 `chaptertitle id`**：`v01–v14, v15a, v15b, v16–v30`。`v15a`／`v15b` 非純數字
   → 跨版比對不可 `parseInt` 排序；swjz 用 `chaptertitle`、swjzz 用 `<卷>`，
   兩者 id 同名（`v01`）→ 章節地址要用這套 id，不要依賴「有沒有 `<卷>`」。

---

## 5. 定址方案（定稿建議，與契約一致）

### 13j（成品 adb 名稱已定 **`jing`**，見 [`adb-rename-jing.md`](adb-rename-jing.md)）

```text
座標     workId?anchorId#a-b      a-b = anchor 內漢字序（\p{Script=Han}，code point 計），0 起右開
anchorId 原文標題：去所有空白、去括注；不用 slug、不用序號、不用頁碼
編 id     全部 2,007 節點都編（不只 leaf）
消歧     leaf 名在 work 內唯一 → bare；否則逐層加最少祖先（實作上限：1 層，無 2 層需求）
缺陷     加到根仍同名 → 不編 id、寫入 defect report、請作者修字（不得用 #N 掩蓋）
manifest work, anchorId, kind=seg, parentBook(=書 id), label(原樣), parent, path, line,
          struct|leaf, hanCount, textHash
          page／頁元／VA／行號 一律不進
```

### swjz／swjzz／swjzzp

```text
anchor   char：bare `w…`（10,706，跨三版必須一致）；章節 kind=chapter（31 筆，僅後備）
Edition  swjz = legacy、swjzz = primary（依 prompts/swjz.md 開頭）
交集檢查 三版字 id 交集必須 10,706；本區工具可直接跑 swjzz 的 dump
```

---

## 6. 三處衝突——**已全部定案（作者，2026-11-06 本輪）**

| # | 衝突 | 作者裁定 | 現況（本區實作與實測） |
|---|---|---|---|
| 1 | 括注要不要進 id | **去括注** | 已套：`shangshu?肆命`、`shangshu?徂后`（`label` 仍保留原樣含括注）。gycd 舊值帶括號——**這是重建，不必遷就舊 id／舊 hash** |
| 2 | 同父同名 `●人`×2 | **是缺字**，用前後文查 Unicode | 查得 **卝人**（U+535D，「掌金玉錫石之地」；或本作「丱」U+4E31）、**饎人**（U+994E，「掌凡祭祀共盛，共王及后之六食」）→ 兩字不同，**衝突消失** |
| 3 | `textHash` 演算法 | 以 gycd 為準（母區 spec §4.4 已補定義） | 已復現：`data/char-fold.tsv`＋TS 查表，**1,931／2,007 逐字元相同** |

### 6.1 定案後的實測（`bun run src/analyze-dump.ts 13j`）

```text
語意節點 2,007；可編 id 2,007；缺陷 0（原本 2）
  bare id（不需祖先）  1,004
  加 1 層祖先          1,003
缺字修正表 data/quezi-fix.tsv：套用 2 筆、拒絕 0 筆
```

修字是**有條件的**：行號＋原標籤＋前後文三者相符才套用（`src/analyze-dump.ts`），
不符就列入 `fixRejected` 回報，絕不猜字。

### 6.2 交叉證明：兩筆真名的 hash 與 gycd 同行記錄一致

| anchor | 行 | 本區 textHash | gycd textHash（該行原記 `●人#1/#2`） |
|---|---|---|---|
| `zhouli?卝人` | 5635 | `1531f0cdd62338d6` | `1531f0cdd62338d6` ✅ |
| `zhouli?饎人` | 5673 | `d3fe497b2d378b4f` | `d3fe497b2d378b4f` ✅ |

→ 兩端 anchor 文字取法一致，差別只在 id 用佔位符序號還是用修復後的真名。
`zhouli?堯典`… 等一般節點也同：`shangshu?堯典`＝`93dd35d6912aa360`、`shijing?關雎`＝`19b5bd8fb693fbdf` 兩邊相同。

### 6.3 還沒做的一件事（屬正文變更為，需批准）

正文裡 `●` 共 **177 次**、`□` 39 次（`○` 6,981 次是句圈標點，非缺字）。
本輪只把**標籤**用於 id 的兩個缺字查證並寫進 `data/quezi-fix.tsv`；
是否連正文的 `●人` 兩處一起改字（會動到經文文字），依契約「只回報、不自行替換」，
等你一句話才做。

---

## 7. 請作者裁決（第 1、2 項已結案，剩 3–7）

1. ~~**§6 三項衝突**怎麼定案~~ → **已定案**：去括注；`●人` 是缺字並查得真名；hash 以 gycd 為準。
   又因這輪是**重建**，舊 id／舊 textHash 不必兼容（作者指示）。
2. ~~**周禮兩個 `●人` 的正確字**~~ → **已查得**：`卝人` U+535D（或本作「丱」U+4E31）、
   `饎人` U+994E，出處與前後文條件記在 `data/quezi-fix.tsv`。
   **剩下的問題只有一個**：正文裡那 177 次 `●`、39 次 `□` 要不要一併處理
   （依契約「只回報、不自行替換」；且這 177 次多數不在標籤上、不影響 id）。
3. **書末部首附錄的 tag 名**（`<部>`／`<部首>`／其他），以及是否准許這一項正文標記變動。
4. **粒度**：契約 §3.8 已定「不發明 work-level anchor」，所以論語 20、孟子 14、禮記 50
   等篇級 leaf 就靠 `a-b` 承載章界。我量過「空行＝子章」的可行性：論語 513 塊（通說 512 章 ✅）、
   孝經 21（18 章，多 3）、孟子 305（通說 260 ❌）、禮記 1,741、儀禮 121、周易 125（無意義 ❌）
   → **只有論語（可能加孝經）站得住**；是否要為論語單開一層，請裁決。
5. **`img` 6 筆 `nil` 與「宣告圖但 resources 無圖」**：降為純文字，還是等圖檔內嵌？
6. **`13j?1` 这类舊 page 連結**留作 legacy 多久、何時完全停止解析。
7. **catalog aliases 缺項**（契約 §6.5 點名 `周官`／`公羊`／`穀梁`／`谷梁傳`）由誰補：
   本區 `works.tsv` 還是母區 generator？我这边可產建議清單。

---

## 8. 反解驗證（下一步 builder 的驗收，契約 §7 之外我加兩條）

1. `yijing?乾#0-4` → 取回 `乾元享利`（☰☰ 與 `．` 不佔漢字序；實測該段前 12 漢字＝
   `乾元享利貞初九潛龍勿用九`）。
2. `shangshu?虞書` → `hanCount=0` 的結構節點：驗證引用端**不會**把引文落到無文字節點
   （gycd 有 75 筆 `usable=0`，全是虞書／夏書／國風／周南／邶… 這類分類標題）。
   → 建議 manifest 加 `hasText` 旗標（我已輸出 `struct|leaf`），resolver 遇到 0 漢字節點要
   自動降到子節點，不要回 dead。
3. `mengzi` line 41268 這一條：用 `anchor#a-b` 反解比對 gycd `accepted.tsv` 的
   `quote_normalized`，收斂 §3 剩下的那 1 筆邊界差。
4. `shuowen?w0010010` 在三版都可定位；`shuowen?w0020010`（`𠄞`，Ext-B）漢字序＝1（代理對不Dup）。
5. 跨版字 id 交集 10,706；`bu…`（若准）與 `w…` 不互撞。

---

## 9. 交付與限制

- 本輪**未改** `D:\accelon3` 任何檔案、未打包、未發布、未 commit。
- `docs/prompts/*`（4 支）與 `docs/README.md` 的修改**不是我這輪寫的**：它的 mtime 是今天 17:38，
  落在本 session 期間、但在我動任何檔之前後都不屬於我的操作；我未覆寫它，只在 §0 之後把它當契約讀。
  **請確認是否有別的 agent／你自己在同一段时间動過這區**（母區紀律：同一個 adb 同一時間只由一個工作區重建）。
- 新增：`src/extract-adb.ts`、`src/analyze-dump.ts`、`src/page-scan.ts`、`src/cross-check.ts`、
  `src/diag-class.ts`（後兩支為對照／除錯用），以及本檔；`src/README.md` 已更新為實況。
- 依 `00-common.md` §9：**沒有宣稱反連結完成**，本輪只完成「原文端可被反連結」的事實核對與方案定稿。
