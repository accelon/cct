/**
 * build-jing.ts — 產生 jing 的文字與 anchor manifest（不打包）
 *
 *   bun run src/build-jing.ts
 *
 * 輸入：out/13j.xml（舊 13j.adb 的解包，唯讀參考）、data/char-fold.tsv、data/quezi-fix.tsv
 * 輸出：out/jing.xml            正文＋2,007 個 id（只插 id，其餘逐字相同）
 *       out/jing-manifest.tsv   anchor manifest（xout prebuild gate 的輸入）
 *       out/jing-build.txt      建置報告（含與 analyze-dump 的交叉斷言）
 *
 * 鐵律：不改經文、不改標點、不合并行、不動 VA（id 是標籤屬性，非 skip 標籤固定 4）。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { buildSegments, loadFold, loadQuezi, patchLines, stripTags, type Segment } from "./jing-anchors.ts";

const SRC = "out/13j.xml";
const lines = readFileSync(SRC, "utf8").split("\n");

const fold = loadFold();
const quezi = loadQuezi();
const built = buildSegments(lines, fold, quezi);
const patched = patchLines(lines, built.byLine);

/* ---- 斷言 1：去標籤後逐行相同（正文一字未動）---- */
const textDiff: string[] = [];
if (patched.out.length !== lines.length) textDiff.push(`行數改變 ${lines.length} → ${patched.out.length}`);
for (let i = 0; i < Math.min(lines.length, patched.out.length); i++) {
  if (stripTags(lines[i]) !== stripTags(patched.out[i])) textDiff.push(`line ${i + 1}: ${stripTags(lines[i]).slice(0, 40)} ≠ ${stripTags(patched.out[i]).slice(0, 40)}`);
}

