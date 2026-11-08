/**
 * fetch-haodoo-archive.mjs — 好讀（www.haodoo.net）全站保存爬蟲
 *
 *   bun run src/fetch-haodoo-archive.mjs <stage>
 *   stage: site | inventory | books | parse | epub | all   （預設 all）
 *
 * 目的：把周劍輝博士創辦的好讀網站完整留存在本機，供語料分析與紀念保存。
 * 全部檔案只寫入 raw/haodoo/，不發布、不上傳、不進版控。
 *
 * 設計紀律
 *  - 可斷點續抓：已存在且有效的檔案直接跳過；任何一階段都可單獨重跑。
 *  - 節流（溫柔模式）：單執行緒、每個請求間隔 1.2–2.0s（含隨機抖動）、
 *    每 150 個請求休息 30 秒，遇 429/503/403 依 Retry-After 退避並永久降速。
 *    可用環境變數 HAODOO_MAX_REQUESTS 限制單次跑的請求數，隨時可中斷、可續抓。
 *    （這是志工維護的小站，寧可慢，不要觸發防護。）
 *  - 可追溯：每個檔案留 url / sha256 / bytes / ETag / Last-Modified / fetch_utc。
 *  - 不下載音訊檔、不下載重複的直式版／pdb／prc／mobi；這些網址記在 formats.tsv，
 *    需要時可用 --extra 另行處理。
 *
 * 格式決策（2026-11-07 實測）：同一本書比對 updb／epub／prc 後，只保存**一種**。
 *   updb = 好讀原生 PDB（type BOOK / creator MTIU），record 是未壓縮 UTF-16LE，
 *          一筆一章，含目錄、校書記略、版次，保留直式標點（︽︾﹁﹂︱︱）。
 *   與 epub 內文相似度 0.96，差異僅在標點與 epub 重複的章名；epub 只作備援。
 *   下載代碼一律取書頁按鈕（例如 14W6 是 H14W6，不是 A14W6），不可自行推導。
 *
 * 輸出（相對於 raw/haodoo/）
 *   html/site/*.html          站內說明頁、分類頁
 *   html/books/*.html         每一種書的書頁
 *   files/*.<ext>             每本書唯一保存的一種格式（updb 優先）
 *   text/pages/*.txt          書頁／站內頁的主文純文字
 *   manifest/site-pages.tsv
 *   manifest/inventory.tsv    書頁清冊（catalog ＋ 站內頁面發現的連結聯集）
 *   manifest/book-pages.tsv
 *   manifest/books.tsv        書頁解析結果（書名、作者、格式、日期、簡介、校註、選定格式）
 *   manifest/formats.tsv      所有下載鈕對應的真實網址（只記錄，不下載）
 *   manifest/files.tsv        實際下載檔與校驗
 *   manifest/failures.tsv
 *
 * 來源：data/haodoo-catalog.tsv（4,090 種，2026-11-07 普查）
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";

const BASE = "https://www.haodoo.net/";
const ROOT = "raw/haodoo";
const DIR = {
  site: join(ROOT, "html/site"),
  books: join(ROOT, "html/books"),
  epub: join(ROOT, "epub"),
  files: join(ROOT, "files"),          // 每本書「唯一」保存的一種格式（updb 優先）
  pageText: join(ROOT, "text/pages"),
  manifest: join(ROOT, "manifest"),
};
for (const d of Object.values(DIR)) mkdirSync(d, { recursive: true });

const UA = "cct-haodoo-archive/0.2 (personal memorial archive; single-threaded low-rate; +https://www.haodoo.net/)";
const BASE_DELAY = 1200;                 // ms，兩請求之間的基本間隔
const JITTER = 800;                      // ms，額外隨機抖動 0..800
const CONCURRENCY = 1;                   // 絕不併發
const COOLDOWN_EVERY = 150;              // 每 N 個請求
const COOLDOWN_MS = 30000;               // 休息 30 秒
const MAX_REQUESTS = Number(process.env.HAODOO_MAX_REQUESTS || 0) || Infinity;
let reqCount = 0, penaltyMs = 0, budgetExceeded = false;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha256 = (b) => createHash("sha256").update(b).digest("hex");
const now = () => new Date().toISOString();
const tsv = (header, rows) => [header.join("\t"), ...rows.map((r) => r.map((v) => String(v ?? "").replace(/[\t\r\n]+/g, " ").trim()).join("\t"))].join("\n") + "\n";

/* ---------- 溫柔節流：單執行緒＋抖動＋定期休息＋遇防護自動降速 ---------- */
let nextAt = 0;
async function throttle() {
  if (budgetExceeded || reqCount >= MAX_REQUESTS) {
    budgetExceeded = true;
    throw new Error("__BUDGET__ 已達單次請求上限，其餘留待下次續抓");
  }
  const wait = Math.max(0, nextAt - Date.now());
  if (wait) await sleep(wait);
  reqCount++;
  nextAt = Date.now() + BASE_DELAY + penaltyMs + Math.floor(Math.random() * JITTER);
  if (reqCount % COOLDOWN_EVERY === 0) {
    nextAt += COOLDOWN_MS;
    console.log(`  [禮貌休息] 已送出 ${reqCount} 個請求，暫停 ${COOLDOWN_MS / 1000}s`);
  }
}

