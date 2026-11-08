/**
 * verify-link-efficiency.ts — 只驗 adb 互鏈的效率與正確性（不寫母區、不打包、不發布）
 *
 *   bun run src/verify-link-efficiency.ts [limit]
 *
 * 輸入：
 *   out/13j.xml out/13j-tree.tsv out/13j-manifest.tsv      —— 13j 正文、節點邊界、本區 canonical id
 *   out/swjz.xml                                            —— 說文字條（w… id 已在檔內）
 *   D:\2026\gycd\interlink\accepted.tsv                     —— 引用端已解析的 69,838 條實鏈
 *
 * 兩條解析路徑同規模對比：
 *   A「現況」：正文只有標題文字、沒有 id → 只能用 quote 在該書漢字流裡搜尋定位，再回推落在哪個段落
 *   B「有 id」：anchorId → 段落直接切片 a-b，檢查是否等於 quote_normalized
 *
 * 產出：out/link-efficiency.txt（統計＋耗時）、out/link-issues.tsv（對不上／歧義明細）
 */
import { readFileSync, writeFileSync } from "node:fs";

const HAN = /\p{Script=Han}/gu;
const limit = Number(process.argv[2] ?? "0");          // 0 ＝ 全跑
const WORKS13 = new Set(["yijing", "shangshu", "shijing", "zhouli", "yili", "liji", "zuozhuan",
  "gongyang", "guliang", "lunyu", "xiaojing", "erya", "mengzi"]);

function readTsv(path: string, sep: string) {
  const [h, ...b] = readFileSync(path, "utf8").split("\n").filter((l) => l.length > 0);
  const cols = h.split(sep);
  return b.map((l) => {
    const c = l.split(sep);
    const r: Record<string, string> = {};
    cols.forEach((k, i) => { r[k] = c[i] ?? ""; });
    return r;
  });
}

/* ---------------- 13j：書 → 漢字流 ＋ 漢字索引→段落 id ---------------- */
const lines = readFileSync("out/13j.xml", "utf8").split("\n");
type Seg = { id: string; book: string; line: number; end: number };
const tree = readTsv("out/13j-tree.tsv", "\t");
const mani = readTsv("out/13j-manifest.tsv", "\t");

// manifest 有 anchorId（含最少祖先）；tree 有 line／textEnd。用 line 對齊。
const byLine = new Map<number, { id: string; book: string; line: number; end: number }>();
const treeByLine = new Map<number, { book: string; end: number }>();
for (const t of tree) treeByLine.set(Number(t.line), { book: t.book, end: Number(t.textEnd) });
for (const m of mani) {
  const t = treeByLine.get(Number(m.line));
  if (!t) continue;
  byLine.set(Number(m.line), { id: m.anchorId, book: m.work, line: Number(m.line), end: t.end });
}

const segsByWork = new Map<string, Seg[]>();
for (const [line, v] of byLine)
  (segsByWork.get(v.book) ?? segsByWork.set(v.book, []).get(v.book)!).push({ id: v.id, book: v.book, line, end: v.end });

// 每本書一条漢字流＋位置→anchor 對照
type BookIndex = { han: string; owner: Int32Array; order: number[] };
const bookIdx = new Map<string, BookIndex>();
const sortedByLine = [...byLine.values()].sort((a, b) => a.line - b.line);
let cursor = -1;
for (const w of new Set([...byLine.values()].map((s) => s.book))) {
  const mine = sortedByLine.filter((s) => s.book === w);
  let han = "";
  const owner: number[] = [];
  for (const seg of mine) {
    let raw = "";
    const hm = lines[seg.line - 1].match(/^<(?:章|節|項)[^>]*>[\s\S]*?<\/(?:章|節|項)>(.*)$/);
    if (hm) raw += hm[1];
    for (let ln = seg.line + 1; ln < seg.end; ln++) raw += lines[ln - 1];
    raw = raw.replace(/<[^>]*>/g, "");
    const chars = raw.match(HAN) ?? [];
    for (const c of chars) { han += c; owner.push(mine.indexOf(seg)); }
  }
  bookIdx.set(w, { han, owner: Int32Array.from(owner), order: mine.map((s) => s.line) });
  void cursor;
}

