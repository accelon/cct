# modern catalog 說明（含已核准的 PD 回查規則）

適用：`D:\2026\modern\manifest.tsv`（主目錄 128 列）與 `manifest-children.tsv`（子頁 113 列）。
本檔是這兩份 catalog 的**欄位定義與規則依據**；重跑任何腳本都必須遵守，改規則須先改本檔。

## 一、pd_author 欄的取得規則（用戶已核准，2026-11-07）

**核准範圍**：當作品頁本身未掛 PD 模板時，允許以「作者頁回查」作為該列 `pd_author` 依據。

**回查鏈（依序）**：
1. 作品 wikitext 內的 `[[Author:X]]`／`[[作者:X]]`／`{{Author|X}}` 連結 → 查 `Author:X`／`作者:X` 頁；
2. 頁內**無**作者連結時 → 回退用 catalog `author` 欄（來源＝xdhycd `book-stats.csv` 的「主要作者標記」）
   查 `Author:<作者名>`；
3. 作者頁取到的 `PD-*`／`PubDomain*`／`PublicDomain*`／`nowcommon` 模板 → 記入該列 `pd_author`。

**已核准的理由**：這批目標全部來自「作者卒年＋50 ≤ 今年」的甲類清單（`src/list-modern-targets.ts`），
作者頁模板是站方對作者整體作品集的公有領域標示，比單頁模板覆蓋更廣。
實測：主目錄 78 列、子頁 113/113 列經此規則取得依據（維基文庫 `Author:老舍` 等）。

**規則的已知限制（寫明，不隱瞞）**：
- 它把「引文行上的署名標記」當「著作權人」用——譯作、合集、他人執筆的序跋、
  圖版／書法照片、遺作首次發表等情形**保護期另算，此規則不涵蓋**；
- 筆名／改名者以 catalog `author` 欄為準，查無該筆名作者頁時 `pd_author` 留空並在 `errk` 註明；
- 因此 `keep=yes` 的每一列仍應可抽查：catalog 保留 `author_page` 頁名與 `url`，覆核成本是一頁一開。

## 二、兩份 catalog 的欄位

### manifest.tsv（主目錄，23 欄）
`ws_title`(維基文庫頁名)｜`book`(字典側書名)｜`author`｜`cites`(引文次數)｜`via`(exact/redirect/search-exact/cache-rebuild/notfound)｜
`similarity`｜`pageid`｜`revid@ts`(修訂版本與時間)｜`pd_basis`(作品頁模板)｜`author_page`｜`pd_author`(依§一規則取得)｜
`errk`(作者頁查無模板／站內繁簡轉換標記等)｜`wt_bytes`｜`wt_gz_bytes`｜`nowiki_chars`｜`nowiki_gz_bytes`｜
`han_density`｜`children`(索引頁子頁數)｜`keep`｜`sha256_wt16`｜`sha256_nowiki16`｜`fetch_utc`｜`url`

### manifest-children.tsv（子頁，18 欄）
`parent_book｜parent_ws｜child_ws｜revid@ts｜pd_basis｜author_page｜pd_author｜errk｜wt_bytes｜wt_gz_bytes｜
nowiki_chars｜nowiki_gz_bytes｜han_density｜keep｜sha16_wt｜sha16_txt｜fetch_utc｜url`

## 三、keep 旗標規則（「不一定要每個都用」的開關）

| 旗標 | 意義 | 動作 |
|---|---|---|
| `yes` | 漢字密度 ≥60%、字數 ≥800、非索引／消歧義、PD 依據可查 | 建議入庫候選 |
| `hold(索引頁，需展子頁)` | `{{Collection header}}` 索引頁 | 跑 `expand-modern-index.mjs` 展開 |
| `ask(PD依據未見…)` | 作品頁與作者頁都查不到 PD 標記 | 人工覆核後才可入庫 |
| `no(清洗後過短)` | 清洗後 <800 漢字或密度 <60% | 佔位頁／分卷首頁，不入庫 |
| `no(消歧義頁)`／`no(找不到)` | 同名消歧義／站上無此頁 | 不入庫 |

## 四、清洗邊界（「初步清洗」的定義，故意不做的事）

做：去 HTML 註解、`<ref>`、模板（巢狀至三層）、內外連結留顯示文字、表格骨架、殘留標籤、空白正規化。
**不做**：繁簡轉換、切章分段、發 id、標點正規化——這些屬入庫階段（編號、分段、hash）的決定。
已知殘留：巢狀模板第四層起未剝（`han_density` 欄可篩）。

## 五、法律與來源依據

- 保護期規則：《著作權法》第 23 條——自然人作品＝作者終生＋死後 50 年，截止死後第 50 年 12 月 31 日；
  法人作品＝首次發表後 50 年。甲類目標即「卒年＋50 ≤ 今年」者（`src/list-modern-targets.ts`）。
- 文字來源：zh.wikisource.org（`action=raw`）；每列記 `pageid`＋`revid@ts`＋抓取時間＋雙 sha256，可隨時復核或作廢。
- 目標清單來源：xdhycd `out/quotes/book-stats.csv`（該區 `stat-quotes.py` 產出）。

## 六、現況（2026-11-07）

```
主目錄 128 列：yes 24／hold 2（已展開）／ask 4／no 98（找不到 78＋過短 16＋消歧義 4）
子頁    113 列：yes 111／no 2
可用正文 合計 135 篇、978,298 字；對應 xdhycd 引文 3,017 次＝3.20%
磁碟     2.87 MB（上限 8 GB 硬擋，用戶給的上限 20 GB）
```