async function get(url, { tries = 3 } = {}) {
  let err;
  for (let a = 0; a < tries; a++) {
    await throttle();                       // 預算用盡時直接丟出，不重試
    try {
      const r = await fetch(url, {
        headers: { "User-Agent": UA, "Accept-Language": "zh-TW,zh;q=0.9", Accept: "*/*" },
        signal: AbortSignal.timeout(60000),
      });
      if ([429, 503, 403].includes(r.status)) {
        const ra = Number(r.headers.get("retry-after")) || 0;
        penaltyMs = Math.min(penaltyMs + 2000, 15000);
        const wait = ra > 0 ? ra * 1000 : 60000 * (a + 1);
        console.warn(`  [退避] HTTP ${r.status} @ ${url}；永久降速 +2000ms，等待 ${wait / 1000}s`);
        await sleep(wait);
        throw new Error(`HTTP ${r.status}`);
      }
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const buf = Buffer.from(await r.arrayBuffer());
      return { buf, headers: r.headers, finalUrl: r.url };
    } catch (e) { err = e; if (a < tries - 1) await sleep(3000 * (a + 1)); }
  }
  throw err;
}

async function mapLimit(items, limit, fn) {
  let i = 0, done = 0;
  const out = new Array(items.length);
  await Promise.all(Array.from({ length: limit }, async () => {
    for (;;) {
      if (budgetExceeded) return;
      const k = i++;
      if (k >= items.length) return;
      try { out[k] = await fn(items[k], k); }
      catch (e) {
        if (String(e?.message ?? e).includes("__BUDGET__")) { budgetExceeded = true; return; }
        out[k] = { __error: String(e?.message ?? e) };
      }
      done++;
      if (done % 100 === 0) console.log(`  ... ${done}/${items.length}（累計請求 ${reqCount}）`);
    }
  }));
  return out;
}

const fail = [];
const noteFail = (stage, id, url, msg) => { fail.push([stage, id, url, String(msg).slice(0, 200)]); };
/* 清冊採累加寫入：單次請求上限／中途停止時，前幾輪已抓到的紀錄不會被覆蓋掉。 */
function mergeTsv(name, header, rows, keyFn = (r) => r[0]) {
  const path = join(DIR.manifest, name);
  const map = new Map();
  if (existsSync(path)) for (const l of readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean).slice(1)) {
    const c = l.split("\t");
    if (c.length > 1) map.set(keyFn(c), c);
  }
  for (const r of rows) map.set(keyFn(r), r);
  writeFileSync(path, tsv(header, [...map.values()]), "utf8");
}
const writeFailures = () => mergeTsv("failures.tsv", ["stage", "id", "url", "error"], fail, (r) => r[0] + "|" + r[1] + "|" + r[2]);

