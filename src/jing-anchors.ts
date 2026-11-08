/**
 * jing-anchors.ts — jing（十三經）semantic segment 的單一實作
 *
 * 規則來源（不要在別處複製同一套邏輯）：
 *   adb-converter/docs/adb/ancient-book-xref-spec.md §4.1／§4.2／§4.4
 *   cct/docs/prompts/13j.md §3（id 用原文標題、去空白、去括注；最少祖先；不得用 #N）
 *   cct/docs/text-hash-verification.md（textHash 五步正規化）
 *   cct/data/quezi-fix.tsv（缺字條件式修正：行號＋原標籤＋前後文相符才套）
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const HAN = /\p{Script=Han}/gu;
const LEVELS = ["章", "節", "項"] as const;

export const WORK: Record<string, string> = {
  周易: "yijing", 尚書: "shangshu", 毛詩: "shijing", 周禮: "zhouli", 儀禮: "yili", 禮記: "liji",
  左傳: "zuozhuan", 公羊傳: "gongyang", 穀梁傳: "guliang", 論語: "lunyu", 孝經: "xiaojing",
  爾雅: "erya", 孟子: "mengzi",
};

export type Segment = {
  book: string;            // <書 id>
  work: string;            // work id（yijing…）
  level: 0 | 1 | 2;        // 章／節／項
  label: string;           // canonical 標題（缺字已修、trim 過）
  originLabel: string;     // 原樣顯示文字（一律不改）
  line: number;            // 標題行（1-based）
  textEnd: number;         // anchor 文字尾＝下一個「任意」語意節點行（契約 §4）
  endLine: number;         // 子樹尾（同層或更淺）——只供嵌套
  residual: string;        // 標題行 </tag> 之後殘留的正文
  parent: Segment | null;
  children: Segment[];
  id: string;              // canonical anchorId
  depth: number;           // id 內層數（1＝bare）
  han: number;             // anchor 文字漢字數（code point 計，代理對＝1）
  textHash: string;        // 0 漢字 → 空字串（不寫 sha256("")）
  isLeaf: boolean;
};

/** 擷取期的內部節點（id／hash 尚未決定） */
type Raw = {
  book: string; level: 0 | 1 | 2; label: string; originLabel: string;
  line: number; textEnd: number; endLine: number; textSet: boolean; residual: string;
  parent: Raw | null; children: Raw[];
};

/** 摺疊表：Python(Windows) 寫 CRLF，必須切 \r?\n，否則每個值多帶 \r → hash 全錯 */
export function loadFold(path = "data/char-fold.tsv"): Map<string, string> {
  const m = new Map<string, string>();
  const raw = readFileSync(path, "utf8").replace(/^/, "").split(/\r?\n/);
  for (const l of raw) {
    if (!l || l.startsWith("#")) continue;
    const i = l.indexOf("\t");
    if (i < 0) continue;
    m.set(l.slice(0, i), l.slice(i + 1));
  }
  return m;
}

export function foldChars(chars: string[], fold: Map<string, string>): { n1: string; miss: number } {
  let miss = 0;
  let out = "";
  for (const c of chars) {
    const f = fold.get(c);
    if (f !== undefined) { out += f; continue; }
    miss++;
    const hm = c.normalize("NFKC").match(HAN);
    out += hm ? hm[0] : c;
  }
  return { n1: out, miss };
}

/** spec §4.4：sha256(摺疊後只含漢字的 anchor 文字)[:16]；0 漢字 → 空字串 */
export function textHashOf(chars: string[], fold: Map<string, string>): { hash: string; miss: number } {
  if (!chars.length) return { hash: "", miss: 0 };
  const { n1, miss } = foldChars(chars, fold);
  return { hash: createHash("sha256").update(n1, "utf8").digest("hex").slice(0, 16), miss };
}

export type QueziFix = { oldLabel: string; context: string; newLabel: string; note: string };
export function loadQuezi(path = "data/quezi-fix.tsv"): Map<number, QueziFix> {
  const m = new Map<number, QueziFix>();
  let raw: string;
  try { raw = readFileSync(path, "utf8").replace(/^/, ""); } catch { return m; }
  const rows = raw.split(/\r?\n/).filter((l) => l.length > 0);
  const head = rows[0].split("\t");
  for (const l of rows.slice(1)) {
    const c = l.split("\t");
    const rec: Record<string, string> = {};
    head.forEach((k, i) => { rec[k] = c[i] ?? ""; });
    m.set(Number(rec.line), { oldLabel: rec.oldLabel, context: rec.contextMustContain, newLabel: rec.newLabel, note: rec.note });
  }
  return m;
}

/** id 用原文標題：去所有空白、去括注（作者 2026-11-06 定案） */
export const idLabel = (s: string): string => s.replace(/\s+/g, "").replace(/[（(][^）)]*[）)]/g, "");

export type BuildResult = {
  segs: Segment[];
  byLine: Map<number, Segment>;
  fixApplied: string[];
  fixRejected: string[];
  defects: string[];
  foldMiss: number;
  nodes: number;
};

