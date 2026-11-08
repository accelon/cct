# 四庫互鏈：jing／swjz／swjzz／hydzd（設計與進度）

> 作者指示（2026-11-06）：以這四庫為基礎把彼此鏈起來。
> 定位粒度：**jing＝書名＋篇名＋行**、**swjz＝字**、**hydzd／swjzz＝字＋例，然後是行**，
> 並「盡量做到字元級定位」。

## 1. 每庫的 anchor 規格（已定案部分打 ✅）

| 庫 | adb | work | anchor 單位 | 現況 |
|---|---|---|---|---|
| 十三經 | `jing.adb` ✅ 已建 | 13 個（yijing…mengzi，**書名用拼音**） | **篇名＝semantic segment id**（`關雎`、`堯典`、`隱公/經元年`）→ 內含 行＋字元 | ✅ 2,007 個 id；`attributes` 有 章/節/項.id |
| 說文解字注（章節版） | `swjz.adb` | `shuowen` | **字**（`w0010010`…10,706）＋字條內漢字序 | id 已在檔內 ✅；`attributes/字.id` 10,706 |
| 說文解字注（卷字版） | `swjzz.adb` | `shuowen`（同 work、另一 edition） | **字＋例** → 行 → 字元 | 字 id 與 swjz 交集應 10,706（待驗） |
| 漢語大字典 | `hydzd.adb` | 待登記 work（如 `hydzd`） | **字＋例** → 行 → 字元 | 82,280 條；`<例 t="…">` 分區已是行內標記（待抽 anchor） |

## 2. 「書名＋篇名＋行＋字元」與 spec 地址的關係（關鍵取捨）

契約地址是 `workId?anchor#a-b`，`a-b` ＝ anchor 內漢字序。作者要的 `行` 是**人可核对**的中間層，
两者不衝突，用**雙表示**：

```text
正規化地址（存 xout／給 runtime）：  shijing?關雎#a-b     a-b＝篇內漢字序（0 起、右開）
人類可核對地址（存連結表／除錯）：    毛詩 / 關雎 / 行3 / 字12-18
                                       ↑書名(adb book)  ↑篇名(anchorId)  ↑篇內行序  ↑行內漢字序
```

換算規則（`out/jing-manifest.tsv` 已提供 `line`／`textEnd`／`segBodyLines`）：

1. 篇內行序 = 該行在 `[line+1, textEnd)` 內、**排除空行與 `<頁>` 行**後的第幾個正文行（1 起）。
2. `a`（篇內漢字序）= 該篇前 (行序−1) 行的漢字總和 ＋ 行內漢字序。
3. 反向：給 `a-b` 也能算出行序＋行內偏移 → UI 可顯示「篇＼行＼字」而不只塗色。

**風險（要作者知道）**：`行` 對排版敏感。因為 jing 現在已有 `id`，我建議
**xout 只存 `anchorId + a-b`（穩定），行／字元列當作衍生的顯示欄**；
若哪天重新分行，行序會變而 anchor 不變。

## 3. 鏈接方向與 xout owner（依 00-common §1／§5）

```text
swjz  → jing      段注引經（「詩云」「書曰」「周禮」「左傳」…）
swjzz → jing      同上（同 work shuowen 的另一 edition；連結按 shuowen 存，edition 由 catalog 選）
hydzd → swjz／swjzz   字典引《說文》／段注 → shuowen?char:w…
hydzd → jing      書證引十三經原文 → work?seg
swjz ↔ hydzd     同以「字」為 key：shuowen?w… ↔ hydzd 字頭（這是最穩的一類，不需要文字比對）
```

- 反鏈一律由**引用端** own（`xout_yijing`、`xout_shuowen` 放在引用那個 adb）。
- jing／swjz 原文庫**不存反鏈**、不寫 `xin`、不建中央 xref。
- 說文三庫是同一 work `shuowen`，所以引用端只需一份 `xout_shuowen`，不要按 adb 分三份。

## 4. 源頭量測（決定工作量）

`out/swjz.xml` 去標籤後可辨識的引書線索 **2,876 次**：

```text
詩 763 | 書 454 | 說文 346 | 左傳 214 | 易 208 | 周禮 148 | 爾雅 139
周書 109 | 孟子 91 | 論語 88 | 禮記 47 | 曲禮 44 | （其分佈見 out/ 重跑可複現）
```

句式樣本（要處理「鄭注周禮曰」「毛詩言」「士虞禮記曰」這類嵌套）：

```text
詩云。旣伯旣禱。爾雅曰。旣伯旣禱。伯、馬祖也。
靈威仰也。毛詩言禘者二。曰雝、禘大祖也。
鄭注周禮曰。求福曰禱。得求曰祠。
```

## 5. 進度

| 步驟 | 產出 | 狀態 |
|---|---|---|
| 1. jing 補 id ＋ manifest ＋ 打包 | `D:\accelon3\jing.adb`（sha `d1621133eaf8`，2,325,741 B）、`out/jing-manifest.tsv` 2,007 筆 | ✅ 完成，驗收 PASS（正文未動、VA 零位移） |
| 2. swjz 引經抽取（cue → quote → 書名 → 篇名 → a-b） | `out/swjz-cites.tsv` | ⏳ 下一步 |
| 3. resolver：用 `out/jing-manifest.tsv` ＋ textHash 把 quote 落到 `work?篇名#a-b` | `out/swjz-xout_yijing.tsv`（XOUT1 records） | ⏳ 需先過 manifest gate（00-common §4：無 manifest／hash 不符 → unresolved／stale，不寫正式 xout） |
| 4. swjzz／hydzd 的「字＋例」anchor 抽取 | 各區 manifest | ✅ **cct 端已產**（未動那兩區）：swjzz 10,706＋48,257 zone；hydzd 82,280 entry＋143,044 zone，`a-b` 反解抽樣 401/401 相同。詳見 [`hydzd-linking-base.md`](hydzd-linking-base.md) |
| 5. hydzd↔shuowen 的字對字連結 | `xout_shuowen` in hydzd | ⏳ 入口已定：hydzd 的 9,562 個 `<例 t="説文">` 區（平均 11 漢字，遠低於 quote 上限） |

## 6. 需要母區／UI 配合（我只建議）

1. `jing` 的 catalog entry：`pageScheme` 用 segment 語意（不是 `page-id`）；13 個 work 的
   `editions[].adb` 指 `jing`，舊 `13j` 那筆標 legacy。
2. xout record 需允許 **衍生行欄**（或 runtime 自己由 manifest 的 line/textEnd 算）：
   這樣右欄才能顯示「毛詩·關雎 第3行」。
3. 字元級範圍 `a-b` 的渲染沿用既有 `j` 那套（母區 `page-text.ts`／`han.ts`），
   **不要新起一套漢字計數**——我這輪四庫互校時，兩端只要有一家把代理對算成 2，
   hash 就 0 命中（踩過，見 `text-hash-verification.md`）。