/* ---------- URL / 檔名 ---------- */
const SITE_SEEDS = [
  ["", "index"],
  ["M=hd&P=welcome", "hd__welcome"],
  ["M=hd&P=about", "hd__about"],
  ["M=hd&P=newcomer", "hd__newcomer"],
  ["M=hd&P=help", "hd__help"],
  ["M=hd&P=help-read", "hd__help-read"],
  ["M=hd&P=pr", "hd__pr"],
  ["M=hd&P=prlist3", "hd__prlist3"],
  ["M=hd&P=update2017", "hd__update2017"],
  ["M=hd&P=mb", "hd__mb"],
  ["M=hd&P=together", "hd__together"],
  ["M=hd&P=donate", "hd__donate"],
  ["M=hd&P=letters", "hd__letters"],
  ["M=hd&P=update2025", "hd__update2025"],
  ["M=hd&P=100", "hd__100"],
  ["M=hd&P=wisdom", "hd__wisdom"],
  ["M=hd&P=history", "hd__history"],
  ["M=hd&P=martial", "hd__martial"],
  ["M=hd&P=mystery", "hd__mystery"],
  ["M=hd&P=romance", "hd__romance"],
  ["M=hd&P=scifi", "hd__scifi"],
  ["M=hd&P=fiction", "hd__fiction"],
  ["M=hd&P=audio", "hd__audio"],
  ["M=mail&P=contact", "mail__contact"],
  ["M=mail&P=letter", "mail__letter"],
  ["M=mail&P=jiann", "mail__jiann"],
  ["M=hhd&P=contact", "hhd__contact"],
  ["M=lui&P=contact", "lui__contact"],
  ["M=hj&P=contact", "hj__contact"],
  ["M=yulin&P=contact", "yulin__contact"],
  ["M=foch&P=contact", "foch__contact"],
  ["M=ken&P=contact", "ken__contact"],
  ["M=liao&P=contact", "liao__contact"],
  ["M=marina&P=contact", "marina__contact"],
  ["M=hwarong&P=contact", "hwarong__contact"],
  ["M=long&P=contact", "long__contact"],
  ["M=kuan&P=contact", "kuan__contact"],
  ["M=anna&P=contact", "anna__contact"],
  ["M=ting&P=contact", "ting__contact"],
  ["M=guru&P=contact", "guru__contact"],
];
const BOOK_MODES = new Set(["book", "Share", "share"]);
const SITE_MODULES = new Set(["hd", "mail"]);   // 只跟這兩類說明頁，不追作者模組的 P 值
const MAX_SITE_PAGES = 300;                      // 站內頁面上限，避免 BFS 無限擴張
const siteSlug = (q) => SITE_SEEDS.find(([s]) => s === q)?.[1]
  ?? ((q.match(/[?&]M=([^&]+)/)?.[1] ?? "x") + "__" + (q.match(/[?&]P=([^&]+)/)?.[1] ?? q))
    .replace(/[^A-Za-z0-9_=-]+/g, "_").slice(0, 90);
const bookId = (mode, code) => `${mode}__${code}`;

