/**
 * fetch-modern-pd.mjs — 甲類（作者已到期）書目的公有領域抓取＋初步清洗（不編號、不入庫）
 *
 *   node src/fetch-modern-pd.mjs [--limit=20] [--children=60] [--dry] [--out=D:/2026/modern]
 *
 * 紀律（照你这次的指示）：
 *   1. 只做「初步清洗」：去 MediaWiki 標記、並空白、分段；**不做繁簡轉換、不切章、不發 id**
 *   2. 完整記錄來源：每頁存原 wikitext、記 pageid／revid／修訂時間／PD 依據模板／SHA-256／抓取時間
 *   3. 抓不到就老實記 notfound／needs-children，不硬湊篇數
 *
 * 為什麼用 action=raw：實測 REST v1 端點對簡體標題回 404，raw 端點 200 可取（本機出網正常）。
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync, statSync, appendFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { foldChars, loadFold } from "./jing-anchors.ts";   // 走 cct 現成的 s2t 摺疊表（bun 執行）
const FOLD = loadFold("data/char-fold.tsv");

const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const LIMIT = Number(arg("limit", 12)), CHILDMAX = Number(arg("children", 60));
const DRY = process.argv.includes("--dry");
const OUT = arg("out", "D:/2026/modern").replace(/\//g, "/");
/* 你設了 20 GB 上限。這裡硬擋在 8 GB，且每本入庫前先看已用空間：
 * 超過就停在中間並記 budget-stop，不讓它把你的碟塞爆。 */
const CAP = Number(arg("capgb", 8)) * 1024 ** 3;
const dirBytes = (d) => {
  if (!existsSync(d)) return 0;
  let s = 0;
  for (const f of readFileSync(`${d}/_sizes.tsv`, "utf8").split(/\n/).filter(Boolean)) s += Number(f.split("\t")[1] || 0);
  return s;
};
const API = "https://zh.wikisource.org/w/api.php";

const UA = "accelfreq-research/0.1 (private corpus build; contact: local)";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

for (const d of ["rawgz", "txtgz"]) if (!existsSync(`${OUT}/${d}`)) mkdirSync(`${OUT}/${d}`, { recursive: true });
if (!existsSync(`${OUT}/_sizes.tsv`)) writeFileSync(`${OUT}/_sizes.tsv`, "", "utf8");


