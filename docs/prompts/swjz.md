# 提示詞 — `swjz` 說文解字注（章節版）：配合反連結的標記改進

> 先讀 `docs/prompts/00-common.md`。本檔是**可直接貼給 builder agent 的指令**，用繁體中文執行與回覆。
> 你負責的是 **legacy edition**；primary edition 是 `swjzz`（見 `docs/prompts/swjzz.md`）。

你是 `D:\2026\cct` 的 `swjz` builder agent。目標：讓 `shuowen` 這個 work 在 `swjz` 版上，每一個可引用位置都能被 `shuowen?w<id>#a-b` 精確定位，並與 `swjzz`／`swjzzp` 共用同一組字 id。

## 1. 鐵律

- anchor 是 **`<字 id="w…">`**，對外寫 `shuowen?w0010010#a-b`，內部 xout 可寫 `char:w0010010`。
- **不要用頁、行、VA、章節號當跨庫永久地址**（spec §4.1；`cct/AGENTS.md` §4）。
- 三個 edition（swjz／swjzz／swjzzp）的 **10,706 個字 id 必須完全一致**；這是同一 work 多 edition 共用 anchor 的前提。
- `a-b` 是**字條內**漢字序，0 起右開；不是全 adb byte offset。
- **不改正文、不改字條內容、不改 VA**；只補 metadata、manifest、必要的標記正名。
- 本區**不寫 xout**、不寫反鏈；引用端的事由引用庫工作區負責。

## 2. 現況實測（2026-11-06，`abx export`）

| 項目 | `swjz` |
|---|---:|
| 行數 | 78,671 |
| `<字 id="w…">` | 10,706（無重複） |
| 章節標記 | 31 個 `chaptertitle id` |
| 分層 | `粗`（說文）／`duan_note`（段注）／字頭 |
| `<頁>` | 無 |
| 與 `swjzz` 字 id 交集 | 10,706（完全一致） |
| 底本 | **段注本**（「惟初大極，道立於一」） |

## 3. 必須處理的缺陷

### 3.1 catalog metadata 錯（回報母區，不自行改打包檔）

現有 `book-catalog.json` 把說文三庫標成：

- `entryTag: "詞"` → 實為 `<字 id>`，應為 **`字`**。
- `pageScheme: "entry-name"` → 實為 **`entry-id`**（以 `w…` 定址）。
- 三庫 `dbname` 都寫 `swjz.xml` → `abx export` 同時匯出會搶同一輸出檔（實測 `Access is denied`）。**每個 adb 的 `dbname` 必須唯一**；匯出時先分目錄，並把這項列為給母區的變更建議。

### 3.2 分層標記正名（可選，但要先確認不影響既有 reader）

`粗`／`duan_note` 是舊標記，`swjzz` 已用 `<說文>`／`<說文異>`／`<段注>` 三層。若要讓 resolver 的 `EXPECT_ZONE` 一致，建議補上等義標記或對照表；**不要改動字條文字本身**。

### 3.3 章節 anchor 只作低頻後備

31 個 `chaptertitle id` 可以進 manifest（`kind=chapter`），但**不能取代 `char:`**。實測引用端只有 5 筆落點不在任何字條、需要降到卷／章；不要為了這 5 筆把整套錨點改成章節。

## 4. 你要交付的東西

1. `D:\accelon3\swjz.adb`（用母區 `authorAdb`；先到 `out/` 驗證再 copy）。
2. **anchor manifest**：`workId=shuowen, anchorId=w0010010…, kind=char, parentBook=—, label=<字頭>, hanCount, textHash`。
   - `anchorId` 是 bare `w…`，不含 `char:` 前綴。
   - 10,706 筆、無重複；與 `swjzz` manifest 的 id 集合做交集檢查，必須是 10,706。
   - 章節錨點另列或另欄 `kind=chapter`，不要混進 `kind=char`。
3. `src/build-shuowen.ts`／`src/check-anchors.ts`（或等效）可從零重跑；來源與指令寫進 `docs/steps-shuowen.md`。
4. `version-log.md` 加一列（sha256 前 12／大小／buildTime UTC／說明）。
5. 給母區的 catalog 變更建議（§3.1 三項）＋ edition 定位：`swjz` = legacy、`swjzz` = primary。

## 5. 版本錯配：回報，不要自行「修正」

詞典引《說文解字》時多引**大徐本白文**「惟初**太始**，道立於一」，而 `swjz`／`swjzz` 都是**段注本**「惟初**大極**」。這是版本差異，**不是缺字、不是錯字**：

- 實測標《說文解字》的 28,887 條引文，只有 28.65% 能在段注本精確命中；已命中的 8,276 條中，3,244 條標《說文解字》卻落在 `<段注>` 層（層級不符）。
- 建議由作者裁決：把 work 拆成 `shuowen`（大徐本白文）與 `shuowenzhu`（段注本），並在 `works.tsv` 登記；**不要自己改 `works.tsv` 或把段注文字改成大徐本**。
- 大徐本可由 `swjzz` 的 16,824 個 `<說文>` 區塊衍生，但現有衍生版缺 1,112 個字頭，需補齊才能成為獨立 edition。

## 6. 驗收清單

- [ ] 10,706 個 `w…` id 無重複，且與 `swjzz`／`swjzzp` 交集為 10,706。
- [ ] `shuowen?w0010010` 在三個 edition 都能定位。
- [ ] manifest 沒有 `page:`／行號／VA；章節錨點與 `char:` 分開。
- [ ] 用 `char:w…#a-b` 從字條取回的字串等於 `quote_normalized`（反解驗證）。
- [ ] `entryTag`／`pageScheme`／`dbname` 三項已列為給母區的變更建議。
- [ ] 沒有 commit、沒有發布、子行程已清乾淨。

## 7. 回報格式

簡述：manifest 幾筆、跨版本 id 檢查結果、catalog 三項建議、分層標記是否動過、以及「段注本 vs 大徐本」的版本決策待辦。**不要宣稱反連結已完成**。
