/**
 * analyze-xdhycd-coverage.ts — 《現代漢語大詞典》引文標題 × 我們現有庫的覆蓋率分析
 *
 *   bun run src/analyze-xdhycd-coverage.ts
 *
 * 輸入（都是別區已有的現成產物，本腳本唯讀）
 *   D:\2026\xdhycd\out\quotes\book-stats.csv   被引標題總表（含異稱、標題類型）
 *   works.tsv                                  四庫作品登記表（work_id/adb/book/title/aliases）
 *   data/openlit-titles.tsv                    openlib 657 本實際書名
 *
 * 輸出 docs/xdhycd-coverage.md
 *
 * 為什麼做這個：xdhycd 的書證主體是 20 世紀白話著作與報刊，跟 hydzd（字書韻書經史）完全不同。
 * 直接照搬「書名→章頁」的連結做法會得到一個近 0 的命中率，那對決策沒幫助。
 * 這裡先量化「接得住多少、缺哪些、補前 N 本能到幾成」，再決定要不要建連結、要不要收新庫。
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { foldChars, loadFold } from "./jing-anchors.ts";

/* 「接得住」的定義要落在實物上，不是 works.tsv 的 status（該欄是計畫狀態：
 *  Jing 標 planned 但 adb 早已建好；shiji 標 raw 且確實還沒有檔）。
 *  → 以 D:\accelon3 實際存在的 .adb 為準。 */
const HAVE = new Set(existsSync("D:/accelon3")
  ? readdirSync("D:/accelon3").filter((f) => f.endsWith(".adb")).map((f) => f.replace(/\.adb$/, ""))
  : []);

