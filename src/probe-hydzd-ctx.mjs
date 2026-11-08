/**
 * probe-hydzd-ctx.mjs — 探針：hydzd 書證在 xml 裡的實際形狀（決定 quote／anchorId 怎麼抽）
 *   node src/probe-hydzd-ctx.mjs
 */
import { readFileSync, writeFileSync, readdirSync } from "node:fs";

const out = [];
out.push("=== D:\\accelon3 的 adb ===");
try {
  for (const f of readdirSync("D:/accelon3").filter((x) => x.endsWith(".adb"))) {
    out.push(`  ${f}  ${(readFileSync("D:/accelon3/" + f).length / 1048576).toFixed(1)} MB`);
  }
} catch (e) { out.push("  讀不到：" + e.message); }

const xml = readFileSync("out/hydzd.xml", "utf8");
out.push("", "=== 《紅樓夢》前 3 次出現的前後文（xml 行未切，用 | 取代換行）===");
let p = -1, i = 0;
while (i < 3) {
  p = xml.indexOf("紅樓夢", p + 1);
  if (p < 0) break;
  i++;
  out.push(`--- hit ${i} @${p} ---`);
  out.push(xml.slice(Math.max(0, p - 900), p + 400).replace(/\r?\n/g, " ⏎ "));
}

out.push("", "=== hydzd.xml 前 12 行 ===");
out.push(...xml.split(/\r?\n/).slice(0, 12).map((l) => "  " + l.slice(0, 200)));

out.push("", "=== hydzd-entry.tsv 第 1 列＋隨機 4 列 ===");
const ent = readFileSync("out/hydzd-entry.tsv", "utf8").split(/\r?\n/);
out.push("  " + ent[0]);
for (const k of [1, 200, 20000, 60000]) out.push("  " + (ent[k] ?? "").slice(0, 260));

out.push("", "=== hydzd-zone.tsv 第 1 列＋4 列（含 t=義項 的）===");
const zone = readFileSync("out/hydzd-zone.tsv", "utf8").split(/\r?\n/);
out.push("  " + zone[0]);
const yi = zone.filter((l) => /\t義項\t/.test(l)).slice(1, 4);
for (const l of yi) out.push("  " + l.slice(0, 260));

writeFileSync("out/probe-hydzd-ctx.txt", out.join("\n") + "\n", "utf8");
console.log("寫入 out/probe-hydzd-ctx.txt，" + out.length + " 列");