/* ---------------- swjz：字 id → 字條漢字流 ---------------- */
const swjzLines = readFileSync("out/swjz.xml", "utf8").split("\n");
type CharSeg = { id: string; line: number; end: number };
const charSegs: CharSeg[] = [];
swjzLines.forEach((raw, i) => {
  const m = raw.match(/<字\s+id="(w\d{7})"/);
  if (m) charSegs.push({ id: m[1], line: i + 1, end: i + 1 });
});
for (let k = 0; k < charSegs.length; k++) charSegs[k].end = k + 1 < charSegs.length ? charSegs[k + 1].line : charSegs[k].end;
const charHan = new Map<string, string>();
const charByLine = new Map<number, string>();
for (const c of charSegs) charByLine.set(c.line, c.id);
for (let k = 0; k < charSegs.length; k++) {
  let raw = "";
  for (let ln = charSegs[k].line; ln < charSegs[k].end; ln++) raw += swjzLines[ln - 1];
  charHan.set(charSegs[k].id, (raw.replace(/<[^>]*>/g, "").match(HAN) ?? []).join(""));
}

/* ---------------- 引用端實鏈 ---------------- */
const acc = readTsv("D:/2026/gycd/interlink/accepted.tsv", "\t")
  .filter((r) => WORKS13.has(r.target_work) || r.target_work === "shuowen");
const rows = limit > 0 ? acc.slice(0, limit) : acc;

const out: string[] = [];
const say = (s = ""): void => { out.push(s); };
const issues: string[] = ["work\ttarget_anchor\tmode\tverdict\tquote\tnote"];

/* --- 路徑 A：無 id，只能文字搜尋（13j 現況）--- */
const A = { hit0: 0, hit1: 0, hitN: 0, wrongAnchor: 0, ok: 0, ms: 0 };
const t0 = performance.now();
for (const r of rows) {
  if (!WORKS13.has(r.target_work)) continue;              // 說文有 id，走 B
  const idx = bookIdx.get(r.target_work);
  if (!idx) { A.hit0++; continue; }
  const q = r.quote_normalized;
  if (!q) { A.hit0++; continue; }
  let pos = idx.han.indexOf(q), n = 0;
  while (pos >= 0) { n++; const nx = idx.han.indexOf(q, pos + 1); if (nx === pos) break; pos = nx; if (n > 20) break; }
  if (n === 0) { A.hit0++; issues.push([r.target_work, r.target_anchor, "A-search", "miss", q, "書內搜不到引文"].join("\t")); continue; }
  if (n > 1) { A.hitN++; issues.push([r.target_work, r.target_anchor, "A-search", "ambiguous", q, `書內 ${n} 處`].join("\t")); continue; }
  pos = idx.han.indexOf(q);
  const segPos = idx.owner[pos];
  const gotId = segPos === undefined ? "?" : (() => {
    const ln = idx.order[segPos];
    return byLine.get(ln)?.id ?? "?";
  })();
  const want = r.target_anchor.replace(/^seg:/, "");
  if (gotId === want) A.ok++;
  else { A.wrongAnchor++; issues.push([r.target_work, r.target_anchor, "A-search", "landed-elsewhere", q, `搜尋落在 ${gotId}`].join("\t")); }
  A.hit1++;
}
A.ms = performance.now() - t0;

/* --- 路徑 B：有 id／manifest，直接切片 --- */
const anchorOf = new Map<string, { id: string; book: string; line: number; end: number }>();
for (const [ln, v] of byLine) anchorOf.set(`${v.book}?${v.id}`, { id: v.id, book: v.book, line: ln, end: v.end });
const B = { noAnchor: 0, rangeBad: 0, mismatch: 0, ok: 0, ms: 0 };
const t1 = performance.now();
for (const r of rows) {
  const a = r.target_anchor.replace(/^char:/, "").replace(/^seg:/, "");
  let hanStr = "";
  if (r.target_work === "shuowen") {
    hanStr = charHan.get(a) ?? "";
    if (!hanStr) { B.noAnchor++; issues.push([r.target_work, r.target_anchor, "B-id", "no-such-id", r.quote_normalized, "id 不在 adb"].join("\t")); continue; }
  } else {
    const seg = anchorOf.get(`${r.target_work}?${a}`);
    if (!seg) { B.noAnchor++; issues.push([r.target_work, r.target_anchor, "B-id", "no-such-anchor", r.quote_normalized, "本區 manifest 無此 anchorId"].join("\t")); continue; }
    let raw = "";
    const hm = lines[seg.line - 1].match(/^<(?:章|節|項)[^>]*>[\s\S]*?<\/(?:章|節|項)>(.*)$/);
    if (hm) raw += hm[1];
    for (let ln = seg.line + 1; ln < seg.end; ln++) raw += lines[ln - 1];
    hanStr = (raw.replace(/<[^>]*>/g, "").match(HAN) ?? []).join("");
  }
  const x = Number(r.target_a), y = Number(r.target_b);
  if (!(x >= 0 && y > x && y <= hanStr.length)) {
    B.rangeBad++; issues.push([r.target_work, r.target_anchor, "B-id", "range-out", `${x}-${y}/${hanStr.length}`, r.quote_normalized.slice(0, 24)].join("\t"));
    continue;
  }
  if (hanStr.slice(x, y) !== r.quote_normalized) {
    B.mismatch++; issues.push([r.target_work, r.target_anchor, "B-id", "slice-differs", hanStr.slice(x, y), "≠ " + r.quote_normalized.slice(0, 24)].join("\t"));
    continue;
  }
  B.ok++;
}
B.ms = performance.now() - t1;

