/**
 * list-ambiguous.ts — 展開那 26 條「同書多處命中」到底是哪些短語
 *
 *   bun run src/list-ambiguous.ts
 *
 * 對每條含糊引文回到該書重算出現次數與落在哪些章，並把「同一短語被多個字頭引用」歸在一起，
 * 這樣可以看出：是短語太通用（該排除），還是書本身有平行段落/回文復述（該保留但標含糊）。
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
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
const cache = new Map<string, { title: string; chs: { id: string; t1: string; t2: string }[] }>();
const book = (bk3: string) => {
  let b = cache.get(bk3);
  if (b) return b;
  const raw = readFileSync(`${LIT}/${bk3}.txt`, "utf8").split(/\r?\n/);
  const title = raw.find((l) => l.startsWith("<書 "))?.match(/<書 id="bk\d+"[^>]*>([\s\S]*?)<\/書>/)?.[1]?.trim() ?? "?";
  const chs: { id: string; t1: string; t2: string }[] = [];
  let cur: { id: string; t1: string; t2: string } | null = null;
  for (const l of raw) {
    const h = l.match(/^<章 id="([^"]*)"/);
    if (h) { cur = { id: h[1], t1: "", t2: "" }; chs.push(cur); continue; }
    if (!cur || /^</.test(l) || l === "") continue;
    const t = n1(l);
    cur.t1 += t; cur.t2 += n2(t);
  }
  b = { title, chs };
  cache.set(bk3, b);
  return b;
};

const rows = readFileSync("out/openlib-cites.tsv", "utf8").split(/\r?\n/)
  .filter((l) => l.startsWith("ambiguous\t") || l.startsWith("ambig-fuzzy\t"))
  .map((l) => l.split("\t"));

const detail: string[] = [];
const phraseTally = new Map<string, { n: number; heads: Set<string>; book: string; hits: number; where: string[] }>();
for (const c of rows) {
  const [, line, head, , bookName, how, bk, , quote] = c;
  const bk3 = (bk.split("/")[0] ?? "").padStart(3, "0");
  const b = book(bk3);
  const q1 = n1(quote), q2 = n2(quote);
  const fuzzy = c[0] === "ambig-fuzzy";
  const hits: { ch: string; at: number }[] = [];
  if (fuzzy) {
    /* 容忍級靠的是 ≥80% 視窗，不是精確子串 → 用精確 indexOf 必然 0 次，那樣報表會誤導。
     * 這裡改為掃「相似度 ≥80% 的視窗」來計數。 */
    const pat = n2(n1(quote));      // ⚠ 必須先 n1（去標點＋繁簡摺疊）再 n2，跟 builder 同一條路徑
    for (const ch of b.chs) {
      const hay = ch.t2;
      for (let s = 0; s + pat.length <= hay.length; s++) {
        let same = 0;
        for (let k = 0; k < pat.length; k++) if (hay[s + k] === pat[k]) same++;
        if (same / pat.length >= 0.8) { hits.push({ ch: ch.id, at: s }); s += pat.length - 2; }
        if (hits.length > 40) break;
      }
    }
  } else {
    for (const ch of b.chs) {
      const hay = ch.t1, pat = q1;
      let p = hay.indexOf(pat);
      while (p >= 0) { hits.push({ ch: ch.id, at: p }); p = hay.indexOf(pat, p + 1); if (hits.length > 40) break; }
    }
  }
  const key = quote.trim();
  if (!phraseTally.has(key)) phraseTally.set(key, { n: 0, heads: new Set(), book: `bk${bk3} ${b.title}`, hits: hits.length, where: [...new Set(hits.map((h) => h.ch))] });
  const t = phraseTally.get(key)!;
  t.n++; t.heads.add(head);
  detail.push(`${c[0]}\t${q1.length}字\t〈${head}〉《${bookName}》→ bk${bk3} ${b.title}\t出現 ${hits.length} 次于 ${new Set(hits.map((h) => h.ch)).size} 章\t「${quote}」\t例落章：${[...new Set(hits.map((h) => h.ch))].slice(0, 4).join(" ｜ ")}`);
}

const uniq = [...phraseTally.entries()].sort((a, b) => b[1].hits - a[1].hits);
const out = [
  "=== 26 條多命中（＋6 條容忍級含糊）展開 ===",
  `總列 ${rows.length} 條；去掉重複短語後 ${uniq.length} 種`,
  "",
  "【按出現次數排（最容易誤鏈的短語在最上面）】",
  ...uniq.map(([q, t]) => `  「${q}」  全書出現 ${t.hits} 次／${t.where.length} 章｜被 ${[...t.heads].join("、")} 等 ${t.heads.size} 個字頭引用｜${t.book}`),
  "",
  "【逐條明細】",
  ...detail.map((s) => "  " + s.replace(/\t/g, " ｜ ")),
].join("\n") + "\n";
writeFileSync("out/ambiguous-links.txt", out, "utf8");
console.log(out.split("\n").slice(0, 18).join("\n"));
