/**
 * build-swjz.ts — 修 swjz 的兩處標記缺陷（照 swjzz 既有慣例，不自創格式）
 *
 *   bun run src/build-swjz.ts
 *
 * ① 書末部首附錄 540 筆 `<part_word><字>X</字>部Y</part_word>`
 *    → `<part_word><部目 n="N">X</部目>部Y</part_word>`（swjzz 慣例＝<部目 n="1">一</部目>）
 *    後果：`<樹 s="$字">` 不再混入 540 筆不可定位的重複字頭。
 * ② 字頭混入構形描述 `荒(⿱艹㠩)` → `<字 …>荒</字><構形>⿱艹㠩</構形>`（swjzz 慣例＝<構形>）
 *    純 IDS 字頭（例「⿰金⿱丣刀」）與 U+FFFD 字頭**不動**，只回報。
 *
 * 其餘一字不動。VA 會因新增標籤而位移（標籤固定 4 VA），位移量在報告裡算出來。
 * 輸出：out/swjz.new.xml、out/swjz-build.txt
 */
import { readFileSync, writeFileSync } from "node:fs";

const lines = readFileSync("out/swjz.xml", "utf8").split(/\r?\n/);
const out = [...lines];
const rep: string[] = [];
const say = (s: string): void => { rep.push(s); };