/* ---- 斷言 2：id 在 work 內唯一；不得出現 #N ---- */
const dup = new Map<string, number>();
for (const s of built.segs) {
  const k = `${s.work}?${s.id}`;
  dup.set(k, (dup.get(k) ?? 0) + 1);
}
const dupKeys = [...dup].filter(([, n]) => n > 1).map(([k]) => k);
const seqIds = built.segs.filter((s) => /#\d/.test(s.id)).map((s) => `${s.work}?${s.id}`);

/* ---- 斷言 3：與 src/analyze-dump.ts 的獨立產出互校 ---- */
type Ref = { line: string; anchorId: string; textHash: string; hanCount: string };
const refRows: Ref[] = readFileSync("out/13j-manifest.tsv", "utf8")
  .split(/\r?\n/).filter((l) => l.length > 0).slice(1)
  .map((l) => { const c = l.split("\t"); return { anchorId: c[2], line: c[6], hanCount: c[8], textHash: c[9] }; });
const refByLine = new Map<number, Ref>();
for (const r of refRows) refByLine.set(Number(r.line), r);
let refMatch = 0, refEmptyConv = 0;
const refDiff: string[] = [];
const SHA_EMPTY = "e3b0c44298fc1c14";       // sha256("") 前 16
for (const s of built.segs) {
  const r = refByLine.get(s.line);
  if (!r) { refDiff.push(`line ${s.line}: 參考檔沒有（${s.work}?${s.id}）`); continue; }
  if (r.anchorId !== s.id || Number(r.hanCount) !== s.han) {
    refDiff.push(`line ${s.line} ${s.work}?${s.id}: 參考 ${r.anchorId}/${r.hanCount} ≠ 本 ${s.id}/${s.han}`);
    continue;
  }
  if (r.textHash === s.textHash) { refMatch++; continue; }
  if (s.han === 0 && r.textHash === SHA_EMPTY) { refEmptyConv++; continue; }   // 空字串慣例差（定案）
  refDiff.push(`line ${s.line} ${s.work}?${s.id}: hash 參考 ${r.textHash} ≠ 本 ${s.textHash}`);
}

/* ---- manifest ---- */
const head = ["work", "anchorId", "kind", "parentBook", "label", "originLabel", "parentPath",
  "line", "textEnd", "segBodyLines", "structOrLeaf", "hanCount", "textHash", "ancestorDepth"].join("\t");
const rows = built.segs.map((s: Segment) => {
  // 「行」定位：篇內正文行序（1 起，跳过空行與 <頁>）——作者要的 書名＋篇名＋行
  let bodyLines = 0;
  for (let ln = s.line + 1; ln < s.textEnd; ln++) {
    const l = lines[ln - 1] ?? "";
    if (l.trim() !== "" && !/^<頁/.test(l) && !/^<(章|節|項)>/.test(l)) bodyLines++;
  }
  return [
    s.work, s.id, "seg", s.book, s.label, s.originLabel,
    s.id.includes("/") ? s.id.slice(0, s.id.lastIndexOf("/")) : "",
    s.line, s.textEnd, bodyLines, s.isLeaf ? "leaf" : "struct", s.han, s.textHash, s.depth,
  ].join("\t");
});

/* ---- 報告 ---- */
const byLevel = { 章: 0, 節: 0, 項: 0 } as Record<string, number>;
for (const s of built.segs) byLevel[["章", "節", "項"][s.level]]++;
const rep = [
  "=== build-jing 報告 ===",
  `來源 ${SRC}: ${lines.length} 行（只讀）`,
  `語意節點 ${built.nodes}；可編 id ${built.segs.length}；缺陷 ${built.defects.length}`,
  `  章 ${byLevel["章"]}／節 ${byLevel["節"]}／項 ${byLevel["項"]}`,
  `  bare id ${built.segs.filter((s) => s.depth === 1).length}；加祖先 ${built.segs.filter((s) => s.depth > 1).length}（最深 ${Math.max(...built.segs.map((s) => s.depth)) - 1} 層）`,
  `  leaf ${built.segs.filter((s) => s.isLeaf).length}；0 漢字結構節點 ${built.segs.filter((s) => !s.isLeaf && s.han === 0).length}`,
  `插 id：${patched.patched} 行；跳過 ${patched.skipped.length}`,
  `缺字修正：套用 ${built.fixApplied.length}、拒絕 ${built.fixRejected.length}`,
  ...built.fixApplied.map((s) => "  OK  " + s),
  ...built.fixRejected.map((s) => "  NO  " + s),
  ...built.defects.map((s) => "  DEFECT " + s),
  `textHash 摺疊表查不到字：${built.foldMiss} 次${built.foldMiss ? " ← 重跑 python src/make-fold-table.py" : "（覆蓋完整）"}`,
  "",
  "--- 斷言 ---",
  `1. 去標籤後逐行相同：${textDiff.length === 0 ? "PASS" : `FAIL（${textDiff.length} 行）`}`,
  ...textDiff.slice(0, 8).map((s) => "   " + s),
  `2. id 在 work 內唯一：${dupKeys.length === 0 ? "PASS" : `FAIL ${dupKeys.slice(0, 5).join(" ")}`}`,
  `   不得出現 #N 序號：${seqIds.length === 0 ? "PASS" : `FAIL ${seqIds.join(" ")}`}`,
  `3. 與 analyze-dump 互校：${refMatch}/${built.segs.length} 完全相同（id＋hanCount＋textHash）；另 ${refEmptyConv} 筆只差在 0 漢字節點空字串慣例`,
  ...refDiff.slice(0, 8).map((s) => "   " + s),
].join("\n") + "\n";

writeFileSync("out/jing.xml", patched.out.join("\n"), "utf8");
writeFileSync("out/jing-manifest.tsv", [head, ...rows].join("\n") + "\n", "utf8");
writeFileSync("out/jing-build.txt", rep, "utf8");

const pass = textDiff.length === 0 && dupKeys.length === 0 && seqIds.length === 0 && built.defects.length === 0 && built.foldMiss === 0;
console.log(`nodes=${built.nodes} ids=${built.segs.length} patched=${patched.patched} refMatch=${refMatch} foldMiss=${built.foldMiss} 斷言=${pass ? "PASS" : "FAIL（見 out/jing-build.txt）"}`);
