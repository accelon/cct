/**
 * page-scan.ts — 13j 的 <頁> 統計與佔位符（缺字）分佈
 *   bun run src/page-scan.ts
 */
import { readFileSync, writeFileSync } from "node:fs";

const lines = readFileSync("out/13j.xml", "utf8").split("\n");
const out: string[] = [];
const say = (s = ""): void => { out.push(s); };

let book = "(前言)";
const perBook = new Map<string, { ye: number; ns: Set<string>; weird: string[] }>();
const bump = (b: string): { ye: number; ns: Set<string>; weird: string[] } => {
  const r = perBook.get(b) ?? { ye: 0, ns: new Set<string>(), weird: [] };
  perBook.set(b, r);
  return r;
};

lines.forEach((raw, i) => {
  const bm = raw.match(/^<書(?:\s[^>]*?)?\s+id="([^"]*)"/);
  if (bm) { book = bm[1]; return; }
  const ym = raw.match(/^<頁 n="([^"]*)"/);
  if (ym) {
    const rec = bump(book);
    rec.ye++;
    rec.ns.add(ym[1]);
    if (!/^\d+$/.test(ym[1])) rec.weird.push(`line ${i + 1}: n="${ym[1]}"`);
  }
});

const allNs = new Set<string>();
let total = 0;
say("=== <頁 n> 統計（handoff 說 950 個 <頁>、285 個不同 n）===");
say("book\t頁行數\t不同 n\t最小\t最大");
for (const [b, r] of perBook) {
  const nums = [...r.ns].filter((x) => /^\d+$/.test(x)).map(Number);
  total += r.ye;
  r.ns.forEach((x) => allNs.add(`${b}/${x}`));
  say(`${b}\t${r.ye}\t${r.ns.size}\t${Math.min(...nums)}\t${Math.max(...nums)}`);
}
const flat = new Set<string>();
for (const [, r] of perBook) r.ns.forEach((n) => flat.add(n));
say(`合計 <頁 n>: ${total} 行、不同 n（跨書合併）: ${flat.size}、(書,n) 組合: ${allNs.size}`);
for (const [b, r] of perBook) for (const w of r.weird) say(`  非數字 n → ${b} ${w}`);

// 佔位符
say("");
say("=== 佔位符／缺字符號在 13j 的分佈 ===");
const PLACEHOLDERS = /[●○□＊＃◎]/g;
const hits: { line: number; book: string; kind: string; ctx: string }[] = [];
book = "(前言)";
lines.forEach((raw, i) => {
  const bm = raw.match(/^<書(?:\s[^>]*?)?\s+id="([^"]*)"/);
  if (bm) { book = bm[1]; return; }
  for (const m of raw.matchAll(PLACEHOLDERS))
    hits.push({ line: i + 1, book, kind: m[0], ctx: raw.slice(0, 60) });
});
const byKind = new Map<string, number>();
for (const h of hits) byKind.set(h.kind, (byKind.get(h.kind) ?? 0) + 1);
say(`佔位符總次數: ${hits.length}`);
for (const [k, n] of byKind) say(`  ${k}: ${n}`);
say("在標題行（<章|節|項>）內的：");
for (const h of hits) if (/^<(章|節|項)[^>]*>/.test(lines[h.line - 1])) say(`  line ${h.line} ${h.book}: ${h.ctx}`);
const firstBody = hits.filter((h) => !/^<(章|節|項)[^>]*>/.test(lines[h.line - 1])).slice(0, 12);
say(`正文內的前 12 例（共 ${hits.length - hits.filter((h) => /^<(章|節|項)[^>]*>/.test(lines[h.line - 1])).length} 筆）：`);
for (const h of firstBody) say(`  line ${h.line} ${h.book} ${h.kind}: ${h.ctx}`);

writeFileSync("out/13j-pages.txt", out.join("\n") + "\n", "utf8");
console.log(`pages=${total} distinct=${flat.size} placeholders=${hits.length}`);
