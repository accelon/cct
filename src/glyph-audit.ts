/**
 * glyph-audit.ts — 用純 code point 統計字頭字形（輸出全 ASCII，終端不會騙我）
 *   bun run src/glyph-audit.ts
 *
 * 目的：swjz 的字頭到底有幾種字形、各多少、落在哪個 Unicode 區。
 */
import { readFileSync, writeFileSync } from "node:fs";

const lines = readFileSync("out/swjz.xml", "utf8").split("\n");

/** 依母區規則：一個 supplementary 字元＝1 個字（不是 2 個 code unit） */
const heads: { id: string; cp: number[]; raw: string; line: number }[] = [];
lines.forEach((raw, i) => {
  const m = raw.match(/<字([^>]*)>([\s\S]*?)<\/字>/);
  if (!m || !/\sid="w\d{7}"/.test(m[1])) return;
  const id = m[1].match(/id="(w\d{7})"/)![1];
  heads.push({ id, cp: [...m[2]].map((c) => c.codePointAt(0)!), raw: m[2], line: i + 1 });
});

const RANGES: [string, number, number][] = [
  ["CJK_UNIFIED", 0x4e00, 0x9fff],
  ["EXT_A", 0x3400, 0x4dbf],
  ["COMPAT", 0xf900, 0xfaff],
  ["EXT_B", 0x20000, 0x2a6df],
  ["EXT_C", 0x2a700, 0x2b738],
  ["EXT_D", 0x2b740, 0x2b8df],
  ["EXT_E", 0x2b8f0, 0x2ceaf],
  ["EXT_F", 0x2ceb0, 0x2ebe0],
  ["EXT_G", 0x30000, 0x3134a],
  ["PUA_BMP", 0xe000, 0xf8ff],
  ["PUA_SMP", 0xf0000, 0xffffd],
  ["IDS", 0x2ff0, 0x2ffb],
  ["FULLWIDTH_QUESTION", 0xff1f, 0xff1f],
  ["IDEOGRAPHIC_SPACE", 0x3000, 0x3000],
  ["OTHER", -1, -1],
];
const bucket = (x: number): string => {
  for (const [n, a, b] of RANGES) if (x >= a && x <= b) return n;
  return "OTHER";
};

const byBucket = new Map<string, number>();
const byCharLen = new Map<string, number>();
const otherSamples: string[] = [];
for (const h of heads) {
  const first = h.cp[0];
  const b = bucket(first);
  byBucket.set(b, (byBucket.get(b) ?? 0) + 1);
  byCharLen.set(String(h.cp.length), (byCharLen.get(String(h.cp.length)) ?? 0) + 1);
  if (b === "OTHER" && otherSamples.length < 15) otherSamples.push(`${h.id} U+${first.toString(16).toUpperCase()} len=${h.cp.length} line ${h.line}`);
}

// 「同一個字形、不同碼點」＝異體字頭群（例如 一/弌、上/𠄞/丄）
const byHexStr = new Map<string, number>();
for (const h of heads) byHexStr.set(h.cp.map((x) => x.toString(16)).join("-"), (byHexStr.get(h.cp.map((x) => x.toString(16)).join("-")) ?? 0) + 1);

// 字條內出現的字形來源（純計數，不依賴終端顯示）
const text = lines.join("\n");
const counts = {
  seal_script_tags: (text.match(/<seal_script>/g) ?? []).length,
  img_with_value: (text.match(/img="(?!nil)[^"]+"/g) ?? []).length,
  img_nil: (text.match(/img="nil"/g) ?? []).length,
  ids_in_body: (text.match(/[⿰-⿻]/g) ?? []).length,
  fullwidth_question_in_body: (text.match(/[？]/g) ?? []).length,
  pua_in_body: (text.match(/[\ue000-\uf8ff]/g) ?? []).length,
  black_circle_in_body: (text.match(/●/g) ?? []).length,
  white_square_in_body: (text.match(/□/g) ?? []).length,
  head_astral: [...byBucket].filter(([k]) => k.startsWith("EXT_")).reduce((n, [, v]) => n + v, 0),
};

const out: string[] = [];
out.push(`heads parsed: ${heads.length}`);
out.push("");
out.push("headword first-codepoint bucket:");
for (const [k, v] of [...byBucket].sort((a, b) => b[1] - a[1])) out.push(`  ${k.padEnd(20)} ${v}`);
out.push("");
out.push("headword character length (code points):");
for (const [k, v] of [...byCharLen].sort()) out.push(`  ${k} char  ${v}`);
out.push("");
out.push(`unique headword strings: ${byHexStr.size}`);
out.push(`duplicate headword strings: ${[...byHexStr].filter(([, v]) => v > 1).length}`);
out.push("");
out.push("counts in whole file:");
for (const [k, v] of Object.entries(counts)) out.push(`  ${k.padEnd(28)} ${v}`);
out.push("");
out.push("OTHER samples:");
for (const s of otherSamples) out.push(`  ${s}`);

writeFileSync("out/glyph-audit.txt", out.join("\n") + "\n", "utf8");
console.log("written out/glyph-audit.txt");
