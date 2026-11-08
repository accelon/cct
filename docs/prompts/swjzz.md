# 提示詞 — `swjzz` 說文解字注（卷字版／primary）：配合反連結的標記改進

> 先讀 `docs/prompts/00-common.md`。本檔是**可直接貼給 builder agent 的指令**，用繁體中文執行與回覆。
> 你負責的是 **primary edition**，也是三庫互連拓樸裡最容易被漏掉的一環。

你是 `D:\2026\cct` 的 `swjzz` builder agent。目標：讓 `shuowen` 在 `swjzz` 上具備最完整、可驗證的 `char:w…#a-b` 錨點，並把「`swjzz` 同時是 target 與 source」這件事的**前置條件**準備好（但不在本區寫 xout）。

## 1. 鐵律

- anchor 是 `<字 id="w…">`：`shuowen?w0010010#a-b`（內部可寫 `char:w0010010`）。
- 10,706 個 id 必須與 `swjz`／`swjzzp` **集合完全相同**；不可用頁、行、VA 當永久地址。
- `a-b` 是字條內漢字序，0 起右開。
- **不改正文、不改段注文字、不改 VA**；只補 metadata、manifest、標記對照。
- 本區**不寫 xout**、不寫反鏈、不建中央 xref。`cct/AGENTS.md` §6：若未來要為本區的書產生引用，先和母區確認 owner。

## 2. 現況實測（2026-11-06，`abx export`）

| 項目 | `swjzz` |
|---|---:|
| 行數 | 60,754 |
| `<字 id="w…">` | 10,706（無重複，與 swjz 交集 10,706） |
| `<卷 id>` | 35 |
| `<部>` | 542 |
| 分層標記 | `<說文>`（16,824 區塊）／`<說文異>`／`<段注>`／`<注>`／字頭 |
| 章節標記 | 35 `chapter:` |
| 段注中的「X曰。」 | 18,406 處（完全沒有 `《》`，也沒有引號） |
| 底本 | **段注本**（「惟初大極，道立於一」） |
| 內部 `dbname` | `swjz.xml`（與 swjz 撞名） |

**為什麼 primary 是 `swjzz` 而不是 `swjz`**：兩版正文幾近等價（兩版皆精確命中 8,227 條、swjzz 獨中 47、swjz 獨中 2），所以不看命中率，看**錨點品質**——`swjzz` 有 35 卷、542 部、`<說文>`／`<說文異>`／`<段注>` 三層可分辨標記；`swjz` 只有 31 個 `chaptertitle id` 與 `粗`／`duan_note`。

## 3. 必須處理的事

### 3.1 catalog 與 dbname（回報母區）

- `entryTag: "詞"` → 應為 `字`；`pageScheme: "entry-name"` → 應為 `entry-id`。
- **三庫 `dbname` 都寫 `swjz.xml`**：`abx export` 同時匯出兩庫時會搶同一輸出檔（實測 `Access is denied`）。`swjzz.adb` 的內部 `dbname` 必須改成唯一值（例如 `swjzz.xml`），或至少在匯出流程分目錄；把這項列為給母區的變更建議。

### 3.2 anchor manifest

`workId=shuowen, anchorId=w0010010…, kind=char, parentBook=—, label=<字頭>, hanCount, textHash`。

- 10,706 筆、無重複；與 `swjz` manifest 交集必須 10,706。
- 35 個 `<卷 id>` 另列 `kind=chapter` 作**低頻後備**：實測引用端只有 5 筆落點不在任何字條；不要為了這 5 筆把主錨點改成卷。
- 把 `<說文>`／`<說文異>`／`<段注>` 的**分層邊界**記進 manifest 或對照表：這是 resolver 判斷「層級是否相符」的依據。實測 3,244 條標《說文解字》的引文落在 `<段注>` 層，若不分層就無法降 confidence、無法回報版本錯配。

### 3.3 `swjzz` 同時是 target 與 source（最容易漏）

- **target**：詞典引《說文》→ `xout_shuowen*`，由引用庫寫，本區只提供 anchor。
- **source**：段注本身引十三經。實測 18,406 處「X曰。」中，可用書名簡稱＋左邊界乾淨地辨識出 **396 處引十三經**，其中 **174 處（43.94%）**能以 ≥6 個連續漢字對上 13j 白文。
  - 注意「漢書曰」不能誤當《尚書》：「X曰」的左邊界必須不是漢字。
  - 本區**只盤點與記錄這些位置**（例如輸出 `out/duan-xref-hints.tsv`：所在字條 id、書名簡稱、引文起訖），**不要自行產生 `xout_yijing` 等容器**；先和母區確認 owner（AGENTS §6）。
  - 這份 hints 是「讓彼此互連」的關鍵交付物，沒有它，`swjzz → 13j` 那一半拓樸永遠接不起來。

### 3.4 版本錯配：回報，不要自行改字

詞典引《說文解字》多引**大徐本白文**「惟初**太始**」，庫裡是**段注本**「惟初**大極**」。實測 28,887 條標《說文》的引文只有 28.65% 精確命中。建議由作者裁決：

- `works.tsv` 拆成兩個 work：`shuowen`（大徐本白文）／`shuowenzhu`（段注本），`swjzz` 登錄為 `shuowenzhu` 的 edition。
- 大徐本可由 16,824 個 `<說文>` 區塊衍生，但**現有衍生版缺 1,112 個字頭**，補齊後才能成為獨立 edition。
- **不要自己改 `works.tsv`、不要把段注文字改成大徐本、不要在一個 work 裡混兩種引用身份。**

## 4. 你要交付的東西

1. `D:\accelon3\swjzz.adb`（用母區 `authorAdb`；先到 `out/` 驗證再 copy）。
2. `out/swjzz-anchor-manifest.tsv`：10,706 筆 `char:` ＋ 35 筆 `chapter:`，含 `textHash`；分層邊界對照。
3. `out/duan-xref-hints.tsv`：段注引十三經的位置盤點（§3.3），**只是 hints，不是 xout**。
4. `src/build-shuowen.ts`／`src/check-anchors.ts`（或等效）可從零重跑；來源與指令寫進 `docs/steps-shuowen.md`。
5. `version-log.md` 加一列（sha256 前 12／大小／buildTime UTC／說明）。
6. 給母區的 catalog 變更建議：`entryTag`／`pageScheme`／`dbname`／primary edition／兩個 work 的拆分提案。

## 5. 驗收清單

- [ ] 10,706 個 `w…` 無重複，與 `swjz`／`swjzzp` 交集 10,706。
- [ ] `shuowen?w0010010#a-b` 反解驗證通過（取回字串 = `quote_normalized`）。
- [ ] manifest 沒有 `page:`／行號／VA；`char:` 與 `chapter:` 分開。
- [ ] `<說文>`／`<說文異>`／`<段注>` 三層邊界可查。
- [ ] 段注引書 hints 已盤點，且**沒有產生任何 xout 容器**。
- [ ] `dbname` 衝突已列為待辦；`13j-rev3.adb` 未被引用為來源。
- [ ] 沒有 commit、沒有發布、子行程已清乾淨。

## 6. 回報格式

簡述：manifest 筆數、跨版本 id 檢查、分層對照、段注 hints 盤點結果、catalog 四項建議、兩個 work 拆分的待裁決事項、以及還缺什麼才能讓引用端 prebuild `xout_shuowen*` 與 `xout_<十三經work>`。**不要宣稱互連已完成**——你只完成原文端條件與 source hints。
