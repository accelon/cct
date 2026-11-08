/**
 * diag-miss.ts — 診斷：那些「書名配上了、引文卻搜不到」的 miss，到底是哪一種差異
 *
 *   bun run src/diag-miss.ts            # 抽 12 條 miss，做最長可命中前綴比對
 *
 * 判讀：
 *   prefix 很長（≥8）→ 引文被字典截斷／加了「…」或改字（省字級差異）
 *   prefix 很短（<5）→ 版本不同（如 70 回本 vs 120 回本）、或我們抓的內文缺了那段
 * 這一支不改任何輸出，只是讓 49% 命中率這個數字有解釋，而不是我蒙著報。
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { foldChars, loadFold } from "./jing-anchors.ts";

const fold = loadFold();
const n1 = (s: string) => foldChars([...s.replace(/[^\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/g, "")], fold).n1;

const LIT = "D:/2026/openlit/out";
const cache = new Map<string, string>();
const bookText = (id: string) => {
  if (cache.has(id)) return cache.get(id)!;
  const raw = readFileSync(`${LIT}/${id}.txt`, "utf8").split(/\r?\n/);
  const t = raw.filter((l) => l && !/^</.test(l)).map(n1).join("");
  cache.set(id, t);
  return t;
};

const miss = readFileSync("out/openlib-cites.tsv", "utf8").split(/\r?\n/)
  .filter((l) => l.startsWith("miss\t"))
  .map((l) => l.split("\t"))
  .filter((c) => /^(bk)?0*(6|19|14|10|86|132|185)$|^(6|19|14|10|86|132|185)$/.test(c[6] ?? ""))
  .slice(0, 12);

const out: string[] = ["=== miss 診斷：最長可命中前綴 ==="];
for (const c of miss) {
  const [, line, head, , book, , bk, , quote] = c;
  const id = (bk ?? "").padStart(3, "0");
  const q = n1(quote);
  const t = bookText(id);
  let lo = 0, hi = q.length;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (t.includes(q.slice(0, mid))) lo = mid; else hi = mid - 1; }
  const at = lo > 0 ? t.indexOf(q.slice(0, lo)) : -1;
  out.push(`— 字典第 ${line} 行〈${head}〉《${book}》→ bk${id}　引文 ${q.length} 字，可命中前綴 ${lo} 字`);
  out.push(`  字典：${q.slice(0, Math.max(lo + 6, 14))}`);
  out.push(`  小說：${lo > 0 ? t.slice(at, at + Math.max(lo + 12, 20)) : "（連前 5 字都找不到）"}`);
}
writeFileSync("out/diag-miss.txt", out.join("\n") + "\n", "utf8");
console.log(`檢查 ${miss.length} 條 → out/diag-miss.txt`);
