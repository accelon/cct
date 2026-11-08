# src — 目前實作的工具

本區已不是「還沒實作」：先有**讀與量測**這一層（2026-11-06），builder 尚未寫。
定案與取捨見 [`docs/anchor-proposal-13j-swjz.md`](../docs/anchor-proposal-13j-swjz.md)。

## 工具

| 腳本 | 做什麼 | 指令 |
|---|---|---|
| `extract-adb.ts` | 用母區 `adbtext.ts`＋`accelon26/adb.ts` 把 `.adb` 解成逐行標記文字，並量 header／tagNames＋VA 命中數／caches／resources | `bun run src/extract-adb.ts D:\accelon3\13j.adb out/13j` |
| `analyze-dump.ts` | 從 dump 推結構：13j 的 章/節/項 樹、leaf 判定、最少祖先、anchor manifest、篇內子章候選；swjz 的字 id 結構、img、卷/部、字條大小 | `bun run src/analyze-dump.ts 13j` ／ `… swjz` |
| `page-scan.ts` | 13j 的 `<頁 n>` 每書分佈＋缺字佔位符（`●`／`○`／`□`）計數與位置 | `bun run src/page-scan.ts` |
| `cross-check.ts` | 把本區推導的 2,007 節點與引用端實物 `D:\2026\gycd\interlink\seg-manifest.csv` 逐筆對照（id 集合、邊界、hash、usable） | `bun run src/cross-check.ts` |
| `diag-class.ts` | 單條目除錯：同一段文字在不同「漢字類」定義下各算幾個（查星體／代理對計數差） | `bun run src/diag-class.ts 420 426` |
| `verify-link-efficiency.ts` | 拿 gycd `accepted.tsv` 69,838 條實鏈，對比「文字搜尋落地（現況）」與「id 直查＋a-b 反解」的命中率與耗時 | `bun run src/verify-link-efficiency.ts` |
| `diag-offset.ts` | 把「切片不符」依「實際位置 − 宣告 target_a」分箱，判別 off-by-one／座標系／內容缺失 | `bun run src/diag-offset.ts` |
| `probe-attributes.ts` | 唯讀探針：列出現行 adb 的 `attributes` 鍵與筆數（runtime 到底有沒有 id 可用） | `bun run src/probe-attributes.ts D:\accelon3\13j.adb` |
| `make-fold-table.py` | 產生 `data/char-fold.tsv`：把 gycd 的 `norm_char(tier=1)`（NFKC→首個漢字→s2t→首個漢字→VMAP）凍結成逐字表，VMAP 由其原始碼 `ast` 讀出、不手抄 | `python src/make-fold-table.py out/13j.xml out/swjz.xml` |
| `probe-hash.py` | 判別實驗：同一段落用 raw／tier0／tier1 三種輸入各算 hash，比對 gycd 值 | `python src/probe-hash.py` |
| `probe-table.py` | 用本區的表在 Python 重算 hash，判別錯在「表」還是「TS」 | `python src/probe-table.py` |
| `dump-n1.ts` | 輸出單一個 anchor 的 n1（摺疊後漢字串）供逐位元組比對 | `bun run src/dump-n1.ts 9 35` |
| `glyph-forms.ts`／`glyph-audit.ts`／`glyph-samples.ts` | swjz 字頭九種字形管道統計（码点安全，輸出全 ASCII） | `bun run src/glyph-audit.ts` |
| `build-hydzd-manifest.ts` | hydzd 的 entry（字頭）＋例（`<例 t=…>`）manifest，含 a-b 與 textHash | `bun run src/build-hydzd-manifest.ts` |
| `link-swjzz-to-jing.ts` | 抽 swjzz 引經句 → 落 `jing` anchor ＋字元級 a-b → 產 `out/xout_<work>.jsonl` | `bun run src/link-swjzz-to-jing.ts` |
| `verify-xout-jing.ts` | 反解驗證 xout：anchor 存在、切片＝quote、textHash 一致 | `bun run src/verify-xout-jing.ts` |
| `pack-xout.ts` | 把 xout 容器塞進 adb（沿用來源 schema）並讀回驗證 | `bun run src/pack-xout.ts D:\accelon3\swjzz.adb out/swjzz.xout.adb` |
| `assign-hydzd-ids.ts` | 比照 cyd，為 hydzd 82,280 個 `<詞>` 生成 id／a 分配表（只產表，不改檔） | `bun run src/assign-hydzd-ids.ts` |

大架構、六段管線、runtime 缺口與「慢慢弄」的帳：[`docs/architecture.md`](../docs/architecture.md)

→ textHash 復現驗證：[`docs/text-hash-verification.md`](../docs/text-hash-verification.md)
→ 字頭字形盤點：[`docs/swjz-glyph-forms.md`](../docs/swjz-glyph-forms.md)

**⚠ `data/char-fold.tsv` 是建置輸入**（15,646 字、297 個會摺疊、provenance 記在檔頭）：
新增書或換語料後要重跑 `make-fold-table.py`，並確認 `analyze-dump` 報 `foldMiss=0`；
TS 載入必須 `split(/\r?\n/)`——Python 在 Windows 寫 CRLF，少切一個 `\r` 會讓全庫 hash 作廢。

→ 量測結果與 UI 建議：[`docs/link-efficiency-2026-11-06.md`](../docs/link-efficiency-2026-11-06.md)

## 產出（`out/`，不進版控）

```text
13j.xml 13j.meta.txt 13j-tree.tsv 13j-manifest.tsv 13j-report.txt 13j-pages.txt
swjz.xml swjz.meta.txt swjz-report.txt
```

`13j-manifest.tsv` 欄位：`work adbBook anchorId kind label displayPath line hanCount textHash ancestorDepth`
（1,925 個 leaf anchor，已可直接給 prebuild xout 當 target manifest 雛形）。

## 規則（沿用）

- 不自寫容器解析；一律走母區 `ts/src/adbtext.ts`、`authorAdb`、`han.ts`、`page-text.ts`。
- 加 `id` 不改 VA（`index-builder.ts:139,283`：非 skip 標籤固定 `TAGLENGTH = 4`）——
  遷移安全性的根據。
- builder 尚未寫；沒有 builder 的 work 不要假裝已建置。
- 舊 `src/legacy/split-*.js`／`gen-yijing.js` 仍是 legacy，不是新管線。

## 下一步（等作者定 §5 粒度與 §6 部首 tag）

```text
src/build-13j.ts      讀 out/13j.xml，只插 id／必要時換附錄 tag，其餘逐字保留
                      成品 dbname／檔名＝**jing**（作者已把 13j 改名 jing，舊 13j.adb 不動）
                      → out/jing.xml、out/jing-manifest.tsv，驗證後才談 D:\accelon3\jing.adb
src/build-shuowen.ts  swjz（swjzz 在 D:\2026\swjzz 那區跑同一套規則）
src/check-anchors.ts  §8 的七條驗收＋跨版本字 id 交集
```