export function buildSegments(lines: string[], fold: Map<string, string>, quezi: Map<number, QueziFix>): BuildResult {
  const open: (Raw | null)[] = [null, null, null];
  const all: Raw[] = [];
  const fixApplied: string[] = [];
  const fixRejected: string[] = [];
  let book = "(前言)";

  lines.forEach((raw, i) => {
    const ln = i + 1;
    const bookM = raw.match(/^<書(?:\s[^>]*?)?\s+id="([^"]*)"/);
    if (bookM) {
      for (let l = 2; l >= 0; l--) if (open[l]) {
        open[l]!.endLine = ln;
        if (!open[l]!.textSet) { open[l]!.textEnd = ln; open[l]!.textSet = true; }
        open[l] = null;
      }
      book = bookM[1];
      return;
    }
    const m = raw.match(/^<(章|節|項)([^>]*)>([\s\S]*?)<\/\1>(.*)$/);
    if (!m) return;
    const level = LEVELS.indexOf(m[1]) as 0 | 1 | 2;
    // ① anchor 文字尾只設一次（第一個遇到的任意下個節點）
    for (let l = 2; l >= 0; l--) if (open[l] && !open[l]!.textSet) { open[l]!.textEnd = ln; open[l]!.textSet = true; }
    // ② 嵌套：同層＋更深層才收
    for (let l = 2; l >= level; l--) if (open[l]) { open[l]!.endLine = ln; open[l] = null; }
    const parent = level > 0 ? open[level - 1] : null;

    let label = m[3].trim();
    const originLabel = m[3];
    const fx = quezi.get(ln);
    if (fx) {
      const ctx = lines.slice(ln, ln + 2).join("");
      if (label === fx.oldLabel && ctx.includes(fx.context)) {
        label = fx.newLabel;
        fixApplied.push(`line ${ln}: 「${fx.oldLabel}」→「${fx.newLabel}」（前後文相符：${fx.context}）`);
      } else {
        fixRejected.push(`line ${ln}: 表記「${fx.oldLabel}」現為「${label}」或缺「${fx.context}」→ 不套用`);
      }
    }
    const node: Raw = {
      book, level, label, originLabel, line: ln, textEnd: lines.length, endLine: lines.length,
      textSet: false, residual: m[4] ?? "", parent, children: [],
    };
    if (parent) parent.children.push(node);
    open[level] = node;
    all.push(node);
  });
  for (let l = 2; l >= 0; l--) if (open[l]) {
    open[l]!.endLine = lines.length;
    if (!open[l]!.textSet) { open[l]!.textEnd = lines.length; open[l]!.textSet = true; }
    open[l] = null;
  }

  const anchorHan = (n: Raw): string[] => {
    let s = n.residual;
    for (let ln = n.line + 1; ln < n.textEnd; ln++) s += lines[ln - 1];
    return s.replace(/<[^>]*>/g, "").match(HAN) ?? [];
  };
  const pathOf = (n: Raw): string[] => {
    const p: string[] = [];
    for (let x: Raw | null = n; x; x = x.parent) p.unshift(idLabel(x.label));
    return p;
  };

  const defects: string[] = [];
  const segs: Segment[] = [];
  let foldMiss = 0;

  const byBook = new Map<string, Raw[]>();
  for (const n of all) (byBook.get(n.book) ?? byBook.set(n.book, []).get(n.book)!).push(n);

  for (const [b, arr] of byBook) {
    const paths = arr.map(pathOf);
    const ids = paths.map((p) => p[p.length - 1]);
    let depth = 1;
    while (true) {
      const cnt = new Map<string, number>();
      ids.forEach((s) => cnt.set(s, (cnt.get(s) ?? 0) + 1));
      const clash = arr.filter((_, k) => (cnt.get(ids[k]) ?? 0) > 1);
      if (!clash.length) break;
      const maxDepth = Math.min(...clash.map((n) => pathOf(n).length));
      if (depth >= maxDepth) break;
      for (let k = 0; k < ids.length; k++)
        if ((cnt.get(ids[k]) ?? 0) > 1) ids[k] = paths[k].slice(paths[k].length - 1 - depth).join("/");
      depth++;
    }
    const cnt2 = new Map<string, number>();
    ids.forEach((s) => cnt2.set(s, (cnt2.get(s) ?? 0) + 1));
    arr.forEach((n, k) => {
      if ((cnt2.get(ids[k]) ?? 0) > 1) {
        defects.push(`${WORK[b] ?? "?"}?${ids[k]}（line ${n.line}「${n.label}」）：加到根仍同名 ×${cnt2.get(ids[k])}`);
        return;                     // 契約：不編 #N
      }
      const chars = anchorHan(n);
      const th = textHashOf(chars, fold);
      foldMiss += th.miss;
      segs.push({
        book: b, work: WORK[b] ?? `?${b}`, level: n.level, label: n.label, originLabel: n.originLabel,
        line: n.line, textEnd: n.textEnd, endLine: n.endLine, residual: n.residual,
        parent: null, children: [], id: ids[k], depth: ids[k].split("/").length,
        han: chars.length, textHash: th.hash, isLeaf: n.children.length === 0,
      });
    });
  }
  const byLine = new Map<number, Segment>();
  for (const s of segs) byLine.set(s.line, s);
  return { segs, byLine, fixApplied, fixRejected, defects, foldMiss, nodes: all.length };
}

/** 只把 id 插進標題行；其餘字元一律不動 */
export function patchLines(lines: string[], byLine: Map<number, Segment>): { out: string[]; patched: number; skipped: string[] } {
  const out = [...lines];
  const skipped: string[] = [];
  let patched = 0;
  for (const [ln, seg] of byLine) {
    const raw = out[ln - 1];
    const m = raw.match(/^<(章|節|項)([^>]*)>([\s\S]*)$/);
    if (!m) { skipped.push(`line ${ln}: 標題行格式不符`); continue; }
    if (/\bid="/.test(m[2])) { skipped.push(`line ${ln}: 已有 id，不重複插`); continue; }
    out[ln - 1] = `<${m[1]} id="${seg.id}"${m[2]}>${m[3]}`;
    patched++;
  }
  return { out, patched, skipped };
}

/** 去標籤後的文字（驗收用：新舊必須逐行相同） */
export const stripTags = (s: string): string => s.replace(/<[^>]*>/g, "");
