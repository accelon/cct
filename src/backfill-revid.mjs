/**
 * backfill-revid.mjs — 補 manifest-children.tsv 的 revid（一次批次查 113 標題），並抽樣驗正文
 *   bun run src/backfill-revid.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { api } from "./wslib.mjs";

const P = "D:/2026/modern/manifest-children.tsv";
const lines = readFileSync(P, "utf8").split(/\r?\n/).filter((l) => l);
const rows = lines.slice(1).map((l) => l.split("\t"));
const titles = [...new Set(rows.map((r) => r[2]))];
const rev = new Map();
/* MediaWiki 限制：rvlimit/rvprop 只能配單一頁面（多頁會回 invalidparammix，實測）→ 逐頁查 */
for (const t of titles) {
  try {
    const q = await api({ action: "query", titles: t, prop: "revisions", rvprop: "ids|timestamp", rvlimit: 1 });
    for (const p of Object.values(q?.query?.pages ?? {})) {
      const rv = p.revisions?.[0];
      rev.set(t, rv ? `${rv.revid}@${rv.timestamp}` : (p.missing !== undefined ? "missing" : ""));
    }
  } catch (e) { console.log(`revid 查詢失敗 ${t}: ${e.message}`); }
}
let filled = 0, still = 0;
for (const r of rows) {
  const v = rev.get(r[2]);
  if (v && v !== "missing") { if (r[3] !== v) filled++; r[3] = v; } else still++;
}
writeFileSync(P, lines.slice(0, 1).concat(rows.map((r) => r.join("\t"))).join("\n") + "\n", "utf8");
console.log(`revid 回填 ${filled} 筆｜仍缺 ${still}｜標題 ${titles.length} 種`);

/* 抽樣驗真：兩篇的開頭 */
for (const t of ["駱駝祥子/1", "四世同堂/1"]) {
  const p = `D:/2026/modern/txtgz/${t.replace(/[\\/:*?"<>|]/g, "_").replace(/\s+/g, "")}.txt.gz`;
  try {
    const txt = gunzipSync(readFileSync(p)).toString("utf8");
    console.log(`\n【${t}】${txt.length} 字，開頭：\n  ${txt.replace(/\n+/g, " ⏎ ").slice(0, 120)}`);
  } catch (e) { console.log(`【${t}】讀取失敗 ${e.message}`); }
}
