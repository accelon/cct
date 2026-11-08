# textHash 復現驗證（13j，2026-11-06）

> 作者已定案：`textHash` 以 `D:\2026\gycd\interlink\seg-manifest.csv` 為準，演算法寫進母區
> `ancient-book-xref-spec.md` §4.4「textHash 的精確定義（gycd 實作）」（該檔 18:33 更新過）。
> 本檔記錄**我能不能用同一套演算法產出同一個值**，以及過程踩到的坑。
> 結論：**能。2,005 個可比對 anchor 中 1,929 個完全相同；75 個是 0 漢字節點的空字串慣例差；
> 真差異只剩 1 筆。**

## 1. 演算法（照 spec §4.4，逐字）

```python
n1 = ''.join(norm_char(c, 1) for c in han_chars(segment_text))
textHash = hashlib.sha256(n1.encode('utf-8')).hexdigest()[:16]      # 16 個小寫 hex
```

`norm_char(c, 1)` 的 five steps：`NFKC(c)` → 取第一個 `\p{Script=Han}`（沒有就保留原字）
→ OpenCC `s2t` → 再取第一個 Han → 套 `VMAP` 折疊異體。
`VMAP` 共 **29 條**（`无→無`、`説→說`、`爲→為`、`旣→既`…），我從
`gycd/interlink-coverage.py` 原始碼以 `ast.literal_eval` 讀出，**不手抄**。

## 2. cct 端的做法：把正規化凍結成「逐字摺疊表」

builder 是 TS（bun），不能依賴執行期的 Python／OpenCC，所以：

```powershell
python src/make-fold-table.py out/13j.xml out/swjz.xml   # → data/char-fold.tsv
bun run src/analyze-dump.ts 13j                          # TS 只做查表 + sha256[:16]
```

- 表內容：13j＋swjz 全部漢字 **15,646 個**，其中 **297 個**摺疊後不同；
  檔頭記 provenance（來源檔 sha256 前 12＝`2bb7dea582c2`、VMAP 29 條、規則五步）。
- TS 查不到字就退回 `NFKC` 並計 `foldMiss`；本次 **foldMiss=0**（全覆盖）。
  日後新增字（例如那 14 部新登记的書）必須重跑 `make-fold-table.py`，
  否則 hash 與 gycd 不同源而 `stale` 判斷失效。

## 3. 驗證結果

| 項目 | 數量 |
|---|---:|
| 可比對 anchor（兩邊都有、行號配對） | 2,007 |
| **textHash 完全相同** | **1,931** |
| 0 漢字結構節點（gycd 留**空字串**，本區算 `sha256("")`＝`e3b0c44298fc1c14`） | 75 |
| 真內容差異（邊界相同、漢字數不同） | 1 |
| 本區依契約不編 id 的缺陷（周禮 `●人` ×2） | ~~2~~ → **0**（缺字查得真名，見 §6） |

> 作者是**重建**、不必遷就舊 id／舊 hash（本輪裁定），所以上面 75 筆空字串慣例差
> 與 1 筆待查都不阻擋交付；真正要比的是「同一份新正文，兩端各算一次会不会一致」。

判別實驗（`src/probe-hash.py`，同一批段落三種輸入各算一次）：

```text
比對 2005 條：  raw=387   tier0(只 NFKC)=387   tier1(NFKC+s2t+VMAP)=1929
```

→ 印證 spec 的警告：**用 raw 文字算 sha256／md5／sha1 一定對不上**（我上一輪就卡在这里），
tier 1 才是 gycd 的值。
`src/probe-table.py` 再用「本區產出的表」在 Python 裡重算，`乾`＝`a62884f22aedd3f9`＝gycd 值
→ 證明**表正確**，錯在 TS 實作（見 §4）。

## 4. 過程中挖到的兩個坑（都已在 cct 端修掉）

1. **CRLF**：`make-fold-table.py` 用 Python 在 Windows 寫檔，預設行尾是 `\r\n`；
   TS 只 `split("\n")` → **每個摺疊值都多帶一個 `\r`**，`乾` 的 n1 變成 1,990 个 code point
   （該 995 字），hash 全庫 0 個相同。改 `split(/\r?\n/)` 後才對上。
   → 建議：母區若日後要收這張表，**寫檔時就固定 `\n`**，別讓行尾吃進值裡。