/* --- 索引建置成本（runtime 一次性開銷）--- */
const t2 = performance.now();
const anchorMap = new Map<string, number>();
for (const [w, idx] of bookIdx) for (let k = 0; k < idx.order.length; k++) anchorMap.set(`${w}?${byLine.get(idx.order[k])?.id}`, k);
for (const [id] of charHan) anchorMap.set(`shuowen?${id}`, -1);
const buildMs = performance.now() - t2;

const n13 = rows.filter((r) => WORKS13.has(r.target_work)).length;
const nSw = rows.filter((r) => r.target_work === "shuowen").length;
say("=== 互鏈效率驗證（同一批引用端實鏈，走兩條解析路徑）===");
say(`accepted.tsv 總列 69,838；target_work 落在 13j／shuowen 的實鏈 ${acc.length} 筆，本次跑 ${rows.length}（13j ${n13}、shuowen ${nSw}）`);
say("");
say("--- 路徑 A：13j 現況（無 segment id，只能用 quote 搜尋）---");
say(`  唯一命中並落回宣告的 anchor ：${A.ok}`);
say(`  唯一命中但落在別的段落        ：${A.wrongAnchor}`);
say(`  書內多候選（歧義，無法定址）  ：${A.hitN}`);
say(`  搜不到（dead）                ：${A.hit0}`);
say(`  總耗時 ${A.ms.toFixed(0)} ms → 每條 ${(A.ms * 1000 / Math.max(1, n13)).toFixed(1)} µs`);
say("");
say("--- 路徑 B：有 anchorId／manifest（id 直查＋切片反解）---");
say(`  anchor 存在且 a-b 反解＝quote ：${B.ok}`);
say(`  manifest 查無 anchorId        ：${B.noAnchor}`);
say(`  a-b 超出該 anchor 漢字範圍    ：${B.rangeBad}`);
say(`  切片與 quote 不符             ：${B.mismatch}`);
say(`  總耗時 ${B.ms.toFixed(0)} ms → 每條 ${(B.ms * 1000 / Math.max(1, rows.length)).toFixed(1)} µs`);
say("");
say("--- 一次性索引 ---");
say(`  anchor 表 ${anchorMap.size} 條；建置 ${buildMs.toFixed(1)} ms`);
say(`  13j：${byLine.size} 個 anchorId（本區 manifest）；shuowen：${charHan.size} 個字 id`);
say("");
say("--- 每本 work 的歧義／失配top ---");
const perWork = new Map<string, { miss: number; ambig: number; wrong: number }>();
for (const it of issues.slice(1)) {
  const c = it.split("\t");
  const rec = perWork.get(c[0]) ?? { miss: 0, ambig: 0, wrong: 0 };
  if (c[3] === "miss") rec.miss++;
  else if (c[3] === "ambiguous") rec.ambig++;
  else if (c[3] === "landed-elsewhere") rec.wrong++;
  perWork.set(c[0], rec);
}
for (const [w, v] of [...perWork].sort((a, b) => (b[1].miss + b[1].ambig) - (a[1].miss + a[1].ambig)))
  say(`  ${w}: dead ${v.miss}, 歧義 ${v.ambig}, 落錯段 ${v.wrong}`);

writeFileSync("out/link-efficiency.txt", out.join("\n") + "\n", "utf8");
writeFileSync("out/link-issues.tsv", issues.join("\n") + "\n", "utf8");
console.log(`A: ok=${A.ok} wrong=${A.wrongAnchor} ambig=${A.hitN} miss=${A.hit0} (${A.ms.toFixed(0)}ms)  B: ok=${B.ok} noAnchor=${B.noAnchor} rangeBad=${B.rangeBad} mismatch=${B.mismatch} (${B.ms.toFixed(0)}ms)`);