/* 解析頁面上的 ?M=...&P=... 連結 */
function linksIn(html) {
  const found = new Map();
  for (const m of html.matchAll(/(?:href|action)=["']?\?([MU]=)?([A-Za-z]+)&P=([A-Za-z0-9_-]+)["'\s>]/gi)) {
    const mode = m[2], code = m[3];
    const q = `M=${mode}&P=${code}`;
    if (!found.has(q)) found.set(q, { mode, code, q });
  }
  return [...found.values()];
}

function mainRegion(html) {
  const a = html.indexOf("Main content - Include html file here");
  const start = a > 0 ? html.indexOf("-->", a) + 3 : 0;
  /* 站方模板：主文結束後緊接 `<!-- </table> -->`，再來才是共用頁尾（贊助訊息＋讀者來信）。
     不能用 class="a03"，主文自己也有 <div class="a03">。 */
  let end = html.length;
  for (const f of ["<!-- </table> -->", "好讀第25年了", "寫信給黃河"]) {
    const i = html.indexOf(f, start + 100);
    if (i > 0) end = Math.min(end, i);
  }
  const region = html.slice(start, end);
  return region.length > 100 ? region : html;
}

const ENT = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", ldquo: "「", rdquo: "」", mdash: "—", hellip: "…" };
function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|tr|td|li|h[1-6]|font)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (s, k) => {
      if (k[0] === "#") { const n = k[1] === "x" || k[1] === "X" ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10); return Number.isFinite(n) ? String.fromCodePoint(n) : s; }
      return ENT[k.toLowerCase()] ?? s;
    })
    .replace(/\r/g, "")
    .replace(/[ \t\u3000]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/* ---------- Stage 1: 站內頁面 ---------- */
async function stageSite() {
  console.log("[site] 站內頁面");
  const seen = new Map();
  for (const [q] of SITE_SEEDS) seen.set(q, 0);
  const rows = [];
  for (let depth = 0; depth <= 1; depth++) {
    const todo = [...seen].filter(([, d]) => d === depth).map(([q]) => q).slice(0, MAX_SITE_PAGES);
    if (!todo.length) break;
    const res = await mapLimit(todo, CONCURRENCY, async (q) => {
      const url = BASE + (q ? "?" + q : "");
      const file = join(DIR.site, siteSlug(q) + ".html");
      let buf;
      if (existsSync(file) && statSync(file).size > 1000) buf = readFileSync(file);
      else {
        const r = await get(url);
        if (r.buf.length < 200) throw new Error("回應過小，疑似錯誤頁");
        writeFileSync(file, r.buf);
        buf = r.buf;
      }
      return { q, url, file, bytes: buf.length, sha: sha256(buf), links: linksIn(buf.toString("utf8")) };
    });
    for (let i = 0; i < res.length; i++) {
      const r = res[i];
      if (!r || r.__error) { noteFail("site", todo[i], BASE + (todo[i] ? "?" + todo[i] : ""), r?.__error ?? "no result"); continue; }
      rows.push(r);
      if (depth < 1) for (const l of r.links) {
        if (SITE_MODULES.has(l.mode) && !seen.has(l.q) && seen.size < MAX_SITE_PAGES) seen.set(l.q, depth + 1);
      }
    }
  }
  /* 統一寫一次 site-pages.tsv：以磁碟上實際存在的 HTML 為準（含先前幾輪抓到的頁面），
     這樣即使 BFS 上限調小，也不會把已保存的頁面從清冊裡弄丟。 */
  const all = [];
  const slugToQ = new Map();
  for (const q of seen.keys()) { const s = siteSlug(q); if (!slugToQ.has(s)) slugToQ.set(s, q); }
  for (const f of readdirSync(DIR.site).filter((x) => x.endsWith(".html")).sort()) {
    const b = readFileSync(join(DIR.site, f));
    const q = slugToQ.get(f.replace(/\.html$/, "")) ?? "";
    all.push([q, q ? BASE + "?" + q : "", join(DIR.site, f), b.length, sha256(b), now()]);
  }
  writeFileSync(join(DIR.manifest, "site-pages.tsv"), tsv(["query", "url", "file", "bytes", "sha256", "fetch_utc"], all), "utf8");
  console.log(`[site] 站內頁面 ${all.length} 個，失敗 ${fail.filter((f) => f[0] === "site").length}`);
}

/* ---------- Stage 2: 書頁清冊 ---------- */
function stageInventory() {
  console.log("[inventory] 合併目錄與站內發現的書頁連結");
  const inv = new Map();
  const cat = readFileSync("data/haodoo-catalog.tsv", "utf8").split(/\r?\n/).filter(Boolean).slice(1);
  for (const l of cat) {
    const c = l.split("\t");
    const [code, mode, title, author, category] = c;
    if (!code) continue;
    inv.set(`${mode}:${code}`, { mode, code, title, author, category, origin: "catalog", url: `?M=${mode}&P=${code}` });
  }
  let discovered = 0;
  for (const f of readdirSync(DIR.site)) {
    if (!f.endsWith(".html")) continue;
    for (const l of linksIn(readFileSync(join(DIR.site, f), "utf8"))) {
      if (!BOOK_MODES.has(l.mode)) continue;
      const mode = l.mode === "book" ? "book" : "share";
      const k = `${mode}:${l.code}`;
      if (!inv.has(k)) { discovered++; inv.set(k, { mode, code: l.code, title: "", author: "", category: "", origin: "discovered", url: `?M=${l.mode}&P=${l.code}` }); }
    }
  }
  const rows = [...inv.values()].map((e) => [e.mode, e.code, e.title, e.author, e.category, e.origin, BASE + e.url]);
  writeFileSync(join(DIR.manifest, "inventory.tsv"), tsv(["mode", "code", "title", "author", "category", "origin", "url"], rows), "utf8");
  console.log(`[inventory] 共 ${rows.length} 種（目錄 ${rows.length - discovered} ＋ 新發現 ${discovered}）`);
  return rows;
}

/* ---------- Stage 3: 下載所有書頁 ---------- */
async function stageBooks() {
  const inv = readFileSync(join(DIR.manifest, "inventory.tsv"), "utf8").split(/\r?\n/).filter(Boolean).slice(1).map((l) => l.split("\t"));
  console.log(`[books] 下載 ${inv.length} 個書頁`);
  const res = await mapLimit(inv, CONCURRENCY, async (c) => {
    const [mode, code, , , , , rawUrl] = c;
    // 站方只認大寫 M=Share（小寫會回 400 "Invalid module."）；站內發現的連結還可能是相對網址。
    const url = (rawUrl.startsWith("?") ? BASE + rawUrl : rawUrl)
      .replace(/([?&]M=)share(?=&)/i, "$1Share");
    const id = bookId(mode, code);
    const file = join(DIR.books, id + ".html");
    if (existsSync(file) && statSync(file).size > 1000) return [id, url, file, statSync(file).size, sha256(readFileSync(file)), "cached", now()];
    const r = await get(url);
    if (r.buf.length < 500) throw new Error(`回應過小 ${r.buf.length}`);
    writeFileSync(file, r.buf);
    return [id, url, file, r.buf.length, sha256(r.buf), "fetched", now()];
  });
  const good = res.filter((r) => r && !r.__error);
  for (let i = 0; i < res.length; i++) {
    if (res[i] === undefined) continue;               // 預算用盡，尚未處理 → 下次續抓
    if (!res[i] || res[i].__error) noteFail("books", bookId(inv[i][0], inv[i][1]), inv[i][6], res[i]?.__error ?? "no result");
  }
  mergeTsv("book-pages.tsv", ["id", "url", "file", "bytes", "sha256", "status", "fetch_utc"], good);
  console.log(`[books] 成功 ${good.length}／${inv.length}`);
}

/* ---------- Stage 4: 解析書頁 ---------- */
function parseBookPage(html, meta) {
  const [mode, code, title, author, category, , url] = meta;
  const setTitle = (html.match(/SetTitle\("([^"]*)"\)/) || [])[1] ?? "";
  const headAuthor = (html.match(/<font color="CC0000">([^<]{1,30})<\/font>/) || [])[1] ?? "";
  const region = mainRegion(html);
  const text = htmlToText(region);

  const buttons = [];
  const re = /<input[^>]*value="(?:下載|線上閱讀)\s*([^"]*?)\s*檔?"[^>]*?(?:onClick|onclick)\s*=\s*"?\s*(Download\w+|ReadOnline)\('([^']+)'\)[^>]*>\s*(?:<font[^>]*>([^<]*)<\/font>)?/gi;
  for (const m of html.matchAll(re)) {
    const label = (m[1] ?? "").trim() || (m[2] === "ReadOnline" ? "線上閱讀" : "");
    buttons.push({ label, fn: m[2], code: m[3], meta: (m[4] ?? "").trim() });
  }
  /* 有些頁面按鈕寫法略有不同，補一輪寬鬆比對（只抓 Download*） */
  const loose = /value="下載\s*([^"]+?)\s*檔"[^>]*?(Download\w+)\('([^']+)'\)[^>]*>\s*<font[^>]*>([^<]*)</gi;
  const have = new Set(buttons.map((b) => b.code + b.fn));
  for (const m of html.matchAll(loose)) if (!have.has(m[3] + m[2])) buttons.push({ label: m[1].trim(), fn: m[2], code: m[3], meta: m[4].trim() });

  const fmtUrl = (fn, c) => {
    const ext = ({ DownloadUpdb: "updb", DownloadEpub: "epub", DownloadVEpub: "epub", DownloadPdb: "pdb", DownloadPrc: "prc", DownloadMobi: "mobi", DownloadPdf: "zip", DownloadMP3: "mp3", DownloadAudio: "mp3" })[fn];
    if (!ext || !c || c.length < 2) return "";
    if (/MP3|Audio/.test(fn)) return BASE + "MP3/" + c + "." + ext;
    return BASE + "PDB/" + c[0] + "/" + c.slice(1) + "." + ext;
  };
  const pick = (fn) => buttons.find((b) => b.fn === fn) ?? null;
  const epub = pick("DownloadEpub"), vepub = pick("DownloadVEpub"), updb = pick("DownloadUpdb");
  const made = (epub?.meta.match(/\d{4}\/\d{1,2}\/\d{1,2}/) || updb?.meta.match(/\d{4}\/\d{1,2}\/\d{1,2}/) || [])[0] ?? "";
  const sizeKb = (epub?.meta.match(/\((\d+)K\)/) || [])[1] ?? "";

  /* 每本只保存一種格式。好讀原生 updb 是未壓縮 UTF-16LE 的 PDB（BOOK/MTIU），
     一筆 record 一章，含目錄／校書記略／版次，比轉出的 epub 更接近周劍輝原稿；
     epub 只當沒有 updb 時的備援，其餘格式完全不下載。 */
  const priority = [
    ["updb", "DownloadUpdb"], ["epub", "DownloadEpub"],
    ["pdb", "DownloadPdb"], ["prc", "DownloadPrc"], ["mobi", "DownloadMobi"],
  ];
  const chosen = priority.map(([ext, fn]) => ({ ext, fn, b: pick(fn) })).find((x) => x.b) ?? null;
  const primaryUrl = chosen ? fmtUrl(chosen.fn, chosen.b.code) : "";

  return {
    row: [mode, code, title, setTitle, author, headAuthor, category, url,
      buttons.filter((b) => b.fn !== "ReadOnline").map((b) => b.label).join("|"),
      epub?.code ?? "", vepub?.code ?? "", fmtUrl("DownloadEpub", epub?.code),
      sizeKb, made, buttons.filter((b) => b.fn !== "ReadOnline").map((b) => `${b.label}:${b.meta}`).join(" ; "),
      text.slice(0, 300).replace(/\n/g, " "), text.length,
      updb?.code ?? "", chosen?.ext ?? "", chosen?.b.code ?? "", primaryUrl],
    buttons, fmtUrl, text, id: bookId(mode, code), region,
  };
}

