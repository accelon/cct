/**
 * audit-fuzzy-links.ts — 第三級（容忍對齊）的精度審查：把最低分的幾條並排出來看
 *
 *   bun run src/audit-fuzzy-links.ts
 *
 * 為何要單獨審這級：80% 門檻是用戶拍的標準，我照做，但「差 20%」在 8 字引文上是 1.6 個字、
 * 在 40 字引文上是 8 個字——同一個比例背後的風險差很多。所以除了差字統計，
 * 這裡另外按「引文長度分桶」看最低分實例，並把字典句與小說句並排，人工可判。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { foldChars, loadFold } from "./jing-anchors.ts";

const fold = loadFold();
const n1 = (s: string) => foldChars([...s.replace(/[^\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/g, "")], fold).n1;
const VROOT = new Map<string, string>();
for (const l of readFileSync("data/char-variant.tsv", "utf8").split(/\r?\n/)) {
  if (!l || l.startsWith("#")) continue;
  const [c, root] = l.split("\t");
  if (c && root && c !== root) VROOT.set(c, root);
}
const n2 = (s: string) => { let o = ""; for (const c of s) o += VROOT.get(c) ?? c; return o; };

const LIT = "D:/2026/openlit/out";
const cache = new Map<string, Map<string, string>>();
const chaps = (bk3: string) => {
  let m = cache.get(bk3);
  if (m) return m;
  m = new Map();
  const raw = readFileSync(`${LIT}/${bk3}.txt`, "utf8").split(/\r?\n/);
  let cur: string | null = null;
  for (const l of raw) {
    const h = l.match(/^<章 id="([^"]*)"/);
    if (h) { cur = h[1]; if (!m.has(cur)) m.set(cur, ""); continue; }
    if (cur === null || /^</.test(l) || l === "") continue;
    m.set(cur, m.get(cur)! + n2(n1(l)));
  }
  cache.set(bk3, m);
  return m;
};

type E = { score: number; len: number; head: string; book: string; bk: string; ch: string; dq: string; xs: string; diffs: string[] };
const es: E[] = [];
const pairTally = new Map<string, number>();
const byLen = new Map<string, { n: number; min: number }>();
for (const l of readFileSync("out/openlib-cites.tsv", "utf8").split(/\r?\n/)) {
  if (!l.startsWith("hit-fuzzy\t")) continue;
  const c = l.split("\t");
  const bk3 = c[6].padStart(3, "0");
  const chId = c[9], raw = chId.slice(chId.indexOf("/") + 1);
  const a = Number(c[10].split("-")[0]);
  const score = Number(c[11] ?? "0");
  const q = n2(n1(c[8]));
  const win = (chaps(bk3).get(raw) ?? "").slice(a, a + q.length);
  const diffs: string[] = [];
  for (let i = 0; i < q.length; i++) if (q[i] !== win[i]) { const k = `${q[i]}→${win[i]}`; pairTally.set(k, (pairTally.get(k) ?? 0) + 1); diffs.push(k); }
  es.push({ score, len: q.length, head: c[2], book: c[4], bk: bk3, ch: raw, dq: q, xs: win, diffs });
  const bucket = q.length <= 10 ? "8-10 字" : q.length <= 16 ? "11-16 字" : q.length <= 26 ? "17-26 字" : "27 字以上";
  const cur = byLen.get(bucket) ?? { n: 0, min: 1 };
  byLen.set(bucket, { n: cur.n + 1, min: Math.min(cur.min, score) });
}

const mark = (e: E) => { let o = ""; for (let i = 0; i < e.dq.length; i++) o += e.dq[i] === e.xs[i] ? e.dq[i] : `【${e.dq[i]}/${e.xs[i]}】`; return o; };
const rep = [
  "=== 第三級（容忍對齊）精度審查 ===",
  `審查 ${es.length} 條 hit-fuzzy｜用到的差字對 ${pairTally.size} 種`,
  "",
  "【按引文長度分桶】",
  ...[...byLen.entries()].map(([k, v]) => `  ${k}：${v.n} 條，最低分 ${(v.min * 100).toFixed(0)}%`),
  "",
  "【差字對前 20（多數應是異體／傳抄字）】",
  ...[...pairTally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([k, v]) => `  ${k}  ${v} 次`),
  "",
  "【最低分 12 條：字典句（【字典字/小說字】＝不同）vs 小說句】",
  ...es.sort((a, b) => a.score - b.score).slice(0, 12).map((e) =>
    `  ${(e.score * 100).toFixed(0)}% ${e.len}字〈${e.head}〉《${e.book}》bk${e.bk}「${e.ch.slice(0, 12)}」\n    ${mark(e)}\n    ${e.xs}`),
  "",
  "【最高分 4 條（應該幾乎一樣，驗證對齊沒跑偏）】",
  ...es.sort((a, b) => b.score - a.score).slice(0, 4).map((e) => `  ${(e.score * 100).toFixed(0)}% ${e.len}字　${mark(e).slice(0, 70)}`),
].join("\n") + "\n";
writeFileSync("out/audit-fuzzy-links.txt", rep, "utf8");
console.log(`寫入 out/audit-fuzzy-links.txt（${es.length} 條）`);
