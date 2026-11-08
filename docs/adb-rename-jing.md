# adb 改名：`13j` → `jing`（2026-11-06，作者決定）

> 作者指示：**「13j.adb 改名為 jing，舊的就不動他，我不想 adb 名有數字在前面。」**
> 本檔記錄改名範圍、不受影響的東西、以及需要母區／引用端配合的項目。
> 我**沒有**修改、改名、刪除 `D:\accelon3\13j.adb`（2,252,537 bytes，mtime 2006/1/19）。

## 1. 已改（本區）

| 項目 | 舊 | 新 |
|---|---|---|
| 成品檔 | `D:\accelon3\13j.adb` | `D:\accelon3\jing.adb`（**尚未生成**） |
| `adb` id | `13j` | `jing` |
| adb 內 `dbname`（header） | `13j` | `jing`（母區紀律：`dbname` ＝ 檔名，反鏈／連結解析靠它找庫） |
| `works.tsv` | 13 列 `adb=13j` | 13 列 `adb=jing`（已改，其餘 agent 新增的 14 列未動） |
| builder 產物 | `out/13j.xml` 等 | 新管線用 `out/jing.xml`／`out/jing-manifest.tsv` |

`out/13j.xml`、`out/13j-*.tsv` 等 dump **保留舊名**——它們是**舊檔**的參考解包與交叉驗證輸入，
不是新成品；改名會讓 provenance 混淆。

## 2. 不受影響（刻意不改）

- **work id**：`yijing`、`shangshu`、`shijing`、`zhouli`、`yili`、`liji`、`zuozhuan`、
  `gongyang`、`guliang`、`lunyu`、`xiaojing`、`erya`、`mengzi` —— 引用身份本來就不是 adb 名。
- **`<書 id>`**：周易…孟子 13 個 book id（`editions[].book` 用它，不是 adb 名）。
- **anchor 文法與 id**：`yijing?乾#a-b`、`shijing?關雎`、`zhouli?卝人`、`zuozhuan?隱公/經元年` 全部不變。
- **正文標記**：`<集>十三經</集>`、`<書>`、`<章>`／`<節>`／`<項>` 的顯示文字。
- **舊 `13j.adb` 本身**：原封不動，當成 legacy 載體留著。

對外地址寫成 `jing?…` 的情況只有一種：舊式「用 adb 名當引用目標」的寫法（spec 已定義為
不推薦）。新連結一律 `workId?anchor#a-b`，所以 `jing` 這個名字不進任何引用地址。

## 3. 需要母區／引用端配合（我不動 `D:\2026\adb-converter`，逐條供採納）

1. **catalog（母區 generator 產出，我只提變更建議）**
   - `books`：新增 `{ id: "jing", adb: "jing.adb", title: "十三經", aliases: ["十三經","十三經注疏"], kind: "text", status: "wip|ready" }`。
   - `works[].editions[].adb`：13 個 work 由 `13j` → `jing`。
   - **`pageScheme` 要一併改**：現行 `13j` 那筆寫的是 `"page-id"`，但作者已定案 13j 不用 page
     作 anchor，且本區實測 `頁.n` 每書都是 `1..N`、跨書重複。建議 `jing` 用
     `pageScheme: "semantic-segment"`（或母區現有字串慣例中代表 segment 的那個值），
     否則 runtime 會照 page 去解析而繞過 manifest。
   - 舊 `13j` 那筆 `books`／`editions`：建議 **保留但標為 legacy**（例如 `status: "legacy"`
     或從 `works.editions` 移出、只在 `books` 留檔），避免 resolver 在兩庫都安裝時
     随机選到舊載體（同一 work 的多個 ready edition 需要明確的優先順序）。
2. **logo 檔名**：母區 `logo.ts` 只認 `<dbname>_logo.*` → 新庫要 `jin_logo.png`，
   不然 logo 不會出現（`13j.adb` 的 resources 本來是空的，所以這是新增資源，要作者提供或沿用）。
3. **發布**：`adb-notes.json`、`make-adb-manifest`、`publish-adb`、官網 `adb/<id>.html`
   一律由母區執行；本區只交 `jing.adb`＋sha256＋大小＋說明。新名字代表**新上架一條**，
   舊 `13j` 頁面是否下架由母區決定（不要自動 404 掉还在被舊 adb 用的說明頁）。
4. **引用端（gycd）**：`accepted.tsv` 有 **61,562 筆** `target_edition="13j"`。
   依契約解析走 `target_work`，所以**不會斷鏈**；但 header 的 `targetEdition`／
   `manifestHash` 是版本比對依據，建議 gycd 重算成 `jing`（或留空、只靠 work＋textHash），
   否則每條都會被判成「版本不符 → stale」。
5. **仍然不可作為來源**：`D:\2026\adb-converter\13j-rev3.adb`（實測 12 處字被替換成「甲」）。

## 4. 命名紀律（本輪新增，記在這裡因為我不能改母區契約）

**adb 檔名／dbname 不以任何數字開頭。** 既有库里 `9999`（yulinpo 舊 dbname）就是反面例子
——`old-adb-upgrade-skill` §3 的教訓正是「dbname 沒改成檔名，反鏈找不到來源庫」。
後接的 14 部書（`shiji`、`hanshu`、`wenxuan`、`zhuangzi`、`laozi`…）都已經符合，
說文三庫（`swjz`、`swjzz`、`swjzzp`）也符合。

## 5. 現在能往下做的

`build-13j.ts` 的輸出目標改成 `jing`：

```text
① out/13j.xml（舊檔參考解包，已有）
② 只插 id（2,007 個語意節點；bare 1,004／加一層祖先 1,003／缺陷 0）
③ 缺字修正走 data/quezi-fix.tsv 的條件式套用（行號＋原標籤＋前後文）
④ authorAdb({ dbname: "jing", dbcname: "十三經", dbtype: 0,
              validTags: 舊 17 個, cachedTags: 書 章 節 項 集,
              dualIndexSelfClosing: 'nonskip', resources: jin_logo.png })
⑤ 產 out/jing-manifest.tsv（含 textHash＝§4.4 那套）→ 驗證 → 再談複製到 D:\accelon3\jing.adb
```
