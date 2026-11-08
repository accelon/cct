/**
 * link-swjzz-to-jing.ts — 從 swjzz 段注／說文的引經句，產 `xout_<workId>` records
 *
 *   bun run src/link-swjzz-to-jing.ts [--min-han 8] [--limit 0]
 *
 * 流程（依 ancient-book-xref-spec.md §6／§7 與 prompts/00-common.md §4）：
 *   1) 用 jing-anchors.ts（jing 的單一實作）建 13 work 的 anchor 漢字流＋錨點歸屬
 *   2) 掃 swjzz 的字條與「例」（說文／說文異／段注），抓「詩云／《書》曰／周禮／左傳…」句式
 *   3) 摺疊後空間找最长連绩匹配 → 回 anchorId＋raw 漢字序 a-b
 *      （摺疊是逐字 1→1，長度不變，所以折疊索引＝原始索引）
 *   4) gate：anchor 必須在 manifest；帶 targetTextHash；不符或缺失進 unresolved，不寫正式 xout
 *
 * 產出：out/xout_<work>.jsonl（每 work 一桶）、out/link-unresolved.tsv、out/link-jing-report.txt
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { buildSegments, foldChars, idLabel, loadFold, loadQuezi, WORK } from "./jing-anchors.ts";

const MIN_HAN = Number(process.argv.includes("--min-han") ? process.argv[process.argv.indexOf("--min-han") + 1] : 8);
const LIMIT = Number(process.argv.includes("--limit") ? process.argv[process.argv.indexOf("--limit") + 1] : 0);

const HAN = /\p{Script=Han}/gu;
const rawHan = (s: string): string[] => s.replace(/<[^>]*>/g, "").match(HAN) ?? [];

/* ---------- 1) jing 錨點索引 ---------- */
const jingLines = readFileSync("out/jing.xml", "utf8").split(/\r?\n/);
const fold = loadFold();
const { segs, defects, foldMiss } = buildSegments(jingLines, fold, loadQuezi());
const segByLine = new Map<number, typeof segs[number]>();
for (const s of segs) segByLine.set(s.line, s);

type Bucket = { work: string; folded: string; owner: Int32Array; anchors: Map<number, { id: string; start: number; end: number; hash: string; han: number }> };
const buckets = new Map<string, Bucket>();
for (const s of segs) {
  if (!s.work || s.work.startsWith("?")) continue;
  const b = buckets.get(s.work) ?? { work: s.work, folded: "", owner: new Int32Array(0), anchors: new Map() };
  const chars: string[] = [];
  let body = s.residual;
  for (let ln = s.line + 1; ln < s.textEnd; ln++) body += "\n" + jingLines[ln - 1];
  chars.push(...rawHan(body));
  const start = b.folded.length;
  b.folded += foldChars(chars, fold).n1;
  b.anchors.set(s.line, { id: s.id, start, end: b.folded.length, hash: s.textHash, han: chars.length });
  buckets.set(s.work, b);
}
for (const b of buckets.values()) {
  const own: number[] = [];
  for (const [, a] of b.anchors) for (let k = a.start; k < a.end; k++) own.push(k);
  // owner 用 anchor 起點索引表示；用陣列比對較慢，改以區間二分
  b.owner = Int32Array.from(own);
}
// anchor 起點排序，供二分
const sortedAnchors = new Map<string, { id: string; start: number; end: number; hash: string }[]>();
for (const [w, b] of buckets)
  sortedAnchors.set(w, [...b.anchors.values()].sort((x, y) => x.start - y.start));

function anchorAt(w: string, pos: number): { id: string; start: number; end: number; hash: string } | null {
  const arr = sortedAnchors.get(w) ?? [];
  let lo = 0, hi = arr.length - 1, best: number | null = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid].start <= pos) { best = mid; lo = mid + 1; } else hi = mid - 1;
  }
  if (best === null) return null;
  const a = arr[best];
  return pos >= a.start && pos < a.end ? a : null;
}

