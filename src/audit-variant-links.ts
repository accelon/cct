/**
 * audit-variant-links.ts — 精度審查：n2 贖回的那 998 條，實際是靠哪些字對摺上的
 *
 *   bun run src/audit-variant-links.ts
 *
 * 為什麼要這一支：Unihan kSemanticVariant 的語意是「某些語境同義」，不是「可互換」。
 * 若不查就把這批連結發佈出去，錯鏈比缺鏈更糟。這裡把每條 hit-var 的
 * 「字典用字 → 小說用字」逐位差抽出來統計，高風險字對一眼可見。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { foldChars, loadFold } from "./jing-anchors.ts";

const fold = loadFold();
const n1 = (s: string) => foldChars([...s.replace(/[^\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/g, "")], fold).n1;
const LIT = "D:/2026/openlit/out";
const chapCache = new Map<string, Map<string, string>>();
const chaps = (bk3: string) => {
  let m = chapCache.get(bk3);
  if (m) return m;
  m = new Map();
  const raw = readFileSync(`${LIT}/${bk3}.txt`, "utf8").split(/\r?\n/);
  let cur: string | null = null;
  for (const l of raw) {
    const h = l.match(/^<章 id="([^"]*)"/);
    if (h) { cur = h[1]; if (!m.has(cur)) m.set(cur, ""); continue; }
    if (cur === null || /^</.test(l) || l === "") continue;
    m.set(cur, m.get(cur)! + n1(l));
  }
  chapCache.set(bk3, m);
  return m;
};

const pairs = new Map<string, { n: number; ex: string }>();
const ex: string[] = [];
const dist = new Map<number, number>();
const worst: { r: number; s: string }[] = [];
let checked = 0, clean = 0, noDiff = 0;
for (const l of readFileSync("out/openlib-cites.tsv", "utf8").split(/\r?\n/)) {
  if (!l.startsWith("hit-var\t")) continue;
  const c = l.split("\t");
  const bk3 = c[6].padStart(3, "0");
  const chId = c[9];                                   // bkNNN/回目
  const raw = chId.slice(chId.indexOf("/") + 1);
  const [aStr] = [c[10].split("-")[0]];
  const a = Number(aStr);
  const q = n1(c[8]);
  const text = chaps(bk3).get(raw) ?? "";
  const novel = text.slice(a, a + q.length);
  checked++;
  if (novel.length !== q.length) { noDiff++; continue; }
  const diffs: string[] = [];
  for (let i = 0; i < q.length; i++) {
    if (q[i] !== novel[i]) {
      const k = `${q[i]}→${novel[i]}`;
      const cur = pairs.get(k) ?? { n: 0, ex: c[8].slice(0, 24) };
      pairs.set(k, { n: cur.n + 1, ex: cur.ex });
      diffs.push(k);
    }
  }
  if (!diffs.length) noDiff++;
  else clean++;
  dist.set(diffs.length, (dist.get(diffs.length) ?? 0) + 1);
  const ratio = diffs.length / q.length;
  worst.push({ r: ratio, s: `差異占比 ${(ratio * 100).toFixed(1)}%（${diffs.length}/${q.length} 字）　《${c[5]}》bk${bk3}「${raw.slice(0, 12)}」　${diffs.slice(0, 8).join(" ")}` });
  if (diffs.length && ex.length < 8) ex.push(`《${c[5]}》bk${bk3}「${raw.slice(0, 14)}」位差 ${diffs.length}：${diffs.join(" ")}`);
}

const rep = [
  "=== n2 贖回連結的精度審查 ===",
  `審查 ${checked} 條 hit-var：有字對差 ${clean}｜n1 已相同（不該是 hit-var，異常）${noDiff}`,
  `用到的不同字對 ${pairs.size} 種`,
  "",
  "【出現最多的字對（字典用字 → 小說用字）前 35】",
  ...[...pairs.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 35)
    .map(([k, v]) => `  ${k}  ${v.n} 次　例：${v.ex}`),
  "",
  "【每條連結的差字個數分布】",
  ...[...dist.entries()].sort((a, b) => a[0] - b[0]).map(([k, v]) => `  差 ${k} 字：${v} 條`),
  `  差字佔比 >20% 的：${worst.filter((w) => w.r > 0.2).length} 條（這批建議不發，或標更低信心）`,
  "",
  "【最壞 6 條（差字佔比最高）】",
  ...worst.sort((a, b) => b.r - a.r).slice(0, 6).map((w) => "  " + w.s),
  "",
  "【8 條實際鏈路（看差字是否合理）】",
  ...ex.map((s) => "  " + s),
].join("\n") + "\n";
writeFileSync("out/audit-variant-links.txt", rep, "utf8");
console.log(rep.split("\n").slice(0, 16).join("\n"));
