/**
 * list-short-links.mjs — 把「2–7 字精確命中」的短連結列出來给人審
 *   node src/list-short-links.mjs
 *
 * 為何要列：用戶把規則改成「<8 字只要完全命中也連」。這在證據上分兩種——
 * 稀有用語（如「阿堵」「干將」）唯一命中是有價值的；但「你的」「我們」這類
 * 高頻短語若碰巧全書只出現一次，鏈過去意義不大。這裡按引文長度分組、
 * 附上所屬書與字頭，让你自己決定要不要保留某一段。
 */
import { readFileSync, writeFileSync } from "node:fs";

const rows = readFileSync("out/openlib-cites.tsv", "utf8").split(/\r?\n/)
  .filter((l) => l.startsWith("hit\t") || l.startsWith("hit-var\t"))
  .map((l) => l.split("\t"))
  .filter((c) => Number(c[7]) < 8);
const byLen = new Map();
for (const c of rows) {
  const n = Number(c[7]);
  if (!byLen.has(n)) byLen.set(n, []);
  byLen.get(n).push(c);
}
const out = ["=== 短引文連結（<8 漢字，逐字級或 n2 級）==="];
for (const n of [...byLen.keys()].sort((a, b) => a - b)) {
  const arr = byLen.get(n);
  out.push(``, `【${n} 字】共 ${arr.length} 條`);
  for (const c of arr.slice(0, 14)) {
    out.push(`  〈${c[2]}〉《${c[4]}》→ bk${c[6]} 「${c[8]}」  @${c[9].slice(0, 26)}`);
  }
  if (arr.length > 14) out.push(`  …其餘 ${arr.length - 14} 條見 out/openlib-cites.tsv`);
}
out.push("", `合計 ${rows.length} 條（全庫連結 ${readFileSync("out/xout_hydzd.jsonl", "utf8").split("\n").filter((l) => l).length - 1} 條）`);
writeFileSync("out/short-links.txt", out.join("\n") + "\n", "utf8");
console.log(`寫入 out/short-links.txt（${rows.length} 條）`);