/* ---------- ① 附錄 <字> → <部目 n> ---------- */
let buSeq = 0;
const buApplied: string[] = [];
for (let i = 0; i < out.length; i++) {
  const raw = out[i];
  if (!/<part_word>/.test(raw)) continue;
  const m = raw.match(/<字(?![^>]*\s+id=")([^>]*)>([\s\S]*?)<\/字>/);
  if (!m) continue;
  buSeq++;
  const replaced = raw.replace(/<字([^>]*)>([\s\S]*?)<\/字>/, `<部目 n="${buSeq}">$2</部目>`);
  out[i] = replaced;
  buApplied.push(`line ${i + 1}: <字>${m[2]}</字> → <部目 n="${buSeq}">${m[2]}</部目>`);
}

/* ---------- ② 字頭的 (IDS…) 拆到 <構形> ---------- */
type Head = { id: string; head: string; line: number };
const heads: Head[] = [];
for (let i = 0; i < out.length; i++) {
  const m = out[i].match(/<字([^>]*\sid="(w\d{7})"[^>]*)>([\s\S]*?)<\/字>/);
  if (m) heads.push({ id: m[2], head: m[3], line: i + 1 });
}
const splitDone: string[] = [];
const splitSkipped: string[] = [];
for (const h of heads) {
  const cp = [...h.head];
  if (cp.length < 2) continue;
  const pm = h.head.match(/^(.*?)[（(]([^（）()]+)[)）]$/);
  const isIds = (c: string): boolean => { const x = c.codePointAt(0)!; return x >= 0x2ff0 && x <= 0x2ffb; };
  const isPlaceholder = /图\s*\d/.test(h.head) || h.head.includes("\uFFFD")
    || h.head.includes("\u25cf") || h.head.includes("\u25a1");
  const base = pm ? pm[1] : cp[0];
  const rest = pm ? pm[2] : cp.slice(1).join("");
  if (!base || isIds(base)) {
    splitSkipped.push(`line ${h.line} ${h.id}「${h.head}」：${isIds(base ?? "") ? "字頭以 IDS 構形符起頭（無小篆本字可拆）" : "無字頭本體"} → 不動，待來源查證`);
    continue;
  }
  if (isPlaceholder) {
    splitSkipped.push(`line ${h.line} ${h.id}「${h.head}」：字頭是圖號／佔位（形體只在書影上）→ 不動，待來源查證`);
    continue;
  }
  const raw = out[h.line - 1];
  const rebuilt = raw.replace(/<字([^>]*\sid="w\d{7}"[^>]*)>[\s\S]*?<\/字>/,
    `<字$1>${base}</字><構形>${rest}</構形>`);
  out[h.line - 1] = rebuilt;
  splitDone.push(`line ${h.line} ${h.id}: 「${h.head}」→ 字頭「${base}」＋<構形>${rest}</構形>`);
}

/* ---------- 驗收 ---------- */
const HAN = /\p{Script=Han}/gu;
const charsOld = new Set<string>();
const charsNew = new Set<string>();
for (let i = 0; i < lines.length; i++) for (const m of lines[i].matchAll(/<字[^>]*\s+id="(w\d{7})"/g)) charsOld.add(m[1]);
for (let i = 0; i < out.length; i++) for (const m of out[i].matchAll(/<字[^>]*\s+id="(w\d{7})"/g)) charsNew.add(m[1]);

// 去標籤後的文字：只應差在 ① 部目行的「部Y」計數文字不变、② 構形括號內容位置改變
const strip = (s: string): string => s.replace(/<[^>]*>/g, "");
let textSame = 0;
const textDiffRows: string[] = [];
for (let i = 0; i < lines.length; i++) {
  const a = strip(lines[i]), b = strip(out[i]);
  if (a === b) textSame++;
  else if (textDiffRows.length < 8) textDiffRows.push(`line ${i + 1}: ${a.slice(0, 34)}  →  ${b.slice(0, 34)}`);
}

// 新增標籤 → VA 位移量（每個開／閉標籤各 4）
const tagsAdded = (s: string, tag: string): number =>
  (s.match(new RegExp(`<${tag}[\\s>]`, "g")) ?? []).length + (s.match(new RegExp(`</${tag}>`, "g")) ?? []).length;
const newTags = out.reduce((n, l, i) => n + tagsAdded(l, "部目") + tagsAdded(l, "構形")
  - tagsAdded(lines[i].replace(/<部目[\s>][\s\S]*?<\/部目>/g, ""), "部目") - tagsAdded(lines[i], "構形"), 0);

const orphanOld = lines.reduce((n, l) => n + [...l.matchAll(/<字(?![^>]*\s+id=")/g)].length, 0);
const orphanNew = out.reduce((n, l) => n + [...l.matchAll(/<字(?![^>]*\s+id=")/g)].length, 0);
const buNew = out.reduce((n, l) => n + (l.match(/<部目\s/g) ?? []).length, 0);

say("=== build-swjz（標記修正）===");
say(`① 附錄轉換 <字>→<部目 n>：${buSeq} 筆（期望 540）`);
say(`   無 id 的 <字>：舊 ${orphanOld} → 新 ${orphanNew}`);
say(`   新 <部目> 標籤數：${buNew}`);
say(`② 字頭拆構形：${splitDone.length} 條；跳過 ${splitSkipped.length} 條`);
for (const s of splitDone.slice(0, 6)) say(`   OK ${s}`);
if (splitDone.length > 6) say(`   ...（共 ${splitDone.length}，全表見 out/swjz-build.txt 末段）`);
for (const s of splitSkipped) say(`   SKIP ${s}`);
say("");
say(`字 id 集合：舊 ${charsOld.size} → 新 ${charsNew.size}；相同=${[...charsOld].every((c) => charsNew.has(c)) && charsOld.size === charsNew.size}`);
say(`行數：舊 ${lines.length} → 新 ${out.length}（同一行只加標籤，不拆行）`);
say(`去標籤後文字未變的行：${textSame}/${lines.length}（變 ${lines.length - textSame} 行，全在字頭行：括號移到 <構形>）`);
for (const s of textDiffRows) say(`   ${s}`);
say(`新增標籤邊界共 ${newTags} 個 → 預估 VA 位移 ${newTags * 4}（標籤各佔 4 VA）`);
say("");
say("=== 明細：① 附錄（前 5 筆）===");
for (const s of buApplied.slice(0, 5)) say(`   ${s}`);
say("=== 明細：② 字頭（全部）===");
for (const s of splitDone) say(`   ${s}`);

writeFileSync("out/swjz.new.xml", out.join("\n"), "utf8");
writeFileSync("out/swjz-build.txt", rep.join("\n") + "\n", "utf8");
console.log(`部目=${buSeq} 構形拆出=${splitDone.length} 跳過=${splitSkipped.length} 無id字 ${orphanOld}→${orphanNew} 字id=${charsNew.size} VA預估+${newTags * 4}`);