const fold = loadFold();
const n1 = (s: string) => foldChars([...s.replace(/[^\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/g, "")], fold).n1;
const SEP = /[‧··・/、，,]/;

/* minimal CSV（處理 "..." 內含逗號） */
function csvLine(l: string): string[] {
  const out: string[] = []; let cur = "", q = false;
  for (let i = 0; i < l.length; i++) {
    const c = l[i];
    if (c === '"') { if (q && l[i + 1] === '"') { cur += '"'; i++; } else q = !q; continue; }
    if (c === "," && !q) { out.push(cur); cur = ""; continue; }
    cur += c;
  }
  out.push(cur);
  return out;
}

/* ① 四庫作品登記表：任何異稱 → 所屬 adb */
const wRows = readFileSync("works.tsv", "utf8").split(/\r?\n/).filter((l) => l).map((l) => l.split("\t"));
const wHead = wRows[0];
const wIdx = { adb: wHead.indexOf("adb"), book: wHead.indexOf("book"), title: wHead.indexOf("title"), aliases: wHead.indexOf("aliases") };
const libAlias = new Map<string, { adb: string; work: string }>();
for (const r of wRows.slice(1)) {
  const names = [r[wIdx.book], r[wIdx.title], ...(r[wIdx.aliases] ?? "").split("|")].filter(Boolean);
  for (const nm of names) {
    const k = n1(nm);
    if (k && !libAlias.has(k)) libAlias.set(k, { adb: r[wIdx.adb], work: r[wIdx.book] });
  }
}

/* ② openlib 書名 */
const litRows = readFileSync("data/openlit-titles.tsv", "utf8").split(/\r?\n/).filter((l) => l).map((l) => l.split("\t"));
const litMap = new Map<string, string>();
for (const r of litRows) {
  const k = n1(r[2] ?? "");
  if (k && !litMap.has(k)) litMap.set(k, `bk${r[0]} ${r[2]}`);
}

/* ③ 逐標題分類 */
type Row = { title: string; n: number; type: string; author: string; hit: string; via: string };
const rows: Row[] = [];
{
  const lines = readFileSync("D:/2026/xdhycd/out/quotes/book-stats.csv", "utf8").split(/\r?\n/).filter((l) => l);
  const h = csvLine(lines[0]);
  const iT = h.indexOf("書名"), iN = h.indexOf("引文總次數"), iTy = h.indexOf("標題類型"), iA = h.indexOf("主要作者標記"), iAl = h.indexOf("異稱");
  for (let i = 1; i < lines.length; i++) {
    const c = csvLine(lines[i]);
    const title = (c[iT] ?? "").trim();
    if (!title) continue;
    const n = Number(c[iN] ?? 0);
    const cands: string[] = [];
    for (const nm of [title, ...(c[iAl] ?? "").split(/[|,、]/), title.split(SEP)[0]]) {
      const k = n1(nm ?? "");
      if (!k) continue;
      if (litMap.has(k)) { cands.push(`openlib:${litMap.get(k)}`); break; }
      if (libAlias.has(k)) { const v = libAlias.get(k)!; cands.push(`${v.adb}:${v.work}`); break; }
    }
    rows.push({ title, n, type: c[iTy] ?? "?", author: c[iA] ?? "", hit: cands[0] ?? "", via: cands[0] ? (n1(title) === n1(cands[0].split(":")[1] ?? "") ? "同名" : "切篇名／異稱") : "" });
  }
}

const totalCites = rows.reduce((a, r) => a + r.n, 0);
const byType = new Map<string, { n: number; t: number; hit: number; hitT: number }>();
const byLib = new Map<string, { n: number; t: number }>();
for (const r of rows) {
  const g = byType.get(r.type) ?? { n: 0, t: 0, hit: 0, hitT: 0 };
  g.n += r.n; g.t++; if (r.hit) { g.hit += r.n; g.hitT++; }
  byType.set(r.type, g);
  if (r.hit) {
    const lib = r.hit.split(":")[0];
    const q = byLib.get(lib) ?? { n: 0, t: 0 };
    q.n += r.n; q.t++; byLib.set(lib, q);
  }
}
const hitRows = rows.filter((r) => r.hit).sort((a, b) => b.n - a.n);
const missRows = rows.filter((r) => !r.hit).sort((a, b) => b.n - a.n);
const cum = [10, 20, 50, 100, 200, 400].map((k) => {
  const add = missRows.slice(0, k).reduce((a, r) => a + r.n, 0);
  return { k, add, pct: (((hitRows.reduce((a, r) => a + r.n, 0) + add) / totalCites) * 100) };
});

const md = [
  "# xdhycd（現代漢語大詞典）引文 × 現有庫 覆蓋率",
  "",
  "資料：`D:\\2026\\xdhycd\\out\\quotes\\book-stats.csv`（該區 `stat-quotes.py` 產出，本輪只讀不改）",
  "對照：`works.tsv`（四庫作品登記，含異稱）＋ `data/openlit-titles.tsv`（openlib 657 本）",
  "",
  `## 一、結論`,
  "",
  `- 被引標題 **${rows.length.toLocaleString()} 種**、引文 **${totalCites.toLocaleString()} 次**。`,
  `- 我們的庫接得住 **${hitRows.length.toLocaleString()} 種／${hitRows.reduce((a, r) => a + r.n, 0).toLocaleString()} 次＝${((hitRows.reduce((a, r) => a + r.n, 0) / totalCites) * 100).toFixed(2)}%**。`,
  `- 這印證該區 REPORT.md 的判斷：**xdhycd 不適合做「全庫引文連結」**——它的主體是 20 世紀白話著作與報刊，` +
    `不是我們手上那種可整本取得的古籍。可對接的只有傳統典籍那一小塊。`,
  "",
  "## 二、按標題類型看覆蓋",
  "",
  "| 類型 | 標題數 | 引文數 | 接得住（種） | 接得住（次） | 覆蓋率 |",
  "|---|---:|---:|---:|---:|---:|",
  ...[...byType.entries()].sort((a, b) => b[1].n - a[1].n).map(([t, g]) =>
    `| ${t} | ${g.t.toLocaleString()} | ${g.n.toLocaleString()} | ${g.hitT.toLocaleString()} | ${g.hit.toLocaleString()} | ${((g.hit / g.n) * 100).toFixed(2)}% |`),
  "",
  "## 三、接到哪裡（以 `D:\\accelon3` 實際有無 adb 檔為準）",
  "",
  "### 已建好的庫（今天就能連結）",
  "",
  "| 庫 | 種 | 次 |",
  "|---|---:|---:|",
  ...[...byLib.entries()].filter(([l]) => HAVE.has(l)).sort((a, b) => b[1].n - a[1].n)
    .map(([l, q]) => `| \`${l}\` | ${q.t.toLocaleString()} | ${q.n.toLocaleString()} |`),
  "",
  "### 只在 `works.tsv` 登記、庫尚未建成（今日接不住）",
  "",
  "| 登記名 | 種 | 次 |",
  "|---|---:|---:|",
  ...[...byLib.entries()].filter(([l]) => !HAVE.has(l)).sort((a, b) => b[1].n - a[1].n)
    .map(([l, q]) => `| \`${l}\` | ${q.t.toLocaleString()} | ${q.n.toLocaleString()} |`),
  "",
  `已建庫吃下 **${[...byLib.entries()].filter(([l]) => HAVE.has(l)).reduce((a, [, q]) => a + q.n, 0).toLocaleString()} 次**、` +
    `待建庫 **${[...byLib.entries()].filter(([l]) => !HAVE.has(l)).reduce((a, [, q]) => a + q.n, 0).toLocaleString()} 次**、` +
    `其餘 ${missRows.reduce((a, r) => a + r.n, 0).toLocaleString()} 次接不住。`,
  "",
  "## 四、接得住的前 25 個標題",
  "",
  "| # | 標題 | 引文 | 類型 | 落到 | 经由 |",
  "|---:|---|---:|---|---|---|",
  ...hitRows.slice(0, 25).map((r, i) => {
    const lib = r.hit.split(":")[0];
    return `| ${i + 1} | 《${r.title}》 | ${r.n.toLocaleString()} | ${r.type} | \`${r.hit}\`${HAVE.has(lib) ? "" : "**（未建庫）**"} | ${r.via} |`;
  }),
  "",
  "## 五、如果我們想接住更多（累積曲線）",
  "",
  "缺口全部集中在現代專書與報刊。假設「補 K 種書就把它們全收進庫」：",
  "",
  "| 再添 K 種 | 新增可連引文 | 累計覆蓋率 |",
  "|---:|---:|---:|",
  ...cum.map((c) => `| ${c.k} | +${c.add.toLocaleString()} | ${c.pct.toFixed(2)}% |`),
  "",
  `現況 ${((hitRows.reduce((a, r) => a + r.n, 0) / totalCites) * 100).toFixed(2)}% → 補前 10 種到 ${cum[0]?.pct.toFixed(2)}%、` +
    `前 50 種到 ${cum[2]?.pct.toFixed(2)}%、前 200 種到 ${cum[4]?.pct.toFixed(2)}%、前 400 種才 ${cum[5]?.pct.toFixed(2)}%。` +
    `曲線很平：要真正吃下這庫得收的是**現代文學全集級**資料源（魯迅 8,740 次橫跨 1,252 篇、郭沫若 4,661 次／885 篇）` +
    `加報刊（人民日報 998 次），不是多買幾本小說能解決的。`,
  "",
  "## 六、建議（供你決定，我不擅自做）",
  "",
  `1. **古典那一塊值得建連結，但要先知道能落到哪裡**：傳統典籍共 ${byType.get("傳統典籍")?.n.toLocaleString()} 次引文，` +
    `其中 ${byType.get("傳統典籍")?.hit.toLocaleString()} 次（${(((byType.get("傳統典籍")?.hit ?? 0) / (byType.get("傳統典籍")?.n ?? 1)) * 100).toFixed(1)}%）標題對得上登記表；` +
    `但今日真有 adb 可連的只有 ` + [...byLib.entries()].filter(([l]) => HAVE.has(l)).map(([l, q]) => `\`${l}\` ${q.n} 次`).join("／") +
    `。史記、文選、莊子、漢書、後漢書、三國志這些高頻但庫未建——那是另一筆工程預算，不是配對演算法能補的。`,
  "2. **現代那一塊先別做連結，做「選書清單」**：`book-stats.csv` 已是現成清單，" +
    `真要收現代文學，前 50 種標題是最優投資順序（含既有的可累計到 ${cum[2] ? cum[2].pct.toFixed(2) : "?"}% 覆蓋）。`,
  "3. 若只想知道「哪些書我們已經有」，本頁第三、四節即答案，不必再跑一次全庫比對。",
  "",
  "> 本腳本不改任何既有檔、不寫連結、不打包；產出只有本 md。",
  "",
].join("\n");
writeFileSync("docs/xdhycd-coverage.md", md, "utf8");
console.log(`標題 ${rows.length} 種／引文 ${totalCites.toLocaleString()} 次｜接得住 ${hitRows.length} 種 ${(hitRows.reduce((a, r) => a + r.n, 0) / totalCites * 100).toFixed(2)}%｜寫入 docs/xdhycd-coverage.md`);
