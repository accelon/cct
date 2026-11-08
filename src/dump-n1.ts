/**
 * dump-n1.ts — 輸出本區 TS 對單一 anchor 算出的 n1（摺疊後漢字串），供與 Python 逐位元組比對
 *   bun run src/dump-n1.ts <line> <textEnd>
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const line = Number(process.argv[2]);
const end = Number(process.argv[3]);
const lines = readFileSync("out/13j.xml", "utf8").split("\n");

const FOLD = new Map<string, string>();
for (const l of readFileSync("data/char-fold.tsv", "utf8").split(/\r?\n/)) {
  if (!l || l.startsWith("#")) continue;
  const [a, b] = l.split("\t");
  FOLD.set(a, b);
}

const HAN = /\p{Script=Han}/gu;
const hm = lines[line - 1].match(/^<(?:章|節|項)[^>]*>[\s\S]*?<\/(?:章|節|項)>(.*)$/);
let s = hm ? hm[1] : "";
for (let ln = line + 1; ln < end; ln++) s += lines[ln - 1];
const chars = s.replace(/<[^>]*>/g, "").match(HAN) ?? [];
const n1 = chars.map((c) => FOLD.get(c) ?? c).join("");
writeFileSync("out/n1-ts.txt", n1, "utf8");
console.log(JSON.stringify({ line, end, rawChars: chars.length, n1len: [...n1].length, sha16: createHash("sha256").update(n1, "utf8").digest("hex").slice(0, 16) }));
