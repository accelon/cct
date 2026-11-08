/**
 * probe-fold-suspects.mjs — 查 n1 摺疊表是否把字折錯（緑→氯 這類不像異體的配對）
 *   node src/probe-fold-suspects.mjs
 *
 * 為什麼要查：audit-fuzzy 的差字對是從兩邊各自過 n1/n2 之後算出來的。
 * 若表本身把「緑」折成「氯」，那 31 條就是「假差字」——連結被無谓打回第三級，
 * 而且四庫 textHash 都按同一張表算，等於 hash 也在用錯的等价類。
 */
import { readFileSync, writeFileSync } from "node:fs";

const raw = readFileSync("data/char-fold.tsv", "utf8").split(/\r?\n/);
const map = new Map();
for (const l of raw) {
  if (!l || l.startsWith("#")) continue;
  const i = l.indexOf("\t");
  if (i < 0) continue;
  map.set(l.slice(0, i), l.slice(i + 1));
}
const chars = "緑氯駡傌得嶩筯着顔顏産產閑閒槍鎗浄凈姐俓逕什麪賛録只";
const out = [`表內共 ${map.size} 條`, "", "char\tU+\t表值\t值U+\t判定"];
for (const c of chars) {
  const v = map.get(c);
  const bad = v !== undefined && v !== c;
  out.push(`${c}\tU+${c.codePointAt(0).toString(16).toUpperCase()}\t${v ?? "(不在表內)"}\t${v ? "U+" + v.codePointAt(0).toString(16).toUpperCase() : "-"}\t${bad ? "← 折到別字" : "正常"}`);
}
writeFileSync("out/probe-fold-suspects.txt", out.join("\n") + "\n", "utf8");
console.log("寫入 out/probe-fold-suspects.txt");
