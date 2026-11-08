# swjzz → jing 互鏈（第一版產出與反解驗證，2026-11-06）

> 你指示「開始做 swjzz link jing.adb」，另有「可比照 cyd 補（hydzd 字頭 id），補完留下文件」。
> 兩件都在這輪落地：链接產出 ＋ hydzd id 分配表。
> **本輪沒有動 `D:\accelon3` 任何檔案**（swjzz／hydzd 的 adb 都不覆蓋）。

## 1. 重跑方式

```powershell
cd D:\2026\cct
bun run src/extract-adb.ts D:\accelon3\13j.adb   out/13j      # jing 的正文來源（舊庫解包，只讀）
bun run src/build-jing.ts                                       # jing anchor manifest
bun run src/extract-adb.ts D:\accelon3\swjzz.adb out/swjzz     # 引用端正文（只讀）
bun run src/link-swjzz-to-jing.ts                               # 產 out/xout_<work>.jsonl
bun run src/verify-xout-jing.ts                                 # 反解驗證
bun run src/assign-hydzd-ids.ts                                 # hydzd 詞 id 分配表（比照 cyd）
```

## 2. 結果

`jing` 側：2,007 個 anchor（缺陷 0）、13 個 work 的漢字流共 **636,388** 字。

`swjzz` 側掃描：10,706 個字條、48,257 個例區塊（說文／說文異／段注…）。

| 項目 | 數量 | 說明 |
|---|---:|---|
| 引書句式命中 | **1,630** | 「詩云」「《書》曰」「周禮」「左傳」「雅曰」… |
| **解析成功並寫入 xout** | **579** | 見下方分桶 |
| 來源端 a-b 定位失敗 | 0 | 每筆都能回到該字條的漢字序 |
| 引文過短（<4 漢字） | 311 | 多是「詩也」「書云」式虛引或片語 |
| 書名無法對應 work | **59** | **全部是裸字「禮」**（周禮／禮記／儀禮 三者歧義，依 spec §7 不猜） |
| 連 8 字前綴都找不到 | 1,051 | 真異文／引的是注疏或非十三經文獻 |
| 多候選（同段引文重複出現） | 68 | 目前取第一處，標記在報告內 |

**反解驗證：579／579 通過** —— anchor 存在 100%、切片摺疊後等於 quote 100%、
`targetTextHash` 與目前 manifest 一致 100%（`out/xout-verify.txt`）。

分桶（每 work 一桶，共 579）：

```text
xout_shijing   201    xout_zuozhuan  109    xout_liji    83    xout_yijing  43
xout_mengzi     37    xout_shangshu   29    xout_erya    26    xout_lunyu   25
xout_zhouli     24    xout_gongyang    2
```

`guliang`／`xiaojing`／`yili` 未產桶：段注引用這三部時多半以篇名或「春秋」形式出現，
目前句式沒命中——不是鏈接機制問題，是 cue 清單要長。

## 3. 記錄格式（依 spec §5.2／§4.4）

```json
["XOUT1","shijing",201,"sha256:<manifest 摘要>","swjzz"]
["char:w0010050", -1, 12, 24, "seg:關雎", 46, 58, "牛馬之屬", "quote", 92, "<targetTextHash>"]
```

欄位順序＝`sourceAnchor, sourceVa, sourceA, sourceB, targetAnchor, targetA, targetB, quote, kind, confidence`，
第 11 欄是我多放的 `targetTextHash`（spec §7.2 要求 xout record 帶它）。
`sourceVa` 一律 `-1`（本區不拿 VA 當地址）。

### 為什麼 a-b 能字元級又不怕異體
摺疊函數是**逐字 1→1**（NFKC→首個漢字→s2t→首個漢字→VMAP），長度永遠不變，
所以「摺疊空間的字元索引」＝「原始漢字索引」。比對在摺疊空間做（容忍簡繁／異體），
寫進 xout 的 a-b 卻是原始正文的座標 → 兩者不打架。
**一旦有人把摺疊改成 1→N（例如展開成多字），這個等價關係就會破，a-b 會整體偏移** ——
這是這條管線的隱形前提，記在 `docs/text-hash-verification.md` 與此處。

## 4. hydzd 比照 cyd 補 id（你批准的項目）

實測現況：`<詞>` **82,280 筆完全沒有 id**，25,954 筆帶 `py`；字頭種類 82,130，
**149 組重複（涉及 299 筆）** → 之前只能靠 `#N`（綁文件序，插一條就亂）。

分配表：`out/hydzd-id-assign.tsv`（82,280 列：行號、現況屬性、字頭、`詞.id`、`詞.a`、anchorId 建議）

- `詞.id` ＝ 1..82,280（adb 內部穩定序，不進對外地址）
- `詞.a` ＝ 同形序（cyd／hydcd 的 `a=` 慣例）；**只有那 149 組需要**，其餘 a=1 可省
- `anchorId` ＝ 唯一字頭用裸字頭；重複用 `字頭#a`（綁字頭本身，插條不受影響）
- 重複最多例：「地肤×3」等（前 12 見報告檔）

落地代價（打包前必須知道，我在表末也寫了）：
`<詞>` 加 id ＝ 每條 +4 VA → 共 **+329,120 VA**。hydzd 的連結是 `<聯 n=詞條>` 名稱型、
沒有 `j=` 座標型，所以**庫內連結不受影響**；任何外部拿 VA 當地址的引用會全數位移。
`caches` 現況只有「詞」單鍵，加 id 不改 cache 鍵。

## 5. 下一步（按性價比排）

1. **把 xout 放進 swjzz.adb**：需要 swjzz 那區的 `swjz-pack.ts` 帶 resources＋extraContainers；
   或我先只在 cct 留檔、由該區打包。要我動 `D:\accelon3\swjzz.adb` 請點頭（該檔 10-28 建的）。
2. **`禮` 的內容消歧**：拿引文分別去 周禮／禮記／儀禮 試，唯一命中才寫（spec §7 的 primary+alternates）。
   這能撈回 59 筆，且不會造錯鏈。
3. **cue 清單要長**：「大雅曰」「小雅」「二南」「召南」「國風某篇」等；
   以及「春秋」之後接「左傳」「公羊」的複合形式（我這輪已補 `春秋`→左傳、`雅`→爾雅）。
4. **多候選 68 筆**：需要 `target_hint`（卷／篇名）協助挑正確那一處；目前一律取第一處，
   這 68 筆我建議先降 confidence 再入庫。
5. 1,051 筆「找不到」要分類抽驗：多少是段注自己改字（異文）、多少是引注疏、
   多少是我句讀切錯——這決定要不要做「分段引文」的第二輪。

## 6. 產物清單（全在 `out/`，不進版控）

```text
xout_shijing.jsonl xout_zuozhuan.jsonl xout_liji.jsonl xout_yijing.jsonl xout_mengzi.jsonl
xout_shangshu.jsonl xout_erya.jsonl xout_lunyu.jsonl xout_zhouli.jsonl xout_gongyang.jsonl
link-jing-report.txt   link-unresolved.tsv   xout-verify.txt
hydzd-id-assign.tsv    hydzd-id-assign.txt
```
