/**
 * cross-check.ts — 把本區推導的 13j segment 與 gycd 引用端實測的 seg-manifest.csv 逐筆對照
 *   bun run src/cross-check.ts
 *
 * 輸入：out/13j-tree.tsv（本區全部 2,007 節點）、D:\2026\gycd\interlink\seg-manifest.csv
 * 輸出：out/13j-crosscheck.txt
 *
 * 比對面：id 集合、hanCount、line、kind／parentBook；本區目前只給 leaf 編 id，
 * 對方給全部節點 → 差異要分「範圍差」與「層級差」。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";

const HAN = /\p{Script=Han}/gu;

interface Row {
  work: string; anchorId: string; kind: string; parentBook: string; label: string;
  parent: string; path: string; hanCount: number; textHash: string; usable: string;
  warning: string; line: number;
}

function parseCsv(path: string): Row[] {
  const raw = readFileSync(path, "utf8").replace(/^/, "").trimEnd();
  const [head, ...body] = raw.split("\n").filter((l) => l.length > 0);
  const cols = head.split(",").map((c) => c.trim());
  return body.map((line) => {
    const cells: string[] = [];
    let cur = "", q = false;
    for (const ch of line) {
      if (ch === '"') q = !q;
      else if (ch === "," && !q) { cells.push(cur); cur = ""; }
      else cur += ch;
    }
    cells.push(cur);
    const rec: Record<string, string> = {};
    cols.forEach((c, i) => { rec[c] = (cells[i] ?? "").replace(/^"|"$/g, "").trim(); });
    return {
      work: rec.work, anchorId: rec.anchorId, kind: rec.kind, parentBook: rec.parentBook,
      label: rec.label, parent: rec.parent, path: rec.path,
      hanCount: Number(rec.hanCount), textHash: rec.textHash, usable: rec.usable,
      warning: rec.warning, line: Number(rec.line),
    } as Row;
  });
}

const gycd = parseCsv("D:/2026/gycd/interlink/seg-manifest.csv");
const lines = readFileSync("out/13j.xml", "utf8").split("\n");

// 本區 tree.tsv：全部節點（含非 leaf），自己算 canonical id（契約 §3：去空白、去括注）
const treeRaw = readFileSync("out/13j-tree.tsv", "utf8").split("\n").filter((l) => l.length > 0);
const [, ...treeBody] = treeRaw;
type Mine = {
  book: string; level: string; label: string; path: string[]; isLeaf: boolean;
  line: number; textEnd: number; han: number;
};
const mine: Mine[] = treeBody.map((l) => {
  const c = l.split("\t");
  return {
    book: c[0], level: c[1], label: c[2], path: c[3].split("/"),
    isLeaf: c[4] === "1", line: Number(c[5]), textEnd: Number(c[6]), han: Number(c[7]),
  };
});

const clean = (s: string): string =>
  s.replace(/\s+/g, "").replace(/[（(][^）)]*[）)]/g, "");

// 依 work（book→work 對照）逐書編 id：唯一用 bare，撞名逐層加祖先
const WORK: Record<string, string> = {
  周易: "yijing", 尚書: "shangshu", 毛詩: "shijing", 周禮: "zhouli", 儀禮: "yili",
  禮記: "liji", 左傳: "zuozhuan", 公羊傳: "gongyang", 穀梁傳: "guliang", 論語: "lunyu",
  孝經: "xiaojing", 爾雅: "erya", 孟子: "mengzi",
};

const byBook = new Map<string, Mine[]>();
for (const n of mine) (byBook.get(n.book) ?? byBook.set(n.book, []).get(n.book)!).push(n);

const ids = new Map<Mine, string>();
const seqNeeded: Mine[] = [];
for (const [b, arr] of byBook) {
  const paths = arr.map((n) => n.path.map(clean));
  const out = paths.map((p) => p[p.length - 1]);
  let depth = 1;
  while (true) {
    const cnt = new Map<string, number>();
    out.forEach((s) => cnt.set(s, (cnt.get(s) ?? 0) + 1));
    const clash = arr.filter((_, k) => (cnt.get(out[k]) ?? 0) > 1);
    if (!clash.length) break;
    const maxDepth = Math.min(...clash.map((n) => n.path.length));
    if (depth >= maxDepth) break;
    for (let k = 0; k < out.length; k++)
      if ((cnt.get(out[k]) ?? 0) > 1) out[k] = paths[k].slice(paths[k].length - depth - 1).join("/");
    depth++;
  }
  const cnt2 = new Map<string, number>();
  out.forEach((s) => cnt2.set(s, (cnt2.get(s) ?? 0) + 1));
  arr.forEach((n, k) => {
    if ((cnt2.get(out[k]) ?? 0) > 1) seqNeeded.push(n);
    ids.set(n, out[k]);
  });
}

const mineByKey = new Map<string, { m: Mine; id: string }>();
for (const n of mine) mineByKey.set(`${WORK[n.book]}\u0000${ids.get(n)}`, { m: n, id: ids.get(n)! });

const out: string[] = [];
const say = (s = ""): void => { out.push(s); };

say("=== 筆數 ===");
say(`gycd seg-manifest: ${gycd.length}`);
say(`本區節點: ${mine.length}（leaf ${mine.filter((n) => n.isLeaf).length}）`);

// ---- 1) id 集合差異
const gIds = new Set(gycd.map((r) => `${r.work}\u0000${r.anchorId}`));
const mIds = new Set(mineByKey.keys());
const onlyG = [...gIds].filter((k) => !mIds.has(k));
const onlyM = [...mIds].filter((k) => !gIds.has(k));
say("");
say("=== anchorId 集合差異 ===");
say(`只在 gycd: ${onlyG.length}`);
for (const k of onlyG.slice(0, 25)) say(`  ${k.replace("\u0000", "?")}`);
say(`只在本區: ${onlyM.length}`);
for (const k of onlyM.slice(0, 25)) say(`  ${k.replace("\u0000", "?")}`);

// ---- 2) line 相同但 hanCount 不同 → 範圍定義差
say("");
say("=== 用 line 對齊：範圍（hanCount）差異 ===");
const gByLine = new Map<number, Row>();
for (const r of gycd) gByLine.set(r.line, r);
let rangeDiff = 0, lineMatch = 0;
const diffs: string[] = [];
for (const n of mine) {
  const g = gByLine.get(n.line);
  if (!g) { diffs.push(`line ${n.line} 不在 gycd（${WORK[n.book]}/${n.label}）`); continue; }
  lineMatch++;
  if (g.hanCount !== n.han) { rangeDiff++; if (diffs.length < 25) diffs.push(`${g.work}?${g.anchorId} line ${n.line}: gycd ${g.hanCount} vs 本區 ${n.han}（差 ${n.han - g.hanCount}）`); }
}
say(`line 可對上: ${lineMatch}／${mine.length}`);
say(`hanCount 不同: ${rangeDiff}`);
for (const d of diffs) say(`  ${d}`);

// ---- 3) textHash：依 spec §4.4 全數比對
say("");
say("=== textHash comparison (mine vs gycd seg-manifest.csv) ===");
const mani: { line: number; textHash: string; anchorId: string; work: string }[] = [];
{
  const raw = readFileSync("out/13j-manifest.tsv", "utf8").replace(/^/, "").split("\n").filter((l) => l.length > 0);
  const cols = raw[0].split("\t");
  const iLine = cols.indexOf("line"), iHash = cols.indexOf("textHash"), iId = cols.indexOf("anchorId"), iW = cols.indexOf("work");
  for (const l of raw.slice(1)) {
    const c = l.split("\t");
    mani.push({ line: Number(c[iLine]), textHash: c[iHash], anchorId: c[iId], work: c[iW] });
  }
}
const gByLine0 = new Map<number, Row>();
for (const r of gycd) gByLine0.set(r.line, r);
const myHashByLine = new Map<number, string>();
for (const m of mani) myHashByLine.set(Number(m.line), m.textHash);
let hSame = 0, hDiff = 0, hNoPair = 0, hDiffEmpty = 0;
const hDiffRows: string[] = [];
for (const g of gycd) {
  const mineH = myHashByLine.get(g.line);
  if (!mineH) { hNoPair++; continue; }
  if (mineH === g.textHash) hSame++;
  else {
    hDiff++;
    if (g.hanCount === 0) hDiffEmpty++;                       // gycd 留空、我算 sha256("")
    else if (hDiffRows.length < 12) hDiffRows.push(`${g.work}?${g.anchorId} line ${g.line} han ${g.hanCount}: gycd ${g.textHash} vs 本區 ${mineH}`);
  }
}
say(`  hash 相同: ${hSame}／${gycd.length}`);
say(`  hash 不同: ${hDiff}（其中 0 漢字結構節點 ${hDiffEmpty} 筆：gycd 留空字串、本區算 sha256("")）`);
say(`  真正內文不相符: ${hDiff - hDiffEmpty}`);
say(`  配不上行號: ${hNoPair}（＝本區依契約不編 id 的 2 筆 ●人缺陷）`);
for (const r of hDiffRows) say(`    ${r}`);

// ---- 4) 對方標的 usable／warning
say("");
say("=== gycd 的 usable／warning 分佈 ===");
const uw = new Map<string, number>();
for (const r of gycd) { const k = `usable=${r.usable} warning=${r.warning || "(空)"}`; uw.set(k, (uw.get(k) ?? 0) + 1); }
for (const [k, n] of uw) say(`  ${n}\t${k}`);
say("warning 非空的例子：");
for (const r of gycd.filter((x) => x.warning).slice(0, 15)) say(`  ${r.work}?${r.anchorId} (line ${r.line}): ${r.warning}`);

// ---- 5) 本區需要序號（契約說這屬來源缺陷，要回報）
say("");
say("=== 本區判定「加祖先仍同名」＝要回報的來源缺陷 ===");
for (const n of seqNeeded) say(`  ${WORK[n.book]}?${ids.get(n)}  label「${n.label}」 line ${n.line}`);

// ---- 6) 逐筆成因：把兩種邊界都算出來，並列出「多出來的字」
say("");
say("=== 差異成因逐筆解剖（前 6 筆）===");
const gByLine2 = new Map<number, Row>();
for (const r of gycd) gByLine2.set(r.line, r);
const sortedG = [...gycd].sort((a, b) => a.line - b.line);
const residualOf = (ln: number): string => {
  const hm = lines[ln - 1].match(/^<(?:章|節|項)[^>]*>[\s\S]*?<\/(?:章|節|項)>(.*)$/);
  return hm ? hm[1] : "";
};
const hanRange = (from: number, to: number, withResidual: boolean): string => {
  let s = withResidual ? residualOf(from) : "";
  for (let ln = from + 1; ln < to; ln++) s += lines[ln - 1];
  return s.replace(/<[^>]*>/g, "").match(HAN)?.join("") ?? "";
};
let sameAsGycd = 0, astralDiff = 0, otherDiff = 0;
const samples: string[] = [];
for (const n of mine) {
  const g = gByLine2.get(n.line);
  if (!g) continue;
  const gNext = sortedG.find((r) => r.line > n.line)?.line ?? lines.length + 1;
  // 以 gycd 的邊界 ＋ 本區漢字類（\p{Script=Han}）重算
  const withHanClass = hanRange(n.line, gNext, true);
  const bmpOnly = [...withHanClass].filter((c) => c.codePointAt(0)! <= 0xffff).length;
  if (withHanClass.length === g.hanCount) sameAsGycd++;
  else if (bmpOnly === g.hanCount) astralDiff++;
  else otherDiff++;
  if (withHanClass.length !== g.hanCount && samples.length < 6) {
    samples.push(`${g.work}?${g.anchorId} line ${n.line}～${gNext}：gycd ${g.hanCount}／本區邊界 ${n.textEnd} → ${n.han}／用 gycd 邊界重算 ${withHanClass.length}`);
  }
}
say(`用 gycd 的邊界＋本區漢字類重算後與 gycd 完全相同: ${sameAsGycd}／2007`);
say(`只有改用「BMP-only 漢字類」才會與 gycd 相同（= 差在星體字）: ${astralDiff}`);
say(`兩者都不是（邊界另有定義）: ${otherDiff}`);
for (const s of samples) say(`  ${s}`);

// ---- 7) gycd 標 usable=0 的是哪些
say("");
say("=== gycd usable=0（75 筆）分佈與例子 ===");
const un0 = gycd.filter((r) => r.usable === "0");
const byW = new Map<string, number>();
for (const r of un0) byW.set(r.work, (byW.get(r.work) ?? 0) + 1);
for (const [w, k] of [...byW].sort((a, b) => b[1] - a[1])) say(`  ${w}: ${k}`);
for (const r of un0.slice(0, 15)) say(`  ${r.work}?${r.anchorId} line ${r.line} han ${r.hanCount} label「${r.label}」`);

writeFileSync("out/13j-crosscheck.txt", out.join("\n") + "\n", "utf8");
console.log(`gycd=${gycd.length} mine=${mine.length} onlyG=${onlyG.length} onlyM=${onlyM.length} rangeDiff=${rangeDiff} seqNeeded=${seqNeeded.length}`);
