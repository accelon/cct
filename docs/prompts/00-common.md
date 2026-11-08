# 提示詞 00 — 三庫共用契約（13j／swjz／swjzz 必讀）

> 這份是**可直接貼給 builder agent 的指令**。三份分庫提示詞都要求先讀完本檔。
> 用繁體中文回覆；不要改寫本檔的規則，規則源頭在母區。

你是 `D:\2026\cct`（Chinese Citation Texts）工作區的建置 agent。這個工作區產出**古籍原文 adb**，讓別的詞典／注疏工作區的 `xout_<workId>` 可以連進來。

## 1. 你的任務邊界（最重要）

**你要做的不是「加反連結」，而是讓原文庫具備「可被反連結」的條件。**

- 原文 adb **不存任何反向資料**：不寫 `xout`、不寫 `xin`、不寫 `<聯>` 大量連結、不建中央 `xref.adb`。
- 反鏈只在 runtime 由「目前已開啟的引用庫」注入（canonical spec §0、§8）。
- 引用庫用 `xout_<workId>` 容器；**引用目標是 work，不是 adb 名稱**：`yijing`，不是 `13j`。
- 你交付的是：穩定 work 身份、穩定 anchor、anchor manifest、catalog 所需 metadata、adb 成品。

## 2. 開工前必讀（依序）

| 順序 | 檔案 |
|---|---|
| 0 | `D:\2026\cct\AGENTS.md`、`D:\2026\cct\README.md`、`D:\2026\cct\works.tsv` |
| 1 | `D:\2026\agent-norms\README.md`、`new-workspace.md`、`new-adb-workspace.md` |
| 2 | `D:\2026\agent-norms\yap-software-practice.md`（特別是 §12 背景工作與子行程） |
| 3 | `D:\2026\adb-converter\AGENTS.md` |
| 4 | `D:\2026\adb-converter\docs\adb\adb-knowhow.md` |
| 5 | `D:\2026\adb-converter\docs\adb\ancient-book-xref-spec.md` ← **canonical，衝突時以此為準** |
| 6 | `D:\2026\adb-converter\docs\adb\interlink-markup-handoff.md` |
| 7 | `D:\2026\adb-converter\docs\adb\han-position.md` |
| 8 | `D:\2026\cct\docs\steps-13j.md` 或 `docs\steps-shuowen.md`（看你負責哪一庫） |

## 3. 座標與錨點契約

- 連結格式：`workId?anchor#a-b`。
- `a-b` 是 **anchor 內的漢字序**（逐 code point，`\p{Script=Han}`），0 起、**右開**；不是 byte offset、不是 VA、不是全 adb 全域序。
- anchor 在**該 work 內唯一**；`<頁>`／`<頁元>` 對 13j 只作閱讀顯示，不得進 manifest。
- `a-b` 相對 anchor 文字，不是 adb 全頁 offset（spec §4.4）。
- 對外 URL 可用 bare anchor；`seg:`／`char:`／`entry:` 只是 disambiguation prefix，不是必要裝飾。
- leaf id 唯一時直接用 leaf；撞名才加**最少一層祖先**，用 `/` 分隔；不要全部強制 full path。

## 4. Anchor manifest（prebuild gate，spec §4.4）

每次打包前產生一份 manifest，至少含：

```text
anchorId, kind, parentBook, label, parent, hanCount, textHash
```

- `anchorId` 是 bare canonical id，**不要把 `seg:`／`char:` 寫進 id**；`kind` 另存。
- `kind`：`seg`（13j）／`char`（說文）。
- `textHash`：該 anchor 漢字序列的 hash；原文改版只更新 hash，**不改 anchorId**。
- manifest 有重複 `anchorId` 直接 fail，不要自動加後綴掩蓋。
- 沒有 manifest、版本不符、hash 不符 → 引用端不得寫正式 xout，應進 `unresolved`／`stale`。
- xout record 要帶 `targetTextHash`；header 帶 `targetEdition`／`manifestHash`。

## 5. 建置六步（cct AGENTS §3）

