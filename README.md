# cct — Chinese Citation Texts

`D:\2026\cct` 是多個**古籍原文 adb**的建置工作區，供其他詞典／注疏的引文庫連進來。
它不建中央 xref；原文只提供穩定 work／anchor，引用庫自己負責 `xout_<workId>`。

## 目前目標

| adb | 中文名 | 狀態 | anchor |
|---|---|---|---|
| `13j` | 十三經（13 works） | 重建中 | `seg:` semantic segment |
| `swjz` | 說文解字注（章節版） | 重建中 | `char:w…` |
| `swjzz` | 說文解字注（卷字版） | 重建中 | `char:w…` |
| `swjzzp` | 說文解字注（P 版） | 可選 | `char:w…` |

詳細 work／edition 見 [`works.tsv`](works.tsv)。新書先登記，再寫 builder。

## 目錄

```text
AGENTS.md          規則入口（先讀）
works.tsv          work／edition／adb 登記
version-log.md     建置紀錄
raw/               原始語料（唯讀，不進版控）
off/               舊 .pgd/.pgds（legacy，不進版控）
src/               builder 與轉檔腳本
out/               中間產物（不進版控）
docs/              steps／定址決策
```

舊 `.git` 已改名為 `.git.legacy-20261106`，不當 canonical；舊 yijing 腳本移到
`src/legacy/`，不是新管線。
新 repo 從本 README／AGENTS 開始。

## 建置原則

1. 來源與版本寫清楚；`raw/` 唯讀。
2. 一行一個 adb 行；超過 4,000 字要切。
3. 穩定 anchor：
   - 13j：semantic segment；**不用 page**。`shijing?關雎`，撞名才加祖先。
   - swjz／swjzz：`<字 id="w…">`；三版 10,706 個 id 必須一致。
4. 成品 copy 到 `D:\accelon3\<adb>.adb`，不是留在 `out/`。
5. 每次建置在 `version-log.md` 加一列；發布由母區做。

## 指令（待 builder 實作）

```powershell
cd D:\2026\cct
bun run src/build-13j.ts
bun run src/build-shuowen.ts
```

實際檔名以 `src/` 實作為準；沒有 builder 的 work 不要假裝已建置。

## 契約文件

- `D:\2026\adb-converter\docs\adb\ancient-book-xref-spec.md`
- `D:\2026\adb-converter\docs\adb\interlink-markup-handoff.md`
- 母區共用工具：`D:\2026\adb-converter\ts\src\adbauthor.ts`、`...\han.ts`、`...\page-text.ts`

## 限制

- 不改母區閱讀器程式；共用 helper 的 bug 回母區。
- 不建中央 xref；原文 adb 不存反鏈。
- 不用 page 當 13j 的 anchor；不用 line／VA 當永久地址。
- 不掃整個 `D:\2026\` 或 `D:\accelon3`；先讀 `works.tsv`。
