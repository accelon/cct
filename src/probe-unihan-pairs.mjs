/**
 * probe-unihan-pairs.mjs — 查特定字對在 Unihan_Variants 裡究竟有沒有、在哪個欄位
 *   node src/probe-unihan-pairs.mjs
 * 目的：我拿「㘭/坳、槍/鎗、噯/曖」當作 n2 的招牌例子，必須先證明 Unihan 真的收了它們，
 *       否則 n2 救不回那些 miss，我不該假稱救得回。
 */
import { readFileSync, writeFileSync } from "node:fs";

const pairs = [["㘭", "坳"], ["槍", "鎗"], ["噯", "曖"], ["会", "會"], ["者", "者"], ["低", "氐"]];
const hex = (c) => "U+" + c.codePointAt(0).toString(16).toUpperCase();
const want = new Map();
for (const [a, b] of pairs) { for (const c of [a, b]) if (!want.has(hex(c))) want.set(hex(c), []); }

const FIELDS = ["kSemanticVariant", "kSpecializedSemanticVariant", "kZVariant", "kSimplifiedVariant", "kTraditionalVariant", "kEquivalenceVariant", "kISOFinalCode", "kTotalSemanticVariant"];
const out = [`查核字：${pairs.map(([a, b]) => `${hex(a)}${a}/${hex(b)}${b}`).join("  ")}`, ""];
for (const l of readFileSync("D:/2026/adb-converter/vendor/Unihan_Variants.txt", "utf8").split(/\r?\n/)) {
  const p = l.split("\t");
  if (p.length < 3 || !want.has(p[0])) continue;
  if (!FIELDS.includes(p[1])) continue;
  want.get(p[0]).push(`${p[1]} = ${p[2].slice(0, 90)}`);
}
for (const [h, recs] of want) {
  out.push(`${h}：${recs.length ? "" : "（無變體欄位記錄）"}`);
  for (const r of recs) out.push(`   ${r}`);
}
const lines = readFileSync("D:/2026/adb-converter/vendor/Unihan_Variants.txt", "utf8").split(/\r?\n/);
const fields = new Map();
for (const l of lines) { if (l.startsWith("#") || !l) continue; const f = l.split("\t")[1]; if (f) fields.set(f, (fields.get(f) ?? 0) + 1); }
out.push("", "Unihan_Variants.txt 全部欄位與筆數：", ...[...fields].sort((a, b) => b[1] - a[1]).map(([f, n]) => `  ${f}: ${n}`));
writeFileSync("out/probe-unihan-pairs.txt", out.join("\n") + "\n", "utf8");
console.log("寫入 out/probe-unihan-pairs.txt");
