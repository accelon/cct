# cct version log

格式：日期／adb／sha 前 12／大小／buildTime（UTC）／說明（＋發布與否）。
每次建置完成就加一列；母區發佈前會來取。

| 日期 | adb | sha256 前 12 | 大小 | buildTime | 說明 |
|---|---|---|---|---|---|
| 2026-11-06 | jing | `25c032f960e5` | 2,325,741 | 2026-11-06 11:27:31 UTC | **首次建置**（由舊 `13j.adb` 升級，非重打正文）。只插 2,007 個語意節點 `id`（章 259／節 1,448／項 300；bare 1,004＋加一層祖先 1,003；缺陷 0）。缺字修正 2 筆條件式套用：周禮 line 5635→`卝人`、5673→`饎人`。驗收：去標籤逐行相同、`lines.virtual` 零位移、標籤命中與舊庫一致、`attributes` 新增 章.id／節.id／項.id。產物 `D:\accelon3\jing.adb`（`dbname=jing`）；**舊 `13j.adb` 原樣保留**、未發布官網。連結：`out/jing-manifest.tsv`（2,007 筆 anchor＋textHash）。註：原名誤拼 `jin` 已全鏈路改來；錯名那顆（sha `d1621133eaf8`）已送回收桶（可還原） |
| 2026-11-06 | swjz | `5c3a722a9d9b` | 5,461,914 | 2026-11-06 12:53:46 UTC | **標記修正版**（同檔名覆蓋；舊檔已備份 `out/swjz-original.adb`，sha `f8185d0d7926`）。① 書末 540 筆無 id 的 `<字>` 附錄 → `<部目 n="1..540">`（照 swjzz 慣例），`<樹 s="$字">` 不再混入不可定位字頭；② 44 條字頭的 `(IDS…)` 拆成 `<構形>`，**字頭與 swjzz 差異 44→0**；15 條拆不了（3 條純 IDS 起頭、12 條字頭原是圖號「（图NNNX-NN）」）→ 留待來源查證，未猜字。新增標籤 `部目`／`構形`（37→39 tags，缺 0），`caches`＝集 字 部目，resources 原樣帶過。**VA 有位移**：首次 line 4161，末段累計 +260（44×(2 個標籤邊界 8 − 括號 2)）；引用端 char anchor 不受影響（靠 id＋字條內漢字序）。manifest 已對新正文重出：`out/swjz-new-char.tsv` 10,706／`out/swjz-new-zone.tsv` 47,635 |
| — | swjzz | — | — | — | **不需要重建**：`<字 id>` 已恰好 10,706、附錄已用 `<部目>`、篆圖已內嵌（resources 7,052）。跨版 char anchor 交集實測 10,706；textHash 相同 10,095（94.3%）、不同 611。manifest 在 cct 端產出：`out/swjzz-char.tsv`／`out/swjzz-zone.tsv`（48,257 個例區塊） |
