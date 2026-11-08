/**
 * diag-offset.ts — 對 slice-differs 的連結，量「引文實際位置」與「宣告 target_a」的差
 *   bun run src/diag-offset.ts
 *
 * 目的：判別 gycd 的 a-b 到底用哪種座標（錨點內？書內？含標點？尾端含不含？）
 */
import { readFileSync } from "node:fs";

const HAN = /\p{Script=Han}/gu;
const lines = readFileSync("out/13j.xml", "utf8").split("\n");
const swjzLines = readFileSync("out/swjz.xml", "utf8").split("\n");

const tsv = (p: string, sep: string) => {
  const [h, ...b] = readFileSync(p, "utf8").split("\n").filter((l) => l.length > 0);
  const c = h.split(sep);
  return b.map((l) => { const x = l.split(sep); const r: Record<string, string> = {}; c.forEach((k, i) => { r[k] = x[i] ?? ""; }); return r; });
};

const tree = tsv("out/13j-tree.tsv", "\t");
const mani = tsv("out/13j-manifest.tsv", "\t");
const endOfLine = new Map<number, number>();
const bookOfLine = new Map<number, string>();
for (const t of tree) { endOfLine.set(Number(t.line), Number(t.textEnd)); bookOfLine.set(Number(t.line), t.book); }

const WORK: Record<string, string> = {
  周易: "yijing", 尚書: "shangshu", 毛詩: "shijing", 周禮: "zhouli", 儀禮: "yili", 禮記: "liji",
  左傳: "zuozhuan", 公羊傳: "gongyang", 穀梁傳: "guliang", 論語: "lunyu", 孝經: "xiaojing",
  爾雅: "erya", 孟子: "mengzi",
};
type A = { work: string; line: number; end: number };
const anchorOf = new Map<string, A>();
for (const m of mani) {
  const ln = Number(m.line);
  anchorOf.set(`${m.work}?${m.anchorId}`, { work: m.work, line: ln, end: endOfLine.get(ln) ?? ln + 1 });
}
const hanOfAnchor = (a: A): string => {
  let raw = "";
  const hm = lines[a.line - 1].match(/^<(?:章|節|項)[^>]*>[\s\S]*?<\/(?:章|節|項)>(.*)$/);
  if (hm) raw += hm[1];
  for (let ln = a.line + 1; ln < a.end; ln++) raw += lines[ln - 1];
  return (raw.replace(/<[^>]*>/g, "").match(HAN) ?? []).join("");
};

// 對照表：work?anchorId -> {anchorHan, startInBookHan}
const table = new Map<string, { han: string; start: number; len: number }>();
{
  const rows = [...mani].sort((a, b) => Number(a.line) - Number(b.line));
  const byWork = new Map<string, typeof rows>();
  for (const r of rows) (byWork.get(r.work) ?? byWork.set(r.work, []).get(r.work)!).push(r);
  for (const [w, arr] of byWork) {
    let pos = 0;
    for (const r of arr) {
      const ln = Number(r.line);
      const a: A = { work: w, line: ln, end: endOfLine.get(ln) ?? ln + 1 };
      const h = hanOfAnchor(a);
      table.set(`${w}?${r.anchorId}`, { han: h, start: pos, len: h.length });
      pos += h.length;
    }
  }
}

/* 說文：字條漢字流＋全庫座標 */
const charLines: { id: string; line: number }[] = [];
swjzLines.forEach((raw, i) => {
  const m = raw.match(/<字\s+id="(w\d{7})"/);
  if (m) charLines.push({ id: m[1], line: i + 1 });
});
const charTable = new Map<string, { han: string; start: number }>();
{
  let pos = 0;
  charLines.forEach((c, k) => {
    const end = k + 1 < charLines.length ? charLines[k + 1].line : c.line;
    let raw = "";
    for (let ln = c.line; ln < end; ln++) raw += swjzLines[ln - 1];
    const h = (raw.replace(/<[^>]*>/g, "").match(HAN) ?? []).join("");
    charTable.set(c.id, { han: h, start: pos });
    pos += h.length;
  });
}

const corpus = new Map<string, string>();
corpus.set("shuowen", [...charTable.values()].map((t) => t.han).join(""));
for (const k of new Set([...table.keys()].map((s) => s.split("?")[0])))
  corpus.set(k, [...table.entries()].filter(([key]) => key.startsWith(k + "?")).map(([, t]) => t.han).join(""));

const acc = tsv("D:/2026/gycd/interlink/accepted.tsv", "\t");
const stats = {
  exact: 0, atAnchorOffset: new Map<number, number>(), wholeCorpusOffset: new Map<number, number>(),
  notFoundAnywhere: 0, mismatch: 0, total: 0,
};
for (const r of acc) {
  const bare = r.target_anchor.replace(/^(char|seg):/, "");
  const q = r.quote_normalized;
  const a = Number(r.target_a), b = Number(r.target_b);
  if (!q) continue;
  let han = "", start = 0;
  if (r.target_work === "shuowen") {
    const t = charTable.get(bare);
    if (!t) continue;
    han = t.han; start = t.start;
  } else {
    const t = table.get(`${r.target_work}?${bare}`);
    if (!t) continue;
    han = t.han; start = t.start;
  }
  stats.total++;
  if (han.slice(a, b) === q) { stats.exact++; continue; }
  stats.mismatch++;
  const local = han.indexOf(q);
  if (local >= 0) stats.atAnchorOffset.set(local - a, (stats.atAnchorOffset.get(local - a) ?? 0) + 1);
  else {
    // 試全書／全庫座標
    const all = r.target_work === "shuowen"
      ? [...charTable.values()].map((t) => t.han).join("")
      : [...table.entries()].filter(([k]) => k.startsWith(r.target_work + "?")).map(([, t]) => t.han).join("");
    const g = all.indexOf(q);
    if (g >= 0) stats.wholeCorpusOffset.set(g - a, (stats.wholeCorpusOffset.get(g - a) ?? 0) + 1);
    else stats.notFoundAnywhere++;
  }
}
console.log(JSON.stringify({
  可比對: stats.total, 原樣通過: stats.exact, 需重驗: stats.mismatch,
  段內找得到_偏移分佈: [...stats.atAnchorOffset].sort((x, y) => y[1] - x[1]).slice(0, 6),
  換全書全庫座標才對_偏移分佈: [...stats.wholeCorpusOffset].sort((x, y) => y[1] - x[1]).slice(0, 6),
  四處都找不到: stats.notFoundAnywhere,
}, null, 1));
