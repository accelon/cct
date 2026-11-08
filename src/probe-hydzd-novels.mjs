/**
 * probe-hydzd-novels.mjs — 探針：hydzd 的書證到底引了哪些書，能和 openlit 的書名對上幾本
 *
 *   node src/probe-hydzd-novels.mjs
 *
 * 做法：從 out/hydzd.xml 一次抽出全部《…》書名串（含計數），
 * 再拿 D:\2026\openlit\out\<id>.txt 的 <書> 標題去對（去空白、去卷次、去「上下」）。
 * 目的：在動工前知道這條邊的「產量」與「可對性」，不要憑感覺建連結。
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";

const xml = readFileSync("out/hydzd.xml", "utf8");
const tally = new Map();
for (const m of xml.matchAll(/《([^》\n]{1,24})》/g)) {
  const t = m[1].trim();
  if (t) tally.set(t, (tally.get(t) ?? 0) + 1);
}
const sorted = [...tally.entries()].sort((a, b) => b[1] - a[1]);

/* openlit 書名 */
const litDir = "D:/2026/openlit/out";
const lit = [];
for (const f of readdirSync(litDir).filter((x) => /^\d+\.txt$/.test(x))) {
  const head = readFileSync(`${litDir}/${f}`, "utf8").match(/<書 id="(bk\d+)"[^>]*>([\s\S]*?)<\/書>/);
  if (head) lit.push({ bk: head[1], title: head[2].trim() });
}
const norm = (s) => s.replace(/[\s\u3000]/g, "").replace(/[（(][^）)]*[)）]/g, "").replace(/[上下]卷$/, "").replace(/卷.$/, "");
const litByNorm = new Map();
for (const l of lit) {
  const k = norm(l.title);
  if (!litByNorm.has(k)) litByNorm.set(k, []);
  litByNorm.get(k).push(l);
}

const matched = [];
for (const [book, n] of sorted) {
  const k = norm(book);
  if (litByNorm.has(k)) matched.push({ book, n, bks: litByNorm.get(k).map((x) => x.bk).join(",") });
}
const unmatchedNovel = sorted.filter(([b]) => !litByNorm.has(norm(b)));

const outp = [
  "=== hydzd 書證《書名》探針 ===",
  `hydzd.xml ${xml.length.toLocaleString()} 字元；《…》不同書名 ${sorted.length} 種、共 ${[...tally.values()].reduce((a, b) => a + b, 0).toLocaleString()} 次`,
  `openlit 標題 ${lit.length} 本（去重後 ${litByNorm.size} 種書名）`,
  `直接對上 ${matched.length} 種書名、涉及 ${matched.reduce((a, m) => a + m.n, 0).toLocaleString()} 條書證`,
  "",
  "【對得上的（前 40）】",
  ...matched.slice(0, 40).map((m) => `  《${m.book}》 ${m.n} 次 → ${m.bks}`),
  "",
  "【對不上的高頻前 40（要手動建別名才有產量）】",
  ...unmatchedNovel.slice(0, 40).map(([b, n]) => `  《${b}》 ${n} 次`),
  "",
  "【openlit 有、hydzd 沒引到的前 25】",
  ...lit.filter((l) => !sorted.some(([b]) => norm(b) === norm(l.title))).slice(0, 25).map((l) => `  ${l.bk} ${l.title}`),
].join("\n") + "\n";
writeFileSync("out/probe-hydzd-novels.txt", outp, "utf8");
console.log(outp.split("\n").slice(0, 12).join("\n"));