function stageParse() {
  /* 站內頁面的主文純文字（含說明頁、勘誤表、讀者來信、周劍輝紀念頁） */
  const siteFiles = readdirSync(DIR.site).filter((f) => f.endsWith(".html"));
  for (const f of siteFiles) {
    const html = readFileSync(join(DIR.site, f), "utf8");
    writeFileSync(join(DIR.pageText, "site__" + f.replace(/\.html$/, "") + ".txt"), htmlToText(mainRegion(html)), "utf8");
  }
  const inv = new Map(readFileSync(join(DIR.manifest, "inventory.tsv"), "utf8").split(/\r?\n/).filter(Boolean).slice(1)
    .map((l) => { const c = l.split("\t"); return [`${c[0]}__${c[1]}`, c]; }));
  const files = readdirSync(DIR.books).filter((f) => f.endsWith(".html"));
  console.log(`[parse] 解析 ${files.length} 個書頁`);
  const rows = [], fmtRows = [];
  for (const f of files) {
    const id = f.replace(/\.html$/, "");
    const meta = inv.get(id) ?? ["", id.split("__")[1] ?? "", "", "", "", "", ""];
    const html = readFileSync(join(DIR.books, f), "utf8");
    const p = parseBookPage(html, meta);
    rows.push(p.row);
    writeFileSync(join(DIR.pageText, id + ".txt"), p.text, "utf8");
    for (const b of p.buttons) if (b.fn !== "ReadOnline") {
      fmtRows.push([id, b.label, b.fn, b.code, p.fmtUrl(b.fn, b.code), b.meta, "", now()]);
    }
  }
  writeFileSync(join(DIR.manifest, "books.tsv"), tsv(
    ["mode", "code", "title", "set_title", "author", "head_author", "category", "url", "formats", "epub_code", "vepub_code", "epub_url", "epub_kb", "made", "format_meta", "note_head", "main_text_chars", "updb_code", "primary_ext", "primary_code", "primary_url"], rows), "utf8");
  writeFileSync(join(DIR.manifest, "formats.tsv"), tsv(
    ["id", "label", "fn", "file_code", "url", "page_meta", "downloaded", "fetch_utc"], fmtRows), "utf8");
  const tally = {};
  for (const r of rows) tally[r[18] || "無"] = (tally[r[18] || "無"] ?? 0) + 1;
  console.log(`[parse] ${rows.length} 本；選定格式 ${JSON.stringify(tally)}；格式連結 ${fmtRows.length} 筆（只記網址，不下載）`);
}