2. **代理對計數**（上一輪已記）：`join("").length` 把星體字算 2；一律用码点陣列長度。

## 5. 那 1 筆真差異（待查，不影響方案）

`mengzi` line **41268**：邊界兩邊一致（都到 41382），但我算 2,397 漢字、gycd 記 2,395；
用 Python 與 JS 各自的 `\p{Script=Han}` 抽同一段都是 2,400 字 → **不是漢字分類差異**，
而是我 ad-hoc 取样與正式 parser 的切片細節差（residual／末行空行處理）。
重現：

```powershell
bun run src/cross-check.ts        # out/13j-crosscheck.txt「真正內文不相符: 1」
python src/probe-hash.py          # 逐條並列 raw／t0／t1／cct
```

等 `src/build-13j.ts` 完成、兩邊都用同一份 parser 時再收斂這 1 筆。

## 6. 順帶把兩個缺字查掉了（作者指示「用前後文上網查」）

| adb 行 | 前後文（條件之一） | 查得 | 码点 | 依據 |
|---|---|---|---|---|
| 5635／5636 | 「●人**掌金玉錫石之地**，而為之厲禁以守之」 | **卝人**（kuàng rén，卝為「礦」古體；部分版本作「丱」） | `卝` U+535D（另 `丱` U+4E31） | 《周禮·地官》「卝人掌金玉錫石之地」；《周禮卷十七》同；《卝人》詞條（始見《周禮·地官》，鄭玄注「卝之言礦也」） |
| 5673／5674 | 「●人**掌凡祭祀共盛**，共王及后之六食」 | **饎人**（chì rén，主炊之官；屬地官，序在舂人後、稾人前） | `饎` U+994E | 《周禮句解》卷四「饎人：掌凡祭祀共盛，共王及后之六食」；《周禮訂義》卷二十八同文且注「故書作▢」——正是原稿缺字成 `●` 的由來 |

兩字都在 **CJK 基本區**，不需要造字或 PUA；也因為兩字不同，原本「同父同名」的衝突自動消失。

修字流程寫死成條件式（`data/quezi-fix.tsv` ＋ `src/analyze-dump.ts`）：
**行號＋原標籤＋前後文**三者相符才套用，否則進 `fixRejected` 回報，絕不單靠猜。
實測：套用 2 筆、拒絕 0 筆 → `idAssigned 2,007／2,007`、缺陷 0。

交叉證明（同一行、兩端各自算 hash）：

```text
zhouli?卝人  line 5635  本區 1531f0cdd62338d6 ＝ gycd 1531f0cdd62338d6   （gycd 該行 id 原記 地官司徒/●人#1）
zhouli?饎人  line 5673  本區 d3fe497b2d378b4f ＝ gycd d3fe497b2d378b4f   （gycd 該行 id 原記 地官司徒/●人#2）
shangshu?堯典 line 705  本區 93dd35d6912aa360 ＝ gycd 93dd35d6912aa360
shijing?關雎  line 1715 本區 19b5bd8fb693fbdf ＝ gycd 19b5bd8fb693fbdf
```

**未動的部分**：正文其餘 `●` 177 次、`□` 39 次（`○` 6,981 次為句圈標點，不是缺字）
——依契約只回報、不自行替換；要改正文需你另外批准。

## 7. 連帶定案的兩件事

1. **13j 的 id 命名**（作者本輪指示）：篇名／節點名**視同詞條**，直接用目錄節點文字當 id
   （`關雎`、`堯典`、`學而`…），**不拼音化、不給序號**；只有**書名**（work 身份）用拼音
   （`yijing`／`shijing`／`lunyu`…）。這與 spec §4.1 例、`prompts/13j.md` §3.1 一致，
   本區產出的 `out/13j-manifest.tsv`（1,002 bare／1,003 加一層祖先／2 缺陷）就是照這條做。
2. **0 漢字節點的 textHash 慣例**要寫進母區契約：`hanCount=0` 時 textHash 留**空字串**，
   不要寫 `sha256("")`。否則兩端必然差這 75 筆，`stale` 判斷會把它們全當「已改版」。
   （我不能動 `D:\2026\adb-converter`，這條是給母區的契約修訂建議。）
