# swjz／swjzz 重建範圍（2026-11-06）

> 你說「swjzz swjz 還是舊的」。我把兩庫都解開、建了 char／例（zone）manifest 並做跨版對照，
> 結論是：**swjzz 不用重建**（char anchor 本來就乾淨），**swjz 有兩處標記缺陷要修**，
> 而且 swjzz 已經給了現成的正確寫法可以照抄——不是發明的新格式。

可重跑：

```powershell
bun run src/extract-adb.ts D:\accelon3\swjz.adb  out/swjz
bun run src/extract-adb.ts D:\accelon3\swjzz.adb out/swjzz
python src/make-fold-table.py out/13j.xml out/swjz.xml out/swjzz.xml   # 表要含兩庫的字
bun run src/build-zone-manifest.ts swjz
bun run src/build-zone-manifest.ts swjzz
bun run src/cross-edition.ts swjz swjzz
```
產出：`out/swjz-char.tsv`、`out/swjz-zone.tsv`、`out/swjzz-char.tsv`、`out/swjzz-zone.tsv`、
`out/edition-compare.txt`、`out/edition-char-diff.tsv`、`out/*-zones-report.txt`。

## 1. 兩庫的實際狀態

| | swjz（章節版） | swjzz（卷字版） |
|---|---|---|
| 行數／字數 | 78,671／2,708,194 | 60,754／2,289,901 |
| `<字 id>` | **10,706**（unique） | **10,706**（unique） |
| 無 id 的 `<字>` | **540**（書末部首附錄 `<part_word><字>一</字>部一</part_word>`） | **0** |
| 部首附錄怎麼標 | 借用 `<字>` ❌ | 獨立 `<部目>` 540 筆 ✅ |
| 例（zone）區塊 | 47,635（`<粗>` 說文文、`<duan_note>` 段注、`<seal_script>`、`<note>`） | 48,257（`<說文>` 16,824、`<說文異>` 7,499、`<段注>` 23,934、`<構形>` 863、`<篆>` 185、`<注>` 130） |
| 篆圖 | `img` 10,706 個圖號，**resources 只有 logo → 圖不在檔內**；`img="nil"` 6 筆 | `<圖 n="seal/U4E00.svg"/>` 7,073 個，**resources 7,052 鍵 → 圖已內嵌** |
| 高階 id | `chaptertitle id` 31（v01…v15a,v15b…v30） | `卷 id` 35（同 v01… 形式，另有 p01 序） |
| 體例宣告 | `<集 l="chaptertitle,note,part_wordnum,…,duan_note,explanation">` | `<集 l="說文,段注,篆,注,構形,部數,卷數,篇末,補遺,作者,出版">` |

## 2. 跨版可共用 anchor——實證

```text
字 id 交集 10,706／兩邊各自 10,706 → 完全一致（char anchor 可跨 edition 共用）✅
textHash 相同 10,095（94.3%）
textHash 不同    611（ 5.7%）→ 真文字差異，引用端要靠 targetTextHash 判 stale
字頭本體不同      44
同 id 但例區塊數不同 101 條
```

`v01…` 這套高階 id 兩版同名 → 章節 anchor（kind=chapter）也能跨版；引用不需依賴「有沒有 `<卷>`」。

## 3. swjz 要修的只有兩件事（都照 swjzz 的既有做法，不自創格式）

### 3.1 540 筆無 id 的 `<字>` 附錄 → 改 `<部目>`
swjzz 已經是 `<部目>`（540 筆）＋`<字>` 恰好 10,706；swjz 卻把附錄塞進 `<字>`，
導致 `<樹 s="$字">` 字頭樹混入 540 筆**不可定位**的重複字頭（打「一」會跳兩條、第二條不會動）。

- 建議：swjz 附錄改用同名 tag `部目`，並給 id `bu001`…`bu540`（swjzz 現行 `<部目>` 有沒有 id 要查它那一版，
  兩版一致才不會让 caches 鍵分岔）。
