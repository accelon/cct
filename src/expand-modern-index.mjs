/**
 * expand-modern-index.mjs — 展開 hold 狀態的索引頁（四世同堂 60 子頁、駱駝祥子 25 子頁）
 *
 *   bun run src/expand-modern-index.mjs [--capgb=8]
 *
 * 紀律同前：邊抓邊清洗、gzip、記 catalog（子頁另立 manifest-children.tsv，父書欄位延續）、
 * 不編號不入庫；超過磁碟上限就停在半途。子頁的 keep 旗標同一套規則，不是每個都會留。
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from "node:fs";
import { gzipSync, gunzipSync } from "node:zlib";
import { api, rawOf, clean, pdBasis, authorPd, foldKey, slug, sha16, sleep } from "./wslib.mjs";

const OUT = "D:/2026/modern";
const CAP = Number((process.argv.find((a) => a.startsWith("--capgb=")) ?? "--capgb=8").slice(8)) * 1024 ** 3;
const gz = (s) => gzipSync(Buffer.from(s, "utf8"), { level: 9 }).length;
const gun = (p) => gunzipSync(readFileSync(p)).toString("utf8");
const sizesPath = `${OUT}/_sizes.tsv`;
const dirBytes = () => readFileSync(sizesPath, "utf8").split(/\n/).filter(Boolean).reduce((s, l) => s + Number(l.split("\t")[1] || 0), 0);
const han = (s) => (s || "").replace(/[^\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/g, "");

const rows = readFileSync(`${OUT}/manifest.tsv`, "utf8").split(/\r?\n/).filter((l) => l).slice(1).map((l) => l.split("\t"));
const holds = rows.filter((r) => r[18]?.startsWith("hold"));
const childMan = ["parent_book\tparent_ws\tchild_ws\trevid@ts\tpd_basis\tauthor_page\tpd_author\terrk\twt_bytes\twt_gz_bytes\tnowiki_chars\tnowiki_gz_bytes\than_density\tkeep\tsha16_wt\tsha16_txt\tfetch_utc\turl"];
if (!existsSync(`${OUT}/manifest-children.tsv`)) writeFileSync(`${OUT}/manifest-children.tsv`, childMan.join("\t") + "\n", "utf8");

let fetched = 0, cached = 0, kept = 0, skipped = 0;
for (const r of holds) {
  const parentWs = r[0], book = r[1], author = r[2];
  const wt = gun(`${OUT}/rawgz/${slug(parentWs)}.wikitext.gz`);
  const want = foldKey(parentWs);
  const kids = [...new Set([...wt.matchAll(/\[\[([^\]|#]{2,80})(?:\|([^\]]*))?\]\]/g)].map((m) => m[1].trim())
    .filter((x) => !/^(文件|Image|File|Category|分類|Help|幫助|Special|特殊|Template|模板|Author|作者|Portal|主題)/i.test(x))
    .filter((x) => { const k = foldKey(x); return k.startsWith(want) || k === want; }))];
  console.log(`《${book}》索引頁子頁候選 ${kids.length} 個`);

  /* revid 一次問整批（省請求） */
  const rev = new Map();
  try {
    const q = await api({ action: "query", titles: kids.join("|").slice(0, 4800), prop: "revisions", rvprop: "ids|timestamp", rvlimit: 1 });
    for (const p of Object.values(q?.query?.pages ?? {})) {
      const t = p.title ?? "";
      const rv = p.revisions?.[0];
      rev.set(t, rv ? `${rv.revid}@${rv.timestamp}` : (p.missing !== undefined ? "missing" : ""));
    }
  } catch (e) { console.log(`  revid 批查失敗：${e.message}（老實標 missing）`); }

  const acache = {
    get: (p) => { const f = `${OUT}/rawgz/author__${slug(p)}.gz`; return existsSync(f) ? gun(f) : null; },
    put: (p, txt) => { const f = `${OUT}/rawgz/author__${slug(p)}.gz`; if (!existsSync(f)) { writeFileSync(f, gzipSync(Buffer.from(txt, "utf8"), { level: 9 })); appendFileSync(sizesPath, `${f}\t${gz(txt)}\n`, "utf8"); } },
  };
  const ap = await authorPd(wt, author, acache);

  for (const kid of kids) {
    if (dirBytes() > CAP) { console.log(`⛔ 達磁碟上限，停在 ${kid}`); break; }
    const cf = `${OUT}/rawgz/${slug(kid)}.wikitext.gz`;
    let wtc, fromCache = existsSync(cf);
    try {
      if (fromCache) wtc = gun(cf);
      else { wtc = await rawOf(kid); writeFileSync(cf, gzipSync(Buffer.from(wtc, "utf8"), { level: 9 })); appendFileSync(sizesPath, `${cf}\t${gz(wtc)}\n`, "utf8"); fetched++; }
    } catch (e) { childMan.push([book, parentWs, kid, rev.get(kid) ?? "", "", ap.page, ap.basis, `取原文失敗 ${e.message}`, 0, 0, 0, 0, "0%", `no(取失敗)`, "", "", new Date().toISOString(), `https://zh.wikisource.org/wiki/${encodeURIComponent(kid.replace(/ /g, "_"))}`].join("\t")); continue; }
    if (!fromCache) await sleep(700);
    const txt = clean(wtc);
    const density = txt.length ? han(txt).length / txt.length : 0;
    const isIndex = /\{\{\s*Collection[ _]?header/i.test(wtc) || (/__NOTOC__|章節目錄|目次/i.test(wtc) && wtc.length < 30000);
    const isDis = /(__DISAMBIG__|\{\{\s*(Disambig|消歧義|消歧义))/i.test(wtc);
    const keep = isDis ? "no(消歧義頁)" : isIndex ? "hold(索引頁，需展子頁)" : (density < 0.6 || han(txt).length < 800) ? "no(清洗後過短)" : "yes";
    if (keep === "yes") kept++; else skipped++;
    const g1 = gz(wtc), g2 = gz(txt);
    writeFileSync(cf, gzipSync(Buffer.from(wtc, "utf8"), { level: 9 })); if (!fromCache) appendFileSync(sizesPath, `${cf}\t${g1}\n`, "utf8");
    writeFileSync(`${OUT}/txtgz/${slug(kid)}.txt.gz`, gzipSync(Buffer.from(txt, "utf8"), { level: 9 }));
    childMan.push([book, parentWs, kid, rev.get(kid) ?? "", pdBasis(wtc) || "（未見PD模板）", ap.page || "-", ap.basis || "（無）",
      ap.err + (/\{\{\s*(傳統漢字化|传统汉字化)/i.test(wtc) ? "｜站内繁簡轉換" : ""), wtc.length, g1, txt.length, g2, (density * 100).toFixed(1) + "%",
      keep, sha16(wtc), sha16(txt), new Date().toISOString(), `https://zh.wikisource.org/wiki/${encodeURIComponent(kid.replace(/ /g, "_"))}`].join("\t"));
  }
  await sleep(800);
}
writeFileSync(`${OUT}/manifest-children.tsv`, childMan.join("\n") + "\n", "utf8");
console.log(`子頁：抓新 ${fetched}｜快取 ${cached}｜keep yes ${kept}｜非正文/過短 ${skipped}｜磁碟 ${(dirBytes() / 1024 ** 2).toFixed(1)} MB`);
