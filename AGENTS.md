# AGENTS.md — `cct` 工作區（多個古籍引文庫）

> 本區是 **Chinese Citation Texts**：製作多個「可被引用的古籍原文 adb」，例如
> 十三經（`13j`）、說文解字注（`swjz`／`swjzz`），以及後續的老莊、史書等。
> 路徑：`D:\2026\cct`。本檔只寫這一區的差異；共用紀律在 agent-norms 與母工作區。

## 0. 先讀（紀律來源，必讀）

| 順序 | 文件 | 為什麼 |
|---|---|---|
| 0 | `D:\2026\agent-norms\README.md`、`new-workspace.md`、`new-adb-workspace.md` | 開區、建置、版本紀錄的 canonical 規範 |
| 1 | `D:\2026\agent-norms\yap-software-practice.md` | 作者預設做法；**§12 背景工作與子行程** |
| 2 | `D:\2026\adb-converter\AGENTS.md` | 母區規則：成品位置、發布權限、不要 commit 等 |
| 3 | `D:\2026\adb-converter\docs\adb\adb-knowhow.md` | 容器、VA、漢字位置、缺字、`<聯>`、建置六步 |
| 4 | `D:\2026\adb-converter\docs\adb\ancient-book-xref-spec.md` | **本區的核心契約**：work、catalog、分散式 xout、錨點 |
| 5 | `D:\2026\adb-converter\docs\adb\interlink-markup-handoff.md` | 13j／swjz 的實例與仍待推導的定址問題 |
| 6 | 母區 `docs/adb/adb-version-log.md` | 版本紀錄格式；母區是彙整版 |

## 1. 這個工作區做什麼

- 產出：**多個**古籍原文 adb，不是單一 `{{DB}}.adb`。
- 目前目標（依 `works.tsv`）：
  - `13j`：十三經；一個 adb 內含 13 個 work。
  - `swjz`／`swjzz`：說文解字注的不同 edition；同一 work `shuowen`。
  - 後續：老莊、史書等，先在本區 `works.tsv` 登記 work，再建 adb。
- 成品位置：`D:\accelon3\<adb>.adb`（不是 `out/`、不是 `dist/`）。
- 本區不建中央 xref。原文 adb 不存反鏈；引用 adb 的 `xout_<workId>` 由引用那一區負責。
- 本區可以維護「自己的」work／edition metadata，但 catalog 的正式打包由母區做。

## 2. 目錄與 registry

```text
D:\2026\cct\
  AGENTS.md
  README.md
  works.tsv          ← work / edition / adb / anchor 登記（本區 canonical）
  version-log.md     ← 每次建置一列
  raw/               ← 原始語料（唯讀；不進版控）
  off/               ← 舊的 .pgd/.pgds 中間資料（legacy，不進版控）
  src/               ← 建置腳本（每本書一支，或共用 builder）
  out/               ← 中間產物（不進版控）
  docs/              ← 本區的 steps／決策紀錄
```

- `works.tsv` 是「這區要產出哪些 work」的唯一清單；新書先加列，再寫 builder。
- 同一個 adb 可以承載多個 work（13j）；同一個 work 可以有多個 edition（swjz／swjzz）。
- `raw/`／`off/` 舊資料保留；舊 `.git` 已改名為 `.git.legacy-20261106`，不當 canonical。
- 舊 `src/legacy/split-*.js`／`gen-yijing.js` 是 legacy，不是新管線。

## 3. 建置六步

```text
① 取源（raw/ 或外部，唯讀）
② 轉文字（一行一個 adb 行；超過 4,000 字要切）
③ 補資料（缺字、術語、頁/字/segment id；外部檔，不改原始檔）
④ 連結（作者少量 <聯>；大量引用由引用庫自己的 xout，不在本區）
⑤ 打包（authorAdb → D:\accelon3\<adb>.adb）
⑥ 驗證＋version-log 一列
```

- 建置要能從零重跑；來源版本、指令、參數寫在 `README.md` 或 `docs/steps-*.md`。
- 一次只重建一個 adb；不要兩個工作區同時重建同一檔。
- 長跑要有 timeout；收工前清 bun／node／瀏覽器子行程。

## 4. 錨點規則（本區最重要）

依 `ancient-book-xref-spec.md` 與 `interlink-markup-handoff.md`：

- **13j 不用 page**。用 semantic segment：
  - `yijing?乾#a-b`
  - `shangshu?堯典#a-b`
  - `shijing?關雎#a-b`
  - 撞名的 leaf 才加最少祖先（例 `zuozhuan?隱公/經元年`）。
  - `<章>`／`<節>`／`<項>` 要加穩定 `id`；`<頁>`／`<頁元>` 不作 xref target。
- **swjz／swjzz 用 `<字 id="w…">`**：
  - `shuowen?w0010010#a-b`
  - 三個 edition 的 10,706 個字 id 必須保持一致；不可用頁或行。
- `a-b` 是漢字序（code point），相對 anchor 文字；不是 byte offset。
- 每個 target adb 建置時要能產生 anchor manifest（anchorId、kind、textHash）；prebuild
  xout 只接受 manifest 證明存在的 anchor。
- 同一個 work 的多個 edition 共用 anchor；edition 只決定目前 adb／book。
- 本區**不**寫 `xout`；若未來要為本區的書產生引用，先和母區確認 owner。

## 5. Catalog、版本與發布

- 新 work／alias／edition 先在 `works.tsv` 登記，再把 catalog 變更交給母區
  （母區 `book-catalog.json` 由 generator 產生，不由本區直接改打包檔）。
- 每次建置在 `version-log.md` 加一列：
  `日期／adb／sha 前 12／大小／buildTime UTC／說明（＋發布與否）`。
- 母區 `docs/adb/adb-version-log.md` 是彙整版；本區不改總帳。
- 發布由母區統一執行；本區只交 adb、sha256、大小、說明。
- 官網只可更新自己的說明頁與歷史；`index.html`／`manifest.json` 不動。

## 6. 不要做的事

- 不要改母區閱讀器（`ts/src/accelon26/*`）；共用 helper 的 bug 回母區修。
- 不要自寫漢字範圍、VA、頁座標、缺字公式；用母區共用程式。
- 不要把 `raw/`、`off/`、`*.adb`、`*.zip` commit 進 git；成品在 `D:\accelon3`。
- 不要建中央 `xref.adb`；不要在原文 adb 寫反鏈。
- 不要用 page 當 13j 的 anchor；不要用 line／VA 當跨庫永久地址。
- 不要掃 `D:\2026\` 或 `D:\accelon3` 找資料；先讀 `works.tsv` 和指定檔案。
- 不要未經作者指示發布官網、改 `deploy/adb-status.json` 或覆寫別人的 adb。

## 7. 交接（工作區停用前）

- [ ] `works.tsv` 的每個 work／edition 都有 builder 與來源
- [ ] 最後一次建置可從零重跑
- [ ] `version-log.md` 有最後一列
- [ ] `README.md` 寫清楚停用後維護看哪裡
- [ ] 子行程收乾淨
