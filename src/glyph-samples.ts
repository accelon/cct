/**
 * glyph-samples.ts — 把可疑字頭的原始 XML 行抓出來（輸出 UTF-8 檔，不靠終端顯示）
 *   bun run src/glyph-samples.ts
 */
import { readFileSync, writeFileSync } from "node:fs";

const lines = readFileSync("out/swjz.xml", "utf8").split("\n");
const out: string[] = [];
const say = (s = ""): void => { out.push(s); };

const buckets: Record<string, (x: number) => boolean> = {
  paren: (x) => x === 0xff08 || x === 0xff09,
  replacement: (x) => x === 0xfffd,
  ids: (x) => x >= 0x2ff0 && x <= 0x2ffb,
  compat2f: (x) => x >= 0x2f800 && x <= 0x2fa1f,
};
const found: Record<string, { id: string; line: number; raw: string; hex: string }[]> = {
  paren: [], replacement: [], ids: [], compat2f: [],
};

lines.forEach((raw, i) => {
  const m = raw.match(/<字([^>]*)>([\s\S]*?)<\/字>/);
  if (!m || !/\sid="w\d{7}"/.test(m[1])) return;
  const id = m[1].match(/id="(w\d{7})"/)![1];
  const head = m[2];
  const cp = [...head].map((c) => c.codePointAt(0)!);
  const hex = cp.map((x) => "U+" + x.toString(16).toUpperCase()).join(" ");
  for (const [k, pred] of Object.entries(buckets)) {
    if (pred(cp[0]) && found[k].length < 6) found[k].push({ id, line: i + 1, raw: raw.trim(), hex });
  }
  if (cp.length > 1 && !predsParen(cp[0]) && found.paren.length < 6 && cp.length >= 6) {
    // 多字字頭但不是括號起頭：另外記一筆
  }
});
function predsParen(x: number): boolean { return x === 0xff08 || x === 0xff09; }

for (const [k, arr] of Object.entries(found)) {
  say(`=== ${k}（${arr.length} 例）===`);
  for (const r of arr) say(`${r.id}  line ${r.line}\n  cp: ${r.hex}\n  RAW: ${r.raw.slice(0, 200)}`);
  say("");
}

// 多字字頭全清單（head 超過 1 個码點）
say("=== 字頭超過 1 個码點（全部）===");
let n = 0;
lines.forEach((raw, i) => {
  const m = raw.match(/<字([^>]*)>([\s\S]*?)<\/字>/);
  if (!m || !/\sid="w\d{7}"/.test(m[1])) return;
  if ([...m[2]].length <= 1) return;
  n++;
  if (n <= 20) say(`  ${m[1].match(/id="(w\d{7})"/)![1]} line ${i + 1}: 「${m[2]}」`);
});
say(`  合計 ${n} 條`);

writeFileSync("out/glyph-samples.txt", out.join("\n") + "\n", "utf8");
console.log(`written; multiChar=${n}`);