/* ---------- Stage 5: 每本只抓一種格式（updb 優先，epub 備援） ---------- */
function readManifest(name) {
  const lines = readFileSync(join(DIR.manifest, name), "utf8").split(/\r?\n/).filter(Boolean);
  const head = lines[0].split("\t");
  return lines.slice(1).map((l) => {
    const c = l.split("\t"); const o = {};
    head.forEach((h, i) => { o[h] = c[i] ?? ""; });
    return o;
  });
}

async function stageFiles() {
  const books = readManifest("books.tsv").filter((b) => b.primary_url);
  console.log(`[files] 每本一種格式，共 ${books.length} 本`);
  const valid = (ext, b) => {
    if (!b || b.length < 1000) return false;
    if (ext === "epub" || ext === "zip") return b[0] === 0x50 && b[1] === 0x4b;
    return b.subarray(60, 64).toString("latin1") === "BOOK";   // PDB 容器（updb/pdb/prc/mobi）
  };
  const res = await mapLimit(books, CONCURRENCY, async (b) => {
    const id = bookId(b.mode, b.code), ext = b.primary_ext;
    const file = join(DIR.files, `${id}.${ext}`);
    let buf, headers = null, status = "cached";
    if (existsSync(file) && valid(ext, readFileSync(file))) buf = readFileSync(file);
    else {
      const r = await get(b.primary_url);
      if (!valid(ext, r.buf)) throw new Error(`不是有效的 ${ext}（${r.buf.length} bytes, ${r.buf.subarray(0, 16).toString("utf8")}）`);
      writeFileSync(file, r.buf);
      buf = r.buf; headers = r.headers; status = "fetched";
    }
    return [id, b.title, b.author, ext, b.primary_url, file, buf.length, sha256(buf),
      headers?.get("etag") ?? "", headers?.get("last-modified") ?? "", status, now()];
  });
  const good = res.filter((r) => r && !r.__error);
  for (let i = 0; i < res.length; i++) {
    if (res[i] === undefined) continue;
    if (!res[i] || res[i].__error) noteFail("files", bookId(books[i].mode, books[i].code), books[i].primary_url, res[i]?.__error ?? "no result");
  }
  mergeTsv("files.tsv",
    ["id", "title", "author", "ext", "url", "file", "bytes", "sha256", "etag", "last_modified", "status", "fetch_utc"], good);
  const mb = good.reduce((s, r) => s + Number(r[6]), 0) / 1048576;
  console.log(`[files] 成功 ${good.length}／${books.length}，合計 ${mb.toFixed(1)} MiB`);
}

/* ---------- main ---------- */
const stage = process.argv[2] ?? "all";
const t0 = Date.now();
console.log(`[溫柔模式] 單執行緒｜間隔 ${BASE_DELAY}+0..${JITTER}ms｜每 ${COOLDOWN_EVERY} 請求休息 ${COOLDOWN_MS / 1000}s｜單次上限 ${MAX_REQUESTS === Infinity ? "無" : MAX_REQUESTS}｜遇 429/503/403 自動降速退避`);
if (stage === "site" || stage === "all") await stageSite();
if (stage === "inventory" || stage === "all") stageInventory();
if (stage === "books" || stage === "all") await stageBooks();
if (stage === "parse" || stage === "all") stageParse();
if (stage === "files" || stage === "epub" || stage === "all") await stageFiles();
writeFailures();
console.log(`完成（${stage}），耗時 ${((Date.now() - t0) / 60000).toFixed(1)} 分，本輪實際請求 ${reqCount} 個，失敗 ${fail.length} 筆 → manifest/failures.tsv`);
if (budgetExceeded) console.log("ℹ 已達單次請求上限，尚未抓完；直接再跑同一個 stage 就會續抓（已存檔自動跳過）。");
