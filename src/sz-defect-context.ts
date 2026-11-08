/**
 * sz-defect-context.ts — 抽出「字頭有缺陷」的字條連前後文，供逐條查證真字
 *   bun run src/sz-defect-context.ts
 *
 * 判別：字頭碼點數 >1、含（）、含 IDS、含 U+FFFD。
 * 前後文取 swjzz 的體例區塊（說文／說文異／段注），因為它比 swjz 乾淨（zone 已分開）。
 * 輸出：out/shuowen-defects-context.txt（UTF-8，給人或網路查證用）
 */
import { readFileSync, writeFileSync } from "node:fs";

const lines = readFileSync("out/swjzz.xml", "utf8").split(/\r?\n/);
const rows = readFileSync("out/swjzz-char.tsv", "utf8").split(/\r?\n/).filter((l) => l.length > 0);
const cols = rows[0].split("\t");
type Char = Record<string, string>;
const chars: Char[] = rows.slice(1).map((l) => {
  const c = l.split("\t"); const r: Record<string, string> = {};
  cols.forEach((k, i) => { r[k] = c[i] ?? ""; });
  return r;
});

const IDS = /[\u2ff0-\u2ffb]/;
const bad = chars.filter((c) => {
  const h = c.head;
  return [...h].length > 1 || h.includes("\ufffd") || IDS.test(h) || /[（(]/.test(h);
});

// 依 charId 找它的字條正文（到下一個 <字 為止）
const starts = new Map<string, number>();
for (const c of chars) starts.set(c.charId, Number(c.line));
function bodyOf(id: string, max = 6): string[] {
  const st = starts.get(id)!;
  const out: string[] = [];
  for (let ln = st + 1; ln < lines.length && out.length < max; ln++) {
    const l = lines[ln - 1];
    if (/<字[^>]*\sid="w\d{7}"/.test(l) || /^<部[ >]/.test(l) || /^<部數/.test(l)) break;
    const t = l.trim();
    if (!t) continue;
    out.push(t.replace(/<構形>[\s\S]*?<\/構形>/g, "〔$&〕").slice(0, 150));
  }
  return out;
}

const out: string[] = [`=== 說文解字注 字頭缺陷 ${bad.length} 筆（來源 swjzz 交付版）===`, ""];
bad.forEach((c, i) => {
  const cp = [...c.head].map((x) => "U+" + x.codePointAt(0)!.toString(16).toUpperCase()).join(" ");
  out.push(`【${i + 1}】${c.charId}  現字頭=「${c.head}」`);
  out.push(`   码点 ${cp}`);
  out.push(`   部「${c.bu}」  卷 ${c.juan}  行 ${c.line}  img="${c.img}"  该字條 ${c.hanCount} 漢字、${c.zoneBlocks} 個例`);
  const b = bodyOf(c.charId);
  for (const l of b) out.push(`   │ ${l}`);
  out.push("");
});

writeFileSync("out/shuowen-defects-context.txt", out.join("\n") + "\n", "utf8");
console.log(`defective heads=${bad.length}`);
