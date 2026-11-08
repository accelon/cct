/**
 * build-haodoo-catalog.mjs — 抓好讀（haodoo.net 舊站）藏書清單，並對照我們的需求清單
 *
 *   bun run src/build-haodoo-catalog.mjs
 *
 * 來源：https://haodoo.net/?M=hd&P=<category>（UTF-8，一頁列整個分類）
 * 結構（實測）：<font color="CC0000">作者</font><a href="?M=book&P=CODE">【書名】</a>…
 *              讀者分享書用 ?M=Share&P=…；作者區塊以 <hr class=s> 分隔
 * 產出：
 *   data/haodoo-catalog.tsv         藏書清單（code/mode/title/author/category/src/fetch_utc）
 *   data/haodoo-vs-needs.tsv        我們的 429 種現代文學目標 × 好讀有無
 *   docs/haodoo-holdings.md         報告
 *
 * 為什麼先比「現代文學目標」：xdhycd 的書證多為 1901–1949 作品，好讀恰好收藏大量
 * 民國以降中文創作（且多為作者逝世逾 50 年的民國作家）——這正是上一輪覆蓋率缺口所在。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { foldChars, loadFold } from "./jing-anchors.ts";

const FOLD = loadFold("data/char-fold.tsv");
const n1 = (s) => foldChars([...(s || "").replace(/[^\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/g, "")], FOLD).n1;
const UA = "accelfreq-research/0.1 (private catalog build; contact: local)";
const CATS = [["100", "好讀100"], ["wisdom", "隨身智囊"], ["history", "歷史"], ["martial", "武俠"], ["mystery", "懸疑奇幻"], ["romance", "愛情"], ["scifi", "科幻"], ["fiction", "小說園地"]];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* 目錄是繁體、無簡體干擾，但保險起見兩側都過同一張 s2t 表再比（沿用 openlib→hydzd 的教訓） */
const key = (s) => n1(s).replace(/[〔【】〕《》「」『』']/g, "");

const entries = [];
for (const [p, cname] of CATS) {
  const u = `https://haodoo.net/?M=hd&P=${p}`;
  let t = "";
  try {
    const r = await fetch(u, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(60000) });
    if (!r.ok) { entries.push({ code: "", mode: "ERR", title: `HTTP ${r.status}`, author: "", cat: cname, url: u }); continue; }
    t = await r.text();
  } catch (e) { entries.push({ code: "", mode: "ERR", title: e.message, author: "", cat: cname, url: u }); continue; }
  const re = /<font\s+color="CC0000"[^>]*>([^<]{1,24})<\/font>|<a\s+href="\?(M=[A-Za-z]+&P=[A-Za-z0-9]+)">([【《][^<>]{1,60}[】》])<\/a>/g;
  let author = "";
  let n = 0;
  for (const m of t.matchAll(re)) {
    if (m[1] !== undefined) { author = m[1].trim(); continue; }
    const mode = m[2].startsWith("M=book") ? "book" : "share";
    const code = m[2].split("P=")[1];
    const title = m[3].replace(/[【】《》]/g, "").trim();
    if (!title) continue;
    entries.push({ code, mode, title, author, cat: cname, url: `https://haodoo.net/?M=book&P=${code}` });
    n++;
  }
  console.log(`${cname}（${p}）：${n} 本`);
  await sleep(1500);
}
/* 去重（同一本可能跨分類） */
const seen = new Map();
for (const e of entries) { if (e.code && !seen.has(e.code)) seen.set(e.code, e); }
const cat = [...seen.values()];

const catTsv = ["code\tmode\ttitle\tauthor\tcategory\tsrc\tfetch_utc\turl"];
for (const e of cat) catTsv.push([e.code, e.mode, e.title, e.author, e.cat, "haodoo.net", new Date().toISOString(), e.url].join("\t"));
writeFileSync("data/haodoo-catalog.tsv", catTsv.join("\n") + "\n", "utf8");

/* 對照需求清單 */
const needs = readFileSync("data/modern-target-titles.tsv", "utf8").split(/\r?\n/).filter((l) => l).slice(1).map((l) => l.split("\t"));
const byKey = new Map();
for (const e of cat) {
  const k = key(e.title);
  if (!byKey.has(k)) byKey.set(k, []);
  byKey.get(k).push(e);
}
const vsTsv = ["need_title\tneed_cites\tneed_author\tneed_status\thaodoo_hit\tcode\tmode\thaodoo_author\turl"];
let hit = 0, hitCites = 0, homo = 0;
const homos = [];
for (const nd of needs) {
  const k = key(nd[0]);
  const cands = byKey.get(k) ?? [];
  const aNeed = key(nd[2] ?? "");
  /* 書名＋作者雙條件：同形異主（同名書、別的作者）不算命中——與詞典同形字規則同一教訓 */
  const e = cands.find((x) => !aNeed || !key(x.author) || key(x.author) === aNeed || key(x.author).includes(aNeed) || aNeed.includes(key(x.author))) ?? null;
  if (cands.length && !e) { homo++; homos.push(`《${nd[0]}》（${nd[2]}）↔ 好讀同名＝${cands.map((x) => `${x.author}《${x.title}》`).join("、")}`); }
  if (e) { hit++; hitCites += Number(nd[1] ?? 0); }
  vsTsv.push([nd[0], nd[1] ?? "", nd[2] ?? "", nd[3] ?? "", e ? "有" : cands.length ? "同名異主" : "無", e?.code ?? "", e?.mode ?? "", e?.author ?? "", e?.url ?? ""].join("\t"));
}
writeFileSync("data/haodoo-vs-needs.tsv", vsTsv.join("\n") + "\n", "utf8");

const report = [
  "# 好讀（haodoo.net）藏書清單與需求對照",
  "",
  `來源：https://haodoo.net/（舊站，UTF-8），分類頁一次列整類；抓取時間 ${new Date().toISOString().slice(0, 10)}`,
  `藏書 **${cat.length.toLocaleString()} 種**（${CATS.map(([p, n]) => `${n} ${entries.filter(e=>e.cat===n&&e.code).length}`).join("／")}，未含有聲書）`,
  `我們的 429 種現代文學目標中，好讀真有 **${hit} 種**（書名＋作者雙條件），合計引文 ${hitCites.toLocaleString()} 次＝全庫 ${((hitCites / 94204) * 100).toFixed(2)}%。另有 ${homo} 種「同名異主」被擋下（${homos.slice(0,6).join("；")}）`,
  "",
  "檔案：`data/haodoo-catalog.tsv`、`data/haodoo-vs-needs.tsv`（逐標題對照）",
  "",
  "⚠ 版權提示：好讀是讀友製書分享站，站方聲明版權歸原作者／發行商；本清單僅作藏書普查，",
  "正文是否可用仍按 catalog-README 的 PD 規則逐本判斷（作者卒年＋50），不可整站搬運。",
].join("\n") + "\n";
writeFileSync("docs/haodoo-holdings.md", report, "utf8");
console.log(`藏書 ${cat.length} 種｜需求命中 ${hit} 種（${((hitCites / 94204) * 100).toFixed(2)}%）｜已寫 data/haodoo-catalog.tsv、data/haodoo-vs-needs.tsv、docs/haodoo-holdings.md`);