```text
① 取源（raw/ 或外部，唯讀）
② 轉文字（一行一個 adb 行；超過 4,000 字要切）
③ 補資料（缺字、id、segment；外部檔，不改原始檔）
④ 連結（本區不做大量連結）
⑤ 打包（用母區 authorAdb → D:\accelon3\<adb>.adb）
⑥ 驗證＋version-log 一列
```

- 成品在 `D:\accelon3\<adb>.adb`，**不是** `out/` 或 `dist/`。
- 建置要能從零重跑；來源版本、指令、參數寫進 `docs/steps-*.md`。
- 一次只重建一個 adb；長跑要有 timeout；收工前清乾淨 bun／node／瀏覽器子行程。
- 每次建置在 `D:\2026\cct\version-log.md` 加一列：
  `日期／adb／sha256 前 12／大小／buildTime UTC／說明（＋發布與否）`。
- 新 work／alias／edition 先登記 `works.tsv`，再把 catalog 變更交給母區；**不要直接改母區打包檔**。

## 6. 絕對禁止

- **不要用 page 當 13j 的 anchor**；不要用 line／VA 當跨庫永久地址。
- 不要改母區閱讀器 `ts/src/accelon26/*`；共用 helper 的 bug 回報母區。
- 不要自寫漢字範圍、VA、頁座標、缺字公式；用母區共用程式（`adbauthor.ts`、`han.ts`、`page-text.ts`）。
- 不要改 `raw/` 原始語料；不要把 `raw/`／`off/`／`*.adb`／`*.zip` commit 進 git。
- 不要未經作者指示發布官網、改 `deploy/adb-status.json`、覆寫別人的 adb。
- 不要掃整個 `D:\2026\` 或 `D:\accelon3` 找資料；先讀 `works.tsv` 和指定檔案。
- 不要自行 `git commit`、不要推分支、不要發布。
- 不要為了讓數字好看而改正文用字；發現缺字／誤字只**回報**，不自行替換。

## 7. 已知的資料缺陷（不要踩）

- `D:\2026\adb-converter\13j-rev3.adb` 有 **12 處字元被替換成「甲」**（「利見大人」→「利甲大人」、「乾道變化」→「乾道變甲」），**不可作為來源或 edition 候選**。
- 現有 `13j` 的 `<章>`／`<節>`／`<項>` 全部只有顯示文字、**沒有 `id`**；這是本次要補的主要缺口。
- 說文三庫的 catalog `dbname` 都寫 `swjz.xml`，`abx export` 同時匯出會搶同一輸出檔（實測 `Access is denied`）；匯出時分目錄，並回報母區修 catalog。
- 現有說文兩版都是**段注本**（「惟初大極」）；詞典常引**大徐本白文**（「惟初太始」），這是版本錯配，不是 anchor 問題。

## 8. 可用的驗證資料（只讀，不要改）

`D:\2026\gycd\interlink\` 是引文分析端（gycd 工作區）的實測產出，可用來核對你的 anchor 是否真的能被引用端解析：

- `COVERAGE.md`、`INTERLINK-PLAN.md`：字元級覆蓋率量測與互連方案。
- `accepted.tsv`：可寫入 xout 的候選連結，含 `target_anchor`／`target_a`／`target_b`。
- `seg-manifest.csv`：依現有 XML 推導的 13j semantic segment 建議 id（**僅供對照，正式 manifest 由你產出**）。
- `verify-anchors.py`：anchor 唯一性與座標反解驗收範例。

## 9. 交付前自我檢查

- [ ] 每個 work 的 anchor 在 work 內唯一，manifest 無重複。
- [ ] `a-b` 用 anchor 內漢字序，且能用 `anchor#a-b` 從原文取回引文（反解驗證）。
- [ ] `<頁>`／`<頁元>`／VA／行號沒有出現在 manifest。
- [ ] `works.tsv` 與實際 adb／book／edition 一致。
- [ ] `version-log.md` 有新一列；sha256、大小、buildTime 填齊。
- [ ] `out/` 中間產物與子行程已清理；沒有 commit、沒有發布。
- [ ] 回報：改了哪些標記、有哪些資料缺陷待作者裁決、還缺什麼才能讓引用端 prebuild xout。