/* 標題正規化比對用（只留漢字，去空白標點） */
const han = (s) => (s || "").replace(/[^\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/g, "");
const slug = (s) => s.replace(/[\\/:*?"<>|]/g, "_").replace(/\s+/g, "").slice(0, 48);
/* 同一本書的正體／簡體頁名（茶館 vs 茶馆）碼位不同，必須先過 s2t 摺疊再比 — 我第一輪用碼位相等，
 * 害《茶館》《死水微瀾》等被判 notfound。 */
const foldKey = (s) => foldChars([...han(s || "")], FOLD).n1;

/* 站方會回 429（實測）。統一退避：429/5xx 指數等待，最多 4 次；期間放慢全局限速。 */
let paceMs = 2600;
async function get(url, asJson) {
  let lastErr = "unknown";
  for (let i = 1; i <= 4; i++) {
    try {
      const r = await fetch(url, { headers: { "User-Agent": UA, "Accept": "application/json,text/plain,*/*" }, signal: AbortSignal.timeout(60000) });
      if (r.status === 429 || r.status >= 500) {
        const wait = Math.max(paceMs, Number(r.headers.get("retry-after") || 0) * 1000) * i;
        lastErr = `HTTP ${r.status}`;
        await sleep(wait); paceMs = Math.min(paceMs + 1200, 12000);      // 被擋就整體放慢
        continue;
      }
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      paceMs = Math.max(2200, paceMs - 200);
      return asJson ? r.json() : r.text();
    } catch (e) { lastErr = e.message; await sleep(paceMs * i); }
  }
  throw new Error(lastErr);
}
const api = (params) => get(API + "?" + new URLSearchParams({ format: "json", utf8: "1", ...params }).toString(), true);
const rawOf = (title) => get(`https://zh.wikisource.org/w/index.php?` + new URLSearchParams({ title, action: "raw" }).toString(), false);

/* 標題解析：只認「汉字正規化後相等」的標題（含 redirect 落點）。
 * 為什麼不再用搜尋相似度：實測把楊朔小說《三千里江山》配到政治文章
 * 「朝鲜三千里江山一定要统一」——包含關係會被表面相似騙掉，寧可標 notfound 請人工定標題。 */
async function resolve(title) {
  const want = foldKey(title);
  const q = await api({ action: "query", titles: title, redirects: 1, prop: "info" });
  for (const p of Object.values(q?.query?.pages ?? {})) {
    if (p.missing === undefined && p.ns === 0 && foldKey(p.title) === want) return { title: p.title, pageid: p.pageid, via: p.title === title ? "exact" : "redirect", said: "" };
  }
  const s = await api({ action: "query", list: "search", srsearch: `"${title}"`, srnamespace: 0, srlimit: 10 });
  const hits = (s?.query?.search ?? []).filter((h) => foldKey(h.title) === want);
  if (hits.length) return { title: hits[0].title, pageid: hits[0].pageid, via: "search-exact", said: "" };
  const near = (s?.query?.search ?? [])[0];
  return { title: "", pageid: 0, via: "notfound", said: near ? `疑似 ${near.title}` : "無結果" };
}

/* 作者頁的 PD 依據（實測作品頁常不掛模板，模板掛在作者頁）。
 * ✅ 回查規則已獲用戶核准（2026-11-07）：正式定義見 D:\2026\modern\catalog-README.md §一。 */
async function authorPd(wt, author) {
  const m = wt.match(/\[\[\s*(Author|作者)[:：]\s*([^\]|#]{1,40})/i) || wt.match(/\{\{\s*(Author|作者)\s*\|\s*([^\}|]{1,40})/i)
    || (author && author.trim() ? [null, "Author", author.trim()] : null);
  const page = m ? `${m[1].toLowerCase() === "author" ? "Author" : "作者"}:${m[2].trim()}` : "";
  if (!page) return { page: "", basis: "", err: "無作者連結（本站模板語法未含作者欄位）" };
  const cf = `${OUT}/rawgz/author__${slug(page)}.gz`;
  try {
    let a;
    if (existsSync(cf)) a = (await import("node:zlib")).gunzipSync(readFileSync(cf)).toString("utf8");
    else { a = await rawOf(page); writeFileSync(cf, gzipSync(Buffer.from(a, "utf8"), { level: 9 })); }
    const b = [...a.matchAll(/\{\{\s*(PD[-\w]*|PubDomain\w*|PublicDomain\w*|nowcommon|作者公有|公有)/gi)].map((x) => x[1]).filter((v, i, s) => s.indexOf(v) === i).join("|");
    return { page, basis: b, err: b ? "" : "作者頁無PD模板" };
  } catch (e) { return { page, basis: "", err: `作者頁取失败 ${e.message}` }; }
}

/* 從 wikitext 抓 PD 依據模板（這是「記錄來源」的重點欄位） */
function pdBasis(t) {
  const found = new Set();
  for (const m of t.matchAll(/\{\{\s*(PD[-\w]*|PubDomain\w*|PublicDomain\w*|nowcommon|独撰)/gi)) found.add(m[1]);
  for (const m of t.matchAll(/\{\{\s*ArticleQuality[^}]*\}\}/gi)) found.add("ArticleQuality");
  return [...found].join("|");
}

/* 初步清洗：去標記、留正文、合併空白；不做任何字形轉換 */
function clean(t) {
  let s = t;
  s = s.replace(/<!--[\s\S]*?-->/g, " ");                                  // HTML 註解
  s = s.replace(/<ref[^>]*\/>/gi, "").replace(/<ref[\s\S]*?<\/ref>/gi, "");  // 腳註
  s = s.replace(/<(comment|nowiki|noinclude|includeonly)[\s\S]*?<\/\1>/gi, " ");
  s = s.replace(/\{\{[^{}]*\}\}/g, " ");                                     // 一層模板（巢狀留待下輪）
  s = s.replace(/\{\{[^{}]*\}\}/g, " ");                                     // 再剝一層
  s = s.replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, "$1");                   // 內链留顯示文字
  s = s.replace(/\[(?:https?:\/\/[^\s\]]*\s([^\]]*))?\]/g, "$1");            // 外链留顯示文字
  s = s.replace(/^[ \t]*[=!#*;&].{0,3}$/gm, " ");                            // 純表格/列表骨架
  s = s.replace(/<\/?[a-zA-Z][^>]*>/g, " ");                                 // 殘留 HTML 標籤
  s = s.replace(/[ \t\u3000]+/g, " ");
  s = s.replace(/ ?\n ?/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return s;
}

const rows = readFileSync("data/modern-target-titles.tsv", "utf8").split(/\r?\n/).filter((l) => l).slice(1)
  .map((l) => l.split("\t")).map((c) => ({ title: c[0], cites: Number(c[1]), author: c[2], status: c[3], note: c[4] }))
  .filter((r) => r.status === "PD");
const take = rows.slice(0, LIMIT);
const man = ["ws_title\tbook\tauthor\tcites\tvia\tsimilarity\tpageid\trevid@ts\tpd_basis\tauthor_page\tpd_author\terrk\twt_bytes\twt_gz_bytes\tnowiki_chars\tnowiki_gz_bytes\than_density\tchildren\tkeep\tsha256_wt16\tsha256_nowiki16\tfetch_utc\turl"];
const log = [];
let okCount = 0, needKids = 0, notfound = 0;

if (!DRY) writeFileSync(`${OUT}/manifest.tsv`, man.join("\t") + "\n", "utf8");

for (const b of take) {
  const stamp = new Date().toISOString();
  /* 離線重建：本地已有該書的 wikitext 快取時，不再打站方（重算旗標即可）。
   * 沒有快取的才走 resolve＋raw，避免為重跑目錄就對站點發三百個請求。 */
  const pre = `${OUT}/rawgz/${slug(b.title)}.wikitext.gz`;
  let r = { title: b.title, pageid: 0, via: "cache-rebuild", said: "" }, wt = "", fromCache = true;
  if (!existsSync(pre)) {
    fromCache = false;
    try { r = await resolve(b.title); } catch (e) { log.push(`${b.title}: 解析失敗 ${e.message}`); notfound++; continue; }
  }
  if (r.via === "notfound") {
    man.push([`-`, b.title, b.author, b.cites, "notfound", r.said, 0, "", "", "-", "-", "", 0, 0, 0, 0, "0%", 0, "no(找不到)", "", "", stamp, `https://zh.wikisource.org/wiki/${encodeURIComponent(b.title)}`].join("\t"));
    log.push(`✗ ${b.title}：找不到（${r.said}）`); notfound++; continue;
  }
  if (DRY) { log.push(`(dry) ${b.title} → ${r.title} via ${r.via}`); continue; }
  const cacheP = `${OUT}/rawgz/${slug(r.title)}.wikitext.gz`;
  try {
    if (existsSync(cacheP)) wt = (await import("node:zlib")).gunzipSync(readFileSync(cacheP)).toString("utf8");
    else { wt = await rawOf(r.title); await sleep(900); }
  } catch (e) { log.push(`✗ ${r.title}: 取原文失敗 ${e.message}`); continue; }
  let meta = { latestid: 0, revts: "" };
  if (!fromCache && r.pageid) {                                                  // 快取重建時不再查 revid（老實記「快取」）
    try {
      const q = await api({ action: "query", pageids: String(r.pageid), prop: "revisions", rvprop: "ids|timestamp", rvlimit: 1 });
      const pg = Object.values(q?.query?.pages ?? {})[0];
      meta = { latestid: pg?.revisions?.[0]?.revid ?? 0, revts: pg?.revisions?.[0]?.timestamp ?? "" };
    } catch { /* 記不到就留 0，下方標 revid未取得 */ }
  }
  if (dirBytes(`${OUT}`) > CAP) { log.push(`⛔ 已用 ${(dirBytes(`${OUT}`) / 1024 ** 3).toFixed(2)} GB 達上限 ${CAP / 1024 ** 3} GB，停在 ${b.title} 之前`); break; }
  const txt = clean(wt);
  const uniqKids = [...new Set([...wt.matchAll(/\[\[([^\]|#]{2,60})(?:\|([^\]]*))?\]\]/g)]
    .map((m) => m[1]).filter((x) => !/^(文件|Image|File|Category|分類|Help|幫助|Special|特殊)/i.test(x))
    .filter((x) => han(x).length >= 2))];
  /* 索引頁偵測：本站實測寫法是 `{{Collection header |title=…}}`（**中有空格**），
   * 我第一版寫死 `Collectionheader` → 18 本長篇索引全被誤標成「清洗後過短」。 */
  const isIndex = /\{\{\s*Collection[ _]?header/i.test(wt) || (/__NOTOC__|章節目錄|目次/i.test(wt) && wt.length < 30000);
  const tradConv = /\{\{\s*(傳統漢字化|传统汉字化)/i.test(wt);          // 页面经站内繁简转换，记下以明比对前提
  const isDisambig = /(__DISAMBIG__|\{\{\s*(Disambig|消歧義|消歧义))/i.test(wt);
  const ap = await authorPd(wt, b.author);
  const gz1 = gzipSync(Buffer.from(wt, "utf8"), { level: 9 });
  const gz2 = gzipSync(Buffer.from(txt, "utf8"), { level: 9 });
  const s1 = `${OUT}/rawgz/${slug(r.title)}.wikitext.gz`, s2 = `${OUT}/txtgz/${slug(r.title)}.txt.gz`;
  writeFileSync(s1, gz1); writeFileSync(s2, gz2);
  appendFileSync(`${OUT}/_sizes.tsv`, `${s1}\t${gz1.length}\n${s2}\t${gz2.length}\n`, "utf8");
  /* keep 建議：清洗後漢字密度、正文字數、是否索引頁、PD 依據有無 —— 不合格就標 no/hold，不入正式庫 */
  const density = txt.length ? han(txt).length / txt.length : 0;
  const keep = isDisambig ? "no(消歧義頁)"
    : isIndex ? "hold(索引頁，需展子頁)"
    : (density < 0.60 || han(txt).length < 800) ? "no(清洗後過短)"
    : (!pdBasis(wt) && !ap.basis) ? "ask(PD依據未見，需人工覆核)" : "yes";
  man.push([r.title, b.title, b.author, b.cites, r.via, r.said || "", r.pageid, meta.latestid ? `${meta.latestid}@${meta.revts}` : "revid未取得",
    pdBasis(wt) || "（未見PD模板）", ap.page || "-", ap.basis || "（無）", ap.err + (tradConv ? "｜站内繁簡轉換" : ""), wt.length, gz1.length, txt.length, gz2.length, (density * 100).toFixed(1) + "%",
    isIndex ? Math.min(uniqKids.length, CHILDMAX) : 0, keep,
    createHash("sha256").update(wt).digest("hex").slice(0, 16), createHash("sha256").update(txt).digest("hex").slice(0, 16), stamp,
    `https://zh.wikisource.org/wiki/${encodeURIComponent(r.title.replace(/ /g, "_"))}`].join("\t"));
  if (isIndex) { needKids++; log.push(`◇ ${b.title} → 「${r.title}」是索引頁（${wt.length} B，子頁 ${Math.min(uniqKids.length, CHILDMAX)} 個待下輪）`); }
  else { okCount++; log.push(`✓ ${b.title} → 「${r.title}」 ${wt.length} B → nowiki ${txt.length} B｜PD依據 ${pdBasis(wt) || "未見模板"}`); }
  await sleep(500);
}

if (!DRY) writeFileSync(`${OUT}/manifest.tsv`, man.join("\n") + "\n", "utf8");
writeFileSync("out/fetch-modern.log", log.join("\n") + "\n", "utf8");
console.log(`試 ${take.length} 種（甲類共 ${rows.length}）：正文 ${okCount}｜索引頁待展 ${needKids}｜找不到 ${notfound}`);