- 這屬**標記變動**（不是經文用字），依契約要你批准；同時要補進 `validTags` 與 `cachedTags`。

### 3.2 字頭本體混入構形描述（44＋條）
```text
w0123060  swjz 字頭「荒(⿱艹㠩)」   vs  swjzz 字頭「荒」
w0920420  swjz 字頭「敡(⿰易攵)」   vs  swjzz 字頭「敡」
```
swjz 有 **59 個多码點字頭**（我上一輪 `docs/swjz-glyph-forms.md` §1 ⑦ 量到的那批），
形體資訊被寫進字頭字串 → 搜尋「荒」搜不到這一條、字頭樹顯示也怪。
swjzz 的解法是獨立 `<構形>` tag（863 筆）。

- 建議：swjz 把 `字(X)` 拆成 `<字 id>字</字>` ＋ `<構形>X</構形>`，一併把 `構形` 進 `validTags`。
- 這同屬標記變動，需批准；**不动** 字頭本體用字。

### 3.3 順帶（不必批准，屬資料說明）
- `img="nil"` 6 筆：w0540010 十、w0970031 𤕤、w1800580 餽、w4081320 𢠽、w4081330 慢、w5180011 𢀒。
  swjz 全庫沒有圖檔；要圖就得像 swjzz 內嵌 SVG（20.4 MB），或明確降為純文字版並在 about 寫清楚。
- 我的 size 統計裡 `max 35,156 / 31,604` 是**假值**：最後一個字條的範圍一路括到檔尾附錄。
  引用端要避開最後一條，或我在 manifest 加附錄邊界後重算（小事，先記著）。

## 4. 四庫互鏈的地址（依作者規格實作）

```text
jin     work?篇名#a-b        ＋ 衍生：書名／篇名／篇內行序／行內漢字序（out/jing-manifest.tsv 給 line、textEnd、segBodyLines）
swjz    shuowen?w…#a-b       ＋ 例：zone 序號與 a-b（out/swjz-zone.tsv：charId、zoneSeq、tag、a、b、zoneLine、textHash）
swjzz   shuowen?w…#a-b       同上（out/swjzz-zone.tsv；zone 是 說文／說文異／段注／構形…）
hydzd   字＋例→行→字元        待我做（hydzd.adb 35.9 MB，今天被該區重建過 → 先只讀）
```

「例」不新發明 kind：**zone 用字條內的漢字 span 表達**（`a-b` 本身就能字元級），
manifest 另存 `tag`（說文／段注／粗／duan_note…）與 `zoneLine`，
所以引用可以寫成 `shuowen?w0010010#0-20` 而顯示為「一＼說文＼第1行＼字1-9」。

xout 歸引用端 own（`xout_shuowen`、`xout_yijing`…）；原文庫不存反鏈。

## 5. swjzz 重建可再現性（2026-11-06 追加）

你說「swjzz 也沒有」之後，我走的是**它自己的管線**（不互抄產生器）：

```powershell
bun run src/pack-swjzz.ts        # 包一層 spawn 呼叫 D:\2026\adb-converter\ts\tools\swjz-pack.ts
```

輸入與結果：

```text
輸入  D:\2026\swjzz\build\swjz-seal.txt  5,361,775 B（60,754 行、10,706 字頭、7,073 個 <圖>）
小篆  D:\2026\swjzz\build\seal2          7,052 個 SVG → resources seal/*.svg
輸出  out/swjzz.rebuild.adb  20,435,719 B  sha 05788458ec0f
現行  D:\accelon3\swjzz.adb  20,435,719 B  sha 05788458ec0f   ← 位元組完全相同
源文字 vs adb 解包：不同行 0／60,754
```

**結論：swjzz 不需要「新版」——它本來就沒有 swjz 那兩項缺陷**（附錄已是 `<部目 n="1..540">`、
字頭沒有 `(IDS…)` 混入）。所以我也**沒有覆蓋它**（sha 一樣，覆蓋只是碰鎖檔風險）。

