/**
 * lit-titles.mjs — 把 openlit 的 657 個書名匯成 data/openlit-titles.tsv（id\ttitle）
 *   node src/lit-titles.mjs
 * 用途：建 hydzd 書名別名表時要照著實際書名寫，不能憑記憶（《水滸全傳》不是《水滸傳》）。
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
const rows = [];
for (const f of readdirSync("D:/2026/openlit/out").filter((x) => /^\d+\.txt$/.test(x)).sort()) {
  const t = readFileSync("D:/2026/openlit/out/" + f, "utf8").match(/<書 id="(bk\d+)"[^>]*>([\s\S]*?)<\/書>/);
  if (t) rows.push(`${f.replace(".txt", "")}\t${t[1]}\t${t[2].trim()}`);
}
writeFileSync("data/openlit-titles.tsv", rows.join("\n") + "\n", "utf8");
console.log(`data/openlit-titles.tsv：${rows.length} 本`);
