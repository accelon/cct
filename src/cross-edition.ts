/**
 * cross-edition.ts — 同一 work（shuowen）的多 edition 對照：id 集合、文字差異、例區塊數
 *
 *   bun run src/cross-edition.ts swjz swjzz
 *
 * 目的：證明「char anchor 可跨 edition 共用」（spec §4.1／prompts/swjz.md §1），
 * 並量化兩版文字差多少（差多少＝textHash 不同），供引用端決定 primary。
 * 產出：out/edition-compare.txt、out/edition-char-diff.tsv
 */
import { readFileSync, writeFileSync } from "node:fs";

const [a = "swjz", b = "swjzz"] = process.argv.slice(2);

type Char = { id: string; head: string; han: number; hash: string; zones: number; juan: string; bu: string; line: number };
const load = (f: string): Map<string, Char> => {
  const rows = readFileSync(f, "utf8").split(/\r?\n/).filter((l) => l.length > 0);
  const cols = rows[0].split("\t");
  const m = new Map<string, Char>();
  for (const l of rows.slice(1)) {
    const c = l.split("\t");
    const rec: Record<string, string> = {};
    cols.forEach((k, i) => { rec[k] = c[i] ?? ""; });
    m.set(rec.charId, { id: rec.charId, head: rec.head, han: Number(rec.hanCount), hash: rec.textHash, zones: Number(rec.zoneBlocks), juan: rec.juan, bu: rec.bu, line: Number(rec.line) });
  }
  return m;
};

const A = load(`out/${a}-char.tsv`);
const B = load(`out/${b}-char.tsv`);

const onlyA = [...A.keys()].filter((k) => !B.has(k));
const onlyB = [...B.keys()].filter((k) => !A.has(k));
const both = [...A.keys()].filter((k) => B.has(k));
const sameHash = both.filter((k) => A.get(k)!.hash === B.get(k)!.hash);
const diffHash = both.filter((k) => A.get(k)!.hash !== B.get(k)!.hash);
const diffHead = both.filter((k) => A.get(k)!.head !== B.get(k)!.head);

const lines: string[] = [];
const say = (s: string): void => { lines.push(s); };
say(`=== edition 對照：${a} vs ${b}（同一 work shuowen）===`);
say(`字 id 數: ${a} ${A.size}／${b} ${B.size}`);
say(`交集: ${both.length}　只在 ${a}: ${onlyA.length}　只在 ${b}: ${onlyB.length}`);
say(`交集＝兩邊完全一樣 → ${both.length === A.size && A.size === B.size ? "YES（char anchor 可跨版共用）" : "NO（id 集合不一致，跨版引用不能共用 anchor）"}`);
say("");
say(`textHash 相同: ${sameHash.length}（${((sameHash.length / both.length) * 100).toFixed(1)}%）→ 字條漢字完全一樣`);
say(`textHash 不同: ${diffHash.length}（${((diffHash.length / both.length) * 100).toFixed(1)}%）→ 兩版文字有差（異體、標點、分區）`);
say(`字頭本體不同: ${diffHead.length}`);
for (const k of diffHead.slice(0, 8)) say(`   ${k}: ${a}「${A.get(k)!.head}」 vs ${b}「${B.get(k)!.head}」`);
say("");
say(`例區塊數比較（同一字 id）:`);
let zA = 0, zB = 0, zDiff = 0;
for (const k of both) { zA += A.get(k)!.zones; zB += B.get(k)!.zones; if (A.get(k)!.zones !== B.get(k)!.zones) zDiff++; }
say(`   ${a} 合計 ${zA}／${b} 合計 ${zB}；同 id 但例數不同的字條 ${zDiff}`);
say("");
say("字條大小分佈（漢字數）：");
for (const [name, m] of [[a, A], [b, B]] as const) {
  const arr = [...m.values()].map((x) => x.han).sort((x, y) => x - y);
  const p = (q: number): number => arr[Math.floor(arr.length * q)] ?? 0;
  say(`   ${name}: min ${arr[0]} p50 ${p(0.5)} p90 ${p(0.9)} p99 ${p(0.99)} max ${arr[arr.length - 1]}；>240 ${arr.filter((x) => x > 240).length}`);
}
say("");
say(`卷／部對應：${a} 用 ${[...new Set([...A.values()].map((v) => v.juan))].slice(0, 3).join(",")}…（chaptertitle id）；${b} 用 ${[...new Set([...B.values()].map((v) => v.juan))].slice(0, 3).join(",")}…（卷 id）`);
say(`   → 兩版高階 id 同為 v01… 形式，可當 chapter anchor 共用；部名兩邊都有：${a} ${new Set([...A.values()].map((v) => v.bu)).size}／${b} ${new Set([...B.values()].map((v) => v.bu)).size}`);

const tsv = ["charId", "head_a", "head_b", "han_a", "han_b", "hash_a", "hash_b", "verdict"];
for (const k of diffHash.slice(0, 500)) {
  const x = A.get(k)!, y = B.get(k)!;
  tsv.push([k, x.head, y.head, x.han, y.han, x.hash, y.hash, x.head !== y.head ? "head-differs" : "text-differs"].join("\t"));
}
writeFileSync("out/edition-char-diff.tsv", tsv.join("\n") + "\n", "utf8");
writeFileSync("out/edition-compare.txt", lines.join("\n") + "\n", "utf8");
console.log(`${a}=${A.size} ${b}=${B.size} 交集=${both.length} 同hash=${sameHash.length} 異hash=${diffHash.length} 字頭不同=${diffHead.length}`);