/* ---------- 2) swjzz 引書句式 ---------- */
const BOOK2WORK: [RegExp, string][] = [
  [/詩|毛詩|國風|大小雅|二南/, "shijing"],
  [/尚書|書經|^書/, "shangshu"],
  [/易經|周易|^易/, "yijing"],
  [/周禮|周官/, "zhouli"],
  [/儀禮/, "yili"],
  [/禮記|曲禮|檀弓|王制|祭統|內則|曾子問|月令|學記|樂記|中庸|緇衣/, "liji"],
  [/左傳|左氏|春秋傳|^春秋$/, "zuozhuan"],
  [/公羊/, "gongyang"],
  [/穀梁|谷梁/, "guliang"],
  [/論語/, "lunyu"],
  [/孟子/, "mengzi"],
  [/孝經/, "xiaojing"],
  [/爾雅|^雅$/, "erya"],                     // 段注慣例：「雅曰」＝爾雅曰（若是大雅／小雅會先被上面收掉）
];
const CUE = /(?:《([^》]{1,8})》|((?:毛詩|尚書|禮記|周禮|儀禮|左氏|左傳|公羊|穀梁|谷梁|論語|孟子|孝經|爾雅|春秋|國風|大小雅|檀弓|曲禮|王制|祭統|內則|月令|學記|中庸|緇衣|曾子問|易|詩|書|禮|雅)))(?:之[一二三]?)?\s*(?:云|曰|言|道|稱)(?=[。：、，！？”』\s]|$)/g;
const NOT_BOOKS = /^(說文|徐曰|鍇曰|鉉|廣雅|釋詁|釋言|釋訓|釋器|釋天|方言|通俗文|爾雅注|本艸|史記|漢書|後漢書|三國志|周書|尚書大傳|韓詩|魯詩|毛傳|鄭箋|儀禮傳)/;

const swjzLines = readFileSync("out/swjzz.xml", "utf8").split(/\r?\n/);
const ZONE_RE = /^<(說文異|說文|段注|構形|篆|注)(?=[\s>])([^>]*)>([\s\S]*?)<\/\1>$/;
const HEAD_RE = /<字([^>]*\sid="(w\d{7})"[^>]*)>([\s\S]*?)<\/字>/;

type Zone = { charId: string; tag: string; text: string };
const zones: Zone[] = [];
{
  let cid = "";
  let cur: Zone | null = null;
  let openTag = "";
  for (let i = 0; i < swjzLines.length; i++) {
    const raw = swjzLines[i].trim();
    const hm = raw.match(HEAD_RE);
    if (hm) {
      if (cur) { zones.push(cur); cur = null; openTag = ""; }
      cid = hm[2];
      continue;
    }
    const zm = raw.match(ZONE_RE);
    if (zm) {
      if (cur) zones.push(cur);
      cur = { charId: cid, tag: zm[1], text: zm[3] };
      openTag = zm[1];
      continue;
    }
    if (cur && openTag === "說文異" || cur && openTag === "說文" || cur && openTag === "段注") {
      if (raw && !/^</.test(raw)) cur.text += raw;                        // 罕見：續行
    }
  }
  if (cur) zones.push(cur);
}

/* ---------- 3) 解析 ---------- */
type Link = {
  sourceAnchor: string; sourceA: number; sourceB: number; quote: string;
  targetWork: string; targetAnchor: string; targetA: number; targetB: number;
  targetTextHash: string; kind: string; confidence: number; titleRaw: string;
};
const links: Link[] = [];
const unresolved: string[] = ["charId\ttitle\thandle\tquote\treason"];
const stat = { cues: 0, resolved: 0, ambiguous: 0, noAnchor: 0, hashMismatch: 0, dead: 0, noBook: 0, tooShort: 0, srcMiss: 0, prefixMatch: 0 };

// 字條漢字串（算 source 端 a-b）
const charHan = new Map<string, string>();
{
  const starts: { id: string; line: number }[] = [];
  swjzLines.forEach((l, i) => { const m = l.match(HEAD_RE); if (m) starts.push({ id: m[2], line: i + 1 }); });
  starts.forEach((s, k) => {
    const end = k + 1 < starts.length ? starts[k + 1].line : swjzLines.length;
    let acc = "";
    for (let ln = s.line - 1; ln < end - 1; ln++) acc += rawHan(swjzLines[ln]).join("");
    charHan.set(s.id, acc);
  });
}

