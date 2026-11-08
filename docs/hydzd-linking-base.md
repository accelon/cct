# hydzd 的「字＋例」manifest（2026-11-06）

> 四庫互鏈的最後一塊地基。來源＝交付版 `D:\accelon3\hydzd.adb`（35,909,141 B，
> 今天被該區重建過，我**只讀未寫**）。
>
> ```powershell
> bun run src/extract-adb.ts D:\accelon3\hydzd.adb out/hydzd
> python src/make-fold-table.py out/13j.xml out/swjz.xml out/swjzz.xml out/hydzd.xml
> bun run src/build-hydzd-manifest.ts
> bun run src/verify-hydzd-ab.ts 400
> ```
> 產出：`out/hydzd.xml`、`out/hydzd-entry.tsv`（82,280）、`out/hydzd-zone.tsv`（143,044）、
> `out/hydzd-manifest.txt`、`data/char-fold.tsv`（64,748 字）。

## 1. 交叉驗證：解析器對上了容器實物

| 我的掃描 | adb 容器實測 | |
|---|---|---|
| entry 82,280 | `<詞>` 標籤命中 82,280 | ✅ |
| zone 143,044 | `<例>` 標籤命中 143,044 | ✅ |
| 成對 82,732／自閉合 60,312 | `<例>` 143,044 減 `/例` 82,732 | ✅（自閉合不進 close hit） |
| `a-b` 反解抽樣 401 筆 | **100% 相同** | ✅ 字元級定位可用 |
| 摺疊表查不到字 | 0 | ✅ |

## 2. hydzd 的體例結構（實測）

```text
<詞 py="āi">唉</詞>            ← 82,280 筆；25,954 筆帶 py
<例 t="説文">《説文》：“唉，譍也。从口，矣聲。”</例>     成對＝短值包住
<例 t="拼音">āi</例>
<例 t="音韻">《廣韻》烏開切，平咍影。之部。</例>
<例 t="義項"/>                                          自閉合＝分隔列
① 叹词。                                                內容行（到下一個 <例>／<詞>）
《説文‧口部》：“唉，譍也。”                              書證行
…
<例 t="拼音">ǎi</例>        ← 同一字頭第二輪讀音（pronGroup 2）
```

`zone` 的 `t=` 分佈：義項 71,405／音韻 40,911／拼音 18,637／説文 9,562／簡體 2,298／異體 231。
多音字頭 7,990 個（最多 10 輪）；**21,800 個字頭沒有任何 zone**（純參見條，如
`<詞>○</詞> 參見<聯 n="〇">〇</聯>`）。

大小：entry 漢字 min 0／中位 21／max 4,728；zone min 0／中位 11／max 3,865；
**zone >240 漢字 4,888 個**（xout `quote` 上限，要比對片段而非整區）；
zone 0 漢字 18,469 個（textHash 依慣例留空字串）。

## 3. 兩個必須讓你知道的問題

### 3.1 `<詞>` 完全沒有 id（82,280 筆全是 0）
cyd 是 `<詞 id zy="…">`，hydzd 只有 `<詞 py="…">`。所以 anchorId 只能取字頭文字，
而實測**有 149 組字頭重複（涉及 299 筆）**，必須加 `#N`：

```text
地肤×3   欸乃×2  菴䕡×2  犮×2  枹罕×2  鵖×2  咇茀×2  蹩躠×2  蠺×2  粣×2 …
```

後果：`anchorId` 的穩定性綁在**文件順序**上（插入新條目會讓 `#2` 變成別的字）。
建議（属 hydzd 工作區的產品變動，我不越區改）：比照 cyd 給 `<詞 id>`，
`anchorId` 改用 id，字頭文字只當 alias。

### 3.2 簡繁摺疊會把不同字頭合成同一串——6,102 組
textHash 的正規化鏈含 OpenCC `s2t`，因此：

```text
阿房宫 / 阿房宮     锕 / 錒      皑 / 皚      噯 / 嗳      騃 / 𫘤      蔼 / 藹 …
```

摺疊後**相同**。定論：

- **anchorId 一律用「未摺疊的原字頭」**（我產的 manifest 就是原字頭）；
- `textHash` 只能用於「同一 anchor 的內容有沒有變」的 stale 判斷，
  **不能當 key、不能用來判兩條是不是同一個字**；
- 引用端做 quote 比對時，若靠摺疊後相等來選條目，會在簡體條／繁體條之間選錯。
  這也是 `folded_diff` 從 297（13j＋swjz＋swjzz）暴增到 **4,478**（加進 hydzd）的原因——
  hydzd 有 2,298 個 `<例 t="簡體">` 區，本來就是簡繁並陳的書。

## 4. 四庫 manifest 現況（互鏈的地基齊了）

| 庫 | anchor 單位 | 筆數 | textHash 來源 | 備註 |
|---|---|---:|---|---|
| `jing` | `seg`＝篇名（撞名加 1 層祖先） | 2,007 | 已與 gycd 互校 1,931/2,007 | ✅ adb 已交付 |
| `swjz` | `char`＝`w…`；例＝`<粗>`／`<duan_note>` 等 | 10,706 ＋ 47,635 zone | `out/swjz-new-*.tsv` | ✅ adb 已交付（標記修正版） |
| `swjzz` | `char`＝同 w…；例＝`<説文>`／`<段注>`… | 10,706 ＋ 48,257 zone | `out/swjzz-*.tsv` | 未重建（也不需要） |
| `hydzd` | `entry`＝字頭（149 組需 `#N`）；例＝`<例 t=…>` | 82,280 ＋ 143,044 zone | `out/hydzd-*.tsv` | ⚠ 字頭無 id |

跨庫可直接用的穩固連結：**swjz／swjzz 共用同一組 10,706 個 `w…`**（交集實測 10,706、
textHash 相同 94.3%）；`hydzd → shuowen`、`swjz/swjzz/hydzd → jing` 都靠 work＋anchor＋a-b。

## 5. 下一步（按你之前定的順序）

1. `swjz → jing` 引經抽取與解析（源頭 2,876 條線索：詩 763／書 454／左傳 214／易 208／周禮 148…），
   產 `XOUT1` records（`targetAnchor=seg:<篇名>`、`targetA/B`、`quote`、`kind`、`confidence`、`targetTextHash`）。
   gate：anchor 必須在 `out/jing-manifest.tsv` 裡存在，hash 對不上就進 `unresolved`／`stale`，不寫正式 xout。
2. `hydzd → shuowen`：字典引《説文》的 9,562 個 `<例 t="説文">` 區是最好的入口（每區平均 11 漢字，
   遠低於 quote 上限），比對 `w…` 字條的 `<説文>` zone 就能字元級落地。
3. 若要我把 `hydzd` 補 `<詞 id>`，得經你同意再動那個工作區（它的 adb 今天才重建）。
