/**
 * fetch-haodoo-bookpages.mjs — 查那 22 種的書頁：下載格式、檔案大小、製書／校正日期
 *
 *   bun run src/fetch-haodoo-bookpages.mjs
 *
 * 口徑：只讀頁面元資料（格式／大小／日期／說明文字），**不下載正文**。
 * 實測結構：<input value="下載 epub 檔" onClick="DownloadEpub('A437')"><font size=2> 2010-08-17 (599K) 2016/8/5</font>
 * 產出：data/haodoo-bookpages.tsv ＋ docs/haodoo-holdings.md 的「書頁明細」節
 */
import { readFileSync, writeFileSync } from "node:fs";

const UA = "accelfreq-research/0.1 (private metadata check; contact: local)";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const hits = readFileSync("data/haodoo-vs-needs.tsv", "utf8").split(/\r?\n/).filter((l) => l).slice(1)
  .map((l) => l.split("\t")).filter((c) => c[4] === "有");
console.log(`需求命中 ${hits.length} 種，逐頁查元資料`);

const rows = ["need_title\tneed_author\tcode\turl\theadline\tformats\tsizes_summary\tepub_kb\tupdb_kb\tmobi_kb\tprc_kb\tv_epub_kb\tmade\tscholar_note_bytes\tnote_head"];
const agg = { withEpub: 0, withUpdb: 0, withMobi: 0, noFormat: 0 };
let sumKb = 0;
for (const h of hits) {
  const [title, cites, author] = h;
  const code = h[5], mode = h[6];
  const url = `https://haodoo.net/?M=${mode === "share" ? "Share" : "book"}&P=${code}`;
  let t = "";
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(45000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    t = await r.text();
  } catch (e) { rows.push([title, author, code, url, `取頁失敗 ${e.message}`, "", "", "", "", "", "", "", "", "", ""].join("\t")); await sleep(1200); continue; }
  const head = (t.match(/<font size=5[^>]*>([^<]{2,60})<\/font>/) || t.match(/([^\n<>]{1,20}《[^<>]{1,40}》)/) || [])[1] || "";
  const fmts = [...t.matchAll(/value="下載\s*([^"]+?)\s*檔"[^>]*Download\w*\('([A-Z0-9]+)'\)[^>]*><font size=2>\s*([^<]*)</g)];
  const got = [];
  const kb = { epub: "", updb: "", mobi: "", prc: "", vepub: "" };
  let made = "";
  for (const m of fmts) {
    const name = m[1].trim(), arg = m[2], meta = m[3].trim();
    got.push(name);
    const size = (meta.match(/\((\d+)K\)/) || [])[1] ?? "";
    const dates = meta.replace(/\(\d+K\)/, "").trim().split(/\s+/).filter(Boolean);
    if (size) sumKb += Number(size);
    if (/epub/.test(name) && !/直式/.test(name)) { kb.epub = size; }
    if (/直式 epub/.test(name)) { kb.vepub = size; }
    if (/updb/.test(name)) kb.updb = size;
    if (/mobi/.test(name)) kb.mobi = size;
    if (/prc/.test(name)) kb.prc = size;
    if (!made && dates[0]) made = dates[0];
  }
  if (got.includes("epub")) agg.withEpub++;
  if (got.includes("updb")) agg.withUpdb++;
  if (got.some((g) => /mobi/.test(g))) agg.withMobi++;
  if (!got.length) agg.noFormat++;
  const noteI = t.indexOf("好讀書櫃");
  const note = noteI > 0 ? (t.slice(noteI, noteI + 160).replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim()) : "";
  rows.push([title, author, code, url, head.trim(), got.join("|"), fmts.map((m) => `${m[1]}:${m[3].trim()}`).join(" ; "),
    kb.epub, kb.updb, kb.mobi, kb.prc, kb.vepub, made, "", note.slice(0, 90)].join("\t"));
  await sleep(1200);
}
writeFileSync("data/haodoo-bookpages.tsv", rows.join("\n") + "\n", "utf8");

const md = readFileSync("docs/haodoo-holdings.md", "utf8").split("\n");
const cut = md.findIndex((l) => l.startsWith("## 書頁明細"));
const add = [
  "",
  "## 書頁明細（22 種，只讀元資料、未下載正文）",
  "",
  `格式覆蓋：含 epub **${agg.withEpub}／${hits.length}**｜含 updb ${agg.withUpdb}｜含 mobi ${agg.withMobi}｜查無下載鈕 ${agg.noFormat}`,
  `單一檔案平均約 ${Math.round(sumKb / Math.max(1, hits.length))} KB（epub 多在數百 KB 級）`,
  "",
  "| 書名 | 作者 | 書號 | 可用格式 | epub 大小 | 製書日期 |",
  "|---|---|---|---|---:|---|",
  ...rows.slice(1).map((l) => {
    const c = l.split("\t");
    return `| ${c[0]} | ${c[1]} | \`${c[2]}\` | ${c[5] || "—"} | ${c[7] ? c[7] + "K" : "—"} | ${c[12] || "—"} |`;
  }),
  "",
  "下載機制：頁面是 `<input value=\"下載 epub 檔\" onClick=\"DownloadEpub('A437')\">`，",
  "檔名為 `A<code>` 型（直式版另有 `AV<code>` 前綴）；實際檔案由站方腳本送出，",
  "**是否需註冊／積點未取得**（本輪只讀頁面，未觸發下載）。",
  "",
];
writeFileSync("docs/haodoo-holdings.md", (cut > 0 ? md.slice(0, cut) : md).concat(add).join("\n") + "\n", "utf8");
console.log(`epub ${agg.withEpub}／updb ${agg.withUpdb}／mobi ${agg.withMobi}／無格式 ${agg.noFormat}｜已寫 data/haodoo-bookpages.tsv 與 docs/haodoo-holdings.md`);