for (const z of zones) {
  const zt = z.text.replace(/<[^>]*>/g, "");
  for (const m of zt.matchAll(CUE)) {
    const title = m[1] ?? m[2] ?? "";
    if (!title || NOT_BOOKS.test(title)) continue;
    const work = BOOK2WORK.find(([re]) => re.test(title))?.[1];
    if (!work) { stat.noBook++; unresolved.push([z.charId, title, "", "", "書名無法對應 work"].join("\t")); continue; }
    // 段注是句讀體：「詩云。旣伯旣禱。」→ 要先跳過句讀號再取下一句
    const rest = zt.slice((m.index ?? 0) + m[0].length).replace(/^[。：、，；！？\s「『“”『』]+/, "");
    let quote = rest.split(/[。；！？]/)[0] ?? "";
    quote = quote.replace(/^[，、\s「『“”『』]+/, "").slice(0, 60);
    const qchars = rawHan(quote);
    if (qchars.length < 4) { stat.tooShort++; continue; }
    stat.cues++;

    const b = buckets.get(work);
    if (!b) { stat.noAnchor++; continue; }
    const qf = foldChars(qchars, fold).n1;
    let pos = b.folded.indexOf(qf);
    // 整句找不到 → 退而求「最長前綴」：異文常在後半段（spec §7.5 取最小範圍）
    if (pos < 0) {
      let lo = 0;
      for (let n = Math.min(qf.length, 60); n >= MIN_HAN; n--) {
        const p = b.folded.indexOf(qf.slice(0, n));
        if (p >= 0) { lo = n; pos = p; break; }
      }
      if (!lo) {
        stat.dead++;
        unresolved.push([z.charId, title, work, qchars.join("").slice(0, 24), "連 " + MIN_HAN + " 字前綴都找不到（可能是注疏文字、他書引文或異文過大）"].join("\t"));
        continue;
      }
      stat.prefixMatch++;
      qchars.length = lo;                                   // 只保留實際對上的範圍
      quote = qchars.join("");
    }
    const finalQf = foldChars(qchars, fold).n1;
    const hits = [pos];
    for (let k = b.folded.indexOf(finalQf, pos + 1); k >= 0 && hits.length < 5; k = b.folded.indexOf(finalQf, k + 1)) hits.push(k);
    if (hits.length > 1) stat.ambiguous++;
    const a = anchorAt(work, hits[0]);
    if (!a) { stat.noAnchor++; continue; }
    const rel = hits[0] - a.start;
    const conf = Math.min(100, Math.round(60 + Math.min(40, qchars.length)));
    // source 端 a-b：在該字條漢字串裡原樣定位引文（同一引文重複出現時取第一個）
    const src = charHan.get(z.charId) ?? "";
    const sa = src.indexOf(qchars.join(""));
    links.push({
      sourceAnchor: `char:${z.charId}`,
      sourceA: sa, sourceB: sa >= 0 ? sa + qchars.length : 0,
      quote: qchars.join("").slice(0, 240),
      targetWork: work, targetAnchor: `seg:${idLabel(a.id)}`,
      targetA: rel, targetB: rel + qchars.length,
      targetTextHash: a.hash, kind: qchars.length >= 8 ? "quote" : "mention",
      confidence: qchars.length >= MIN_HAN ? conf : Math.min(40, conf), titleRaw: title,
    });
    stat.resolved++;
    if (sa < 0) stat.srcMiss++;
    if (LIMIT && links.length >= LIMIT) break;
  }
}

/* ---------- 4) 輸出 xout 桶 ---------- */
const byWork = new Map<string, Link[]>();
for (const l of links) (byWork.get(l.targetWork) ?? byWork.set(l.targetWork, []).get(l.targetWork)!).push(l);
const files: string[] = [];
for (const [w, arr] of byWork) {
  const manifestHash = createHash("sha256").update(
    [...(buckets.get(w)?.anchors.values() ?? [])].map((x) => `${x.id}\t${x.hash}`).join("\n"), "utf8").digest("hex").slice(0, 16);
  const lines = [JSON.stringify(["XOUT1", w, arr.length, `sha256:${manifestHash}`, "swjzz"])];
  for (const l of arr)
    lines.push(JSON.stringify([l.sourceAnchor, -1, l.sourceA, l.sourceB, l.targetAnchor, l.targetA, l.targetB, l.quote, l.kind, l.confidence, l.targetTextHash]));
  writeFileSync(`out/xout_${w}.jsonl`, lines.join("\n") + "\n", "utf8");
  files.push(`out/xout_${w}.jsonl  ${arr.length} 筆`);
}

const rep = [
  "=== swjzz → jing 互鏈產出 ===",
  `jing anchor：${segs.length} 個（缺陷 ${defects.length}）；13 work 漢字流總長 ${[...buckets.values()].reduce((n, b) => n + b.folded.length, 0).toLocaleString()}`,
  `swjzz 掃描：字條 ${charHan.size}、例區塊 ${zones.length}；引書句式命中 ${stat.cues}`,
  `解析成功 ${stat.resolved}｜來源端定位失敗 ${stat.srcMiss}｜引文過短 ${stat.tooShort}｜書名無法對應 ${stat.noBook}｜找不到引文 ${stat.dead}｜多候選 ${stat.ambiguous}｜anchor 查無 ${stat.noAnchor}`,
  `textHash 查表 miss ${foldMiss}`,
  "",
  "各桶：", ...files,
  "",
  "樣本（前 6 筆）：",
  ...links.slice(0, 6).map((l) => `  ${l.sourceAnchor} → ${l.targetWork}?${l.targetAnchor}#${l.targetA}-${l.targetB}  conf ${l.confidence}  「${l.quote.slice(0, 26)}」`),
].join("\n") + "\n";
writeFileSync("out/link-jing-report.txt", rep, "utf8");
writeFileSync("out/link-unresolved.tsv", unresolved.join("\n") + "\n", "utf8");
console.log(`cues=${stat.cues} resolved=${stat.resolved} noBook=${stat.noBook} dead=${stat.dead} ambiguous=${stat.ambiguous} 桶=${files.length}`);
