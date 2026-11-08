/**
 * probe-ambig-fuzzy.ts — 一條一條探：那 6 條「容忍級含糊」為何在我列表裡搜不到
 *   bun run src/probe-ambig-fuzzy.ts
 */
import { readFileSync } from "node:fs";
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

const raw = readFileSync("D:/2026/openlit/out/006.txt", "utf8").split(/\r?\n/);
const chs: { id: string; t: string }[] = [];
let cur: { id: string; t: string } | null = null;
for (const l of raw) {
  const h = l.match(/^<章 id="([^"]*)"/);
  if (h) { cur = { id: h[1], t: "" }; chs.push(cur); continue; }
  if (!cur || /^</.test(l) || l === "") continue;
  cur.t += n2(n1(l));
}
console.log(`紅樓夢章數 ${chs.length}、n2 正文總長 ${chs.reduce((a, c) => a + c.t.length, 0).toLocaleString()} 字`);

const quotes = readFileSync("out/openlib-cites.tsv", "utf8").split(/\r?\n/)
  .filter((l) => l.startsWith("ambig-fuzzy\t") && l.includes("bk006"))
  .map((l) => l.split("\t")[8]);
console.log(`待探 ${quotes.length} 條`);
for (const q of quotes) {
  const pat = n2(n1(q));
  let best = 0, at = "", count80 = 0;
  for (const ch of chs) {
    for (let s = 0; s + pat.length <= ch.t.length; s++) {
      let same = 0;
      for (let k = 0; k < pat.length; k++) if (ch.t[s + k] === pat[k]) same++;
      const r = same / pat.length;
      if (r > best) { best = r; at = `${ch.id.slice(0, 16)} → ${ch.t.slice(s, s + pat.length)}`; }
      if (r >= 0.8) { count80++; s += pat.length - 2; }
    }
  }
  console.log(`\n引文「${q}」\n  n2 化 ${(pat.length)} 字 ${pat}\n  最佳相似 ${(best * 100).toFixed(1)}%｜≥80% 的視窗 ${count80} 個\n  最佳落點 ${at}`);
}