兩版真正共有的殘留缺陷（重建修不掉，屬來源層）：

| 缺陷 | 數量 | 說明 |
|---|---:|---|
| 字頭是圖號 `（图NNNA-NN）` | 12 | 原檔就沒有這個字，形體只在書影；swjzz 自己的 about 也列了這一項 |
| 字頭以 IDS 起頭（無小篆本字可分） | 3 | `⿰金⿱丣刀`、`⿲矢𦣝亏`、`⿰歹𦟀` |
| 字頭 U+FFFD | 1 | `w4230012`，來源轉碼時已丢字 |
| 字頭無小篆 SVG | 3,608 | 字型或 Big5 沒有該字（多為擴充區罕用字） |

`swjzz` 那區的 `version-log.md` **至今沒有紀錄列**（檔頭還掛著「卍新纂大日本續藏經」的模板），
建議在該區補一行；我不越區改別人的 version-log。


## 6. swjz 已執行（標記修正與交付，作者回「新的 swjz.adb 沒在 d:\accelon3」＝批准＋要求交付）

| 項目 | 結果 |
|---|---|
| ① 附錄 `<字>`→`<部目 n="1..540">` | 540／540 完成；`attributes/部目.n` 540；無 id 的 `<字>` **540 → 0** |
| ② 字頭 `(IDS)`→`<構形>` | 拆出 44 條；**字頭與 swjzz 差異 44 → 0**；15 條拆不了（3 條純 IDS 起頭、12 條字頭本是圖號「（图NNNX-NN）」）→ 不動、待來源查證 |
| schema | tags 37→39（新增 `部目`、`構形`，缺 0）；caches＝集 字 部目；resources 原樣帶過；`dbname`／`dbtype`／`features` 沿用舊值 |
| VA | **有位移**：首次 line 4161、末段累計 **+260**（44 ×（2 個標籤邊界 8 − 括號字元 2））。char anchor 靠 id＋字條內漢字序，不受影響 |
| 交付 | `D:\accelon3\swjz.adb` 5,461,914 B，sha256 `5c3a722a9d9b…`；舊檔備份 `out/swjz-original.adb`（`f8185d0d7926`） |
| manifest | 對**交付版正文**重出：`out/swjz-new-char.tsv` 10,706、`out/swjz-new-zone.tsv` 47,635、`out/swjzz-char.tsv`／`-zone.tsv` 48,257 |
| 跨版 | 交集 10,706；textHash 相同 10,095（94.3%）、不同 611 → 引用端选 swjzz 為 primary 並帶 `targetTextHash` |

我 build 報告裡那個「預估 VA +4672」是**估算法錯了**：`<字>`→`<部目>` 兩個都是非 skip 標籤、
各 4 VA，淨零；真正的位移只來自 `<構形>`。以 `out/swjz-pack.txt` 的實測 +260 為準。

**待辦（不在我這邊）**：12 條圖號字頭與 3 條純 IDS 字頭要回來源（書影／大徐本）查真正字頭；
`swjzz` 不需重建；`hydzd` 的字＋例 manifest 還沒做（該區今天剛重建過，我仍未動它）。

### 原本的兩個問題——現況

1. §3.1／§3.2 的標記變動**已依你指示執行並覆蓋** `D:\accelon3\swjz.adb`（未改檔名，
   因為 `dbname` 必須等於檔名、且 char id 全在檔內不變）。若 Accelon 當時開著這顆，
   請重開一次讓它讀新檔。
2. `swjzz` 那區**我沒有動**，也不需重建就能鏈（char＋例 manifest 已在 cct 端產好）。
   只有當你要把 `部目` 補上 `id`（目前是 `n="1..540"`，與新版 swjz 一致）時，才需要在
   `D:\2026\swjzz` 跑一次——那是那個工作區的產品，我不越區寫。
