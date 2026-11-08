/**
 * wslib.mjs — 維基文庫抓取共用層（退避／raw／清洗／PD 依據／雜湊）
 * 從 fetch-modern-pd.mjs 抽出來共用；該腳本尚未改用（避免這輪動到已驗證的管線），
 * 下一輪整理時再統一。函式語意與該腳本一致，坑也都寫在註解裡：
 *   ① 標題同義必須過 s2t 摺疊（茶館 vs 茶馆 是不同碼位）
 *   ② 站方會回 429 → 指數退避並放慢全域步速
 *   ③ 索引頁模板是 `{{Collection header}}`（有空格）
 *   ④ PD 模板多掛在作者頁，作品頁常沒有
 */
import { createHash } from "node:crypto";
import { foldChars, loadFold } from "./jing-anchors.ts";

export const FOLD = loadFold("data/char-fold.tsv");
export const UA = "accelfreq-research/0.1 (private corpus build; contact: local)";
const API = "https://zh.wikisource.org/w/api.php";
let paceMs = 2400;
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const han = (s) => (s || "").replace(/[^\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/g, "");
export const foldKey = (s) => foldChars([...han(s)], FOLD).n1;
export const slug = (s) => (s || "").replace(/[\\/:*?"<>|]/g, "_").replace(/\s+/g, "").slice(0, 60);

async function get(url, asJson) {
  let lastErr = "unknown";
  for (let i = 1; i <= 5; i++) {
    try {
      const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json,text/plain,*/*" }, signal: AbortSignal.timeout(60000) });
      if (r.status === 429 || r.status >= 500) {
        const wait = Math.max(paceMs, Number(r.headers.get("retry-after") || 0) * 1000) * i;
        lastErr = `HTTP ${r.status}`; await sleep(wait); paceMs = Math.min(paceMs + 1200, 12000); continue;
      }
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      paceMs = Math.max(2200, paceMs - 200);
      return asJson ? r.json() : r.text();
    } catch (e) { lastErr = e.message; await sleep(paceMs * i); }
  }
  throw new Error(lastErr);
}
export const api = (params) => get(API + "?" + new URLSearchParams({ format: "json", utf8: "1", ...params }).toString(), true);
export const rawOf = (title) => get(`https://zh.wikisource.org/w/index.php?` + new URLSearchParams({ title, action: "raw" }).toString(), false);

export function pdBasis(t) {
  const f = new Set();
  for (const m of t.matchAll(/\{\{\s*(PD[-\w]*|PubDomain\w*|PublicDomain\w*|nowcommon|独撰|傳統漢字化|传统汉字化)/gi)) f.add(m[1]);
  return [...f].join("|");
}

export function clean(t) {
  let s = t;
  s = s.replace(/<!--[\s\S]*?-->/g, " ");
  s = s.replace(/<ref[^>]*\/>/gi, "").replace(/<ref[\s\S]*?<\/ref>/gi, "");
  s = s.replace(/<(comment|nowiki|noinclude|includeonly)[\s\S]*?<\/\1>/gi, " ");
  s = s.replace(/\{\{[^{}]*\}\}/g, " ").replace(/\{\{[^{}]*\}\}/g, " ").replace(/\{\{[^{}]*\}\}/g, " ");
  s = s.replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, "$1");
  s = s.replace(/\[(?:https?:\/\/[^\s\]]*\s([^\]]*))?\]/g, "$1");
  s = s.replace(/^[ \t]*[=!#*;&].{0,3}$/gm, " ");
  s = s.replace(/<\/?[a-zA-Z][^>]*>/g, " ");
  s = s.replace(/[ \t\u3000]+/g, " ").replace(/ ?\n ?/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return s;
}

export const sha16 = (s) => createHash("sha256").update(s).digest("hex").slice(0, 16);
/** 作者頁 PD（作品頁常不掛模板）：先找頁內 Author 連結，找不到就用字典作者欄位。
 *  ✅ 回查規則已獲用戶核准（2026-11-07），正式定義見 D:\2026\modern\catalog-README.md §一；
 *  已知限制（譯作／合集／圖版等保護期另算）也寫在那裡。
 *  cache = { get(page)→text|null, put(page, text) }，由呼叫端決定存哪（本輪存 D:\2026\modern\rawgz\author__*.gz） */
export async function authorPd(wt, author, cache) {
  const m = wt.match(/\[\[\s*(Author|作者)[:：]\s*([^\]|#]{1,40})/i) || wt.match(/\{\{\s*(Author|作者)\s*\|\s*([^\}|]{1,40})/i)
    || (author && author.trim() ? [null, "Author", author.trim()] : null);
  if (!m) return { page: "", basis: "", err: "無作者連結" };
  const page = `${/author/i.test(m[1]) ? "Author" : "作者"}:${m[2].trim()}`;
  let a = cache?.get?.(page) ?? null;
  if (a == null) { a = await rawOf(page); cache?.put?.(page, a); }
  const b = [...a.matchAll(/\{\{\s*(PD[-\w]*|PubDomain\w*|PublicDomain\w*|nowcommon|作者公有|公有)/gi)]
    .map((x) => x[1]).filter((v, i, s) => s.indexOf(v) === i).join("|");
  return { page, basis: b, err: b ? "" : "作者頁無PD模板" };
}
