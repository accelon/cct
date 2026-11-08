/**
 * glyph-forms.ts — swjz 字頭有幾種「字形」表述，全部量化
 *   bun run src/glyph-forms.ts [xml]      預設 out/swjz.xml
 *
 * 一個字條可能同時帶：
 *   ① 正篆（`<字>` 的字頭本體）
 *   ② 重文序號（id 末位 ≠ 0；同部同序、只有末位不同）
 *   ③ 體類標記（古文／籒文／篆文／或體／俗體／奇字…寫在緊接的 `<粗>` 裡）
 *   ④ 被引用的本字（「古文一。」→ 本字＝一）
 *   ⑤ 行內篆體 `<seal_script>`（說解中特別標出的古文字形）
 *   ⑥ 圖號 `img="NNNa-NN"`（篆圖，不在 adb 內）
 *   ⑦ 構形描述（从某、某聲、⿰IDS）
 *   ⑧ 缺字／佔位（？●□、PUA、IDS）
 *
 * 產出：out/swjz-glyphs.tsv（逐字條）、out/swjz-glyphs.txt（統計）
 */
import { readFileSync, writeFileSync } from "node:fs";

const xmlPath = process.argv[2] ?? "out/swjz.xml";
const lines = readFileSync(xmlPath, "utf8").split("\n");

const RANGES: [string, number, number][] = [
  ["CJK基本", 0x4e00, 0x9fff],
  ["Ext-A", 0x3400, 0x4dbf],
  ["Compat", 0xf900, 0xfaff],
  ["Ext-B", 0x20000, 0x2a6df],
  ["Ext-C", 0x2a700, 0x2b738],
  ["Ext-D", 0x2b740, 0x2b8df],
  ["Ext-E", 0x2b8f0, 0x2ceaf],
  ["Ext-F", 0x2ceb0, 0x2ebe0],
  ["Ext-G", 0x30000, 0x3134a],
  ["Compat表意(U+2F800)", 0x2f800, 0x2fa1f],
  ["PUA私用區", 0xe000, 0xf8ff],
  ["IDS構形符", 0x2ff0, 0x2ffb],
  ["全形問號(缺字佔位)", 0xff1f, 0xff1f],
  ["Replacement(解碼失敗)", 0xfffd, 0xfffd],
  ["全形括號(非字頭)", 0xff08, 0xff09],
];
const plane = (c: string): string => {
  const x = c.codePointAt(0) ?? 0;
  for (const [n, a, b] of RANGES) if (x >= a && x <= b) return n;
  return `U+${x.toString(16).toUpperCase()}`;
};

const STYLE_RE = /(古文|籒文|篆文|或體|或曰|俗體|奇字|今文|故書|正篆|隷書|隸書|小篆|大篆|奇字|古字|俗字|本字|或作|作某)/;
const lemmaRe = /^(古文|籒文|篆文|奇字|或體|俗體|今文)\s*(\S)/;

type Row = {
  id: string; img: string; head: string; line: number; headPlane: string;
  rv: string; style: string; lemma: string; seal: 0 | 1; ids: 0 | 1; placeholder: string;
  cong: 0 | 1;
};

const rows: Row[] = [];
const entryStart: number[] = [];
lines.forEach((raw, i) => { if (/<字\s+id="w\d{7}"/.test(raw)) entryStart.push(i); });

/** 依码点取分類（不可用 charAt，星體字會被拆成半個代理對） */
const firstCp = (s: string): string => { const a = [...s]; return a.length ? a[0] : ""; };
const isPlaceholderCp = (x: number): boolean =>
  x === 0xff1f || x === 0x25cf || x === 0x25a1 || (x >= 0xe000 && x <= 0xf8ff);

lines.forEach((raw, i) => {
  const m = raw.match(/<字([^>]*)>([\s\S]*?)<\/字>/);
  if (!m || !/\sid="w\d{7}"/.test(m[1])) return;
  const id = m[1].match(/id="(w\d{7})"/)![1];
  const img = m[1].match(/img="([^"]*)"/)?.[1] ?? "";
  const head = m[2];

  // 本字條範圍：到下一個 `<字 id>` 為止
  const nxt = entryStart.find((k) => k > i) ?? lines.length;
  const body = lines.slice(i + 1, nxt).join("\n").replace(/<[^>]*>/g, "");
  const firstBold = (lines.slice(i + 1, nxt).join("\n").match(/<粗>([\s\S]*?)<\/粗>/) ?? [, ""])[1];

  const styleM = firstBold.match(lemmaRe);
  const rv = id.slice(7);
  const ph = [...new Set([...(head + body)].filter((c) => isPlaceholderCp(c.codePointAt(0)!)))];
  rows.push({
    id, img, head, line: i + 1, headPlane: plane(firstCp(head)), rv,
    style: styleM ? styleM[1] : (STYLE_RE.test(firstBold) ? "內文提及" : ""),
    lemma: styleM ? styleM[2] : "",
    seal: /<seal_script>/.test(lines.slice(i, nxt).join("\n")) ? 1 : 0,
    ids: /⿰|⿱|⿲|⿳|⿴|⿵|⿶|⿷|⿸|⿹|⿺|⿻/.test(head + body) ? 1 : 0,
    placeholder: ph.join(""),
    cong: /从/.test(body) ? 1 : 0,
  });
});

const count = <T,>(arr: T[], f: (x: T) => string): Map<string, number> => {
  const m = new Map<string, number>();
  for (const x of arr) { const k = f(x); m.set(k, (m.get(k) ?? 0) + 1); }
  return m;
};

const out: string[] = [];
const say = (s = ""): void => { out.push(s); };

say(`=== swjz 字條：${rows.length} 條（來源 ${xmlPath}）===`);
say("");
say("--- ① 字頭本體的字形層級（码点平面）---");
for (const [k, n] of [...count(rows, (r) => r.headPlane)].sort((a, b) => b[1] - a[1]))
  say(`  ${k}: ${n}${k !== "CJK基本" ? " ← 依賴字型／可能顯示為 □" : ""}`);
say(`  字頭字數分佈: ${[...count(rows, (r) => String([...r.head].length))].map(([k, n]) => `${k}字=${n}`).join(", ")}`);

say("");
say("--- ② 重文（id 末位）---");
say(`  末位=0（正篆本條）: ${rows.filter((r) => r.rv === "0").length}`);
say(`  末位>0（重文）    : ${rows.filter((r) => r.rv !== "0").length}`);
say(`  末位分佈: ${[...count(rows.filter((r) => r.rv !== "0"), (r) => r.rv)].sort().map(([k, n]) => `${k}→${n}`).join(", ")}`);

say("");
say("--- ③ 體類標記（字條第一條 `<粗>` 起首）---");
for (const [k, n] of [...count(rows.filter((r) => r.style && r.style !== "內文提及"), (r) => r.style)].sort((a, b) => b[1] - a[1]))
  say(`  ${k}: ${n}`);
say(`  標記不足、只在內文提到體類詞: ${rows.filter((r) => r.style === "內文提及").length}`);
say(`  無任何體類標記: ${rows.filter((r) => !r.style).length}`);

say("");
say("--- ④ 重文→本字 可对上的（「古文一。」型）---");
const withLemma = rows.filter((r) => r.lemma);
say(`  可擷取本字: ${withLemma.length}`);
const lemmaExists = new Set(rows.map((r) => r.head));
say(`  本字確實另有字條: ${withLemma.filter((r) => lemmaExists.has(r.lemma)).length}`);
say(`  本字查無字條（引用了不在書中的形體）: ${withLemma.filter((r) => !lemmaExists.has(r.lemma)).length}`);
say(`  例: ${withLemma.slice(0, 8).map((r) => `${r.head}←${r.style}${r.lemma}`).join(" | ")}`);

say("");
say("--- ⑤ 行內篆體 `<seal_script>` ---");
const seal = rows.filter((r) => r.seal);
say(`  含 seal_script 的字條: ${seal.length}（標籤總次數 185）`);
say(`  例: ${seal.slice(0, 5).map((r) => `${r.id}(${r.head})`).join(" ")}`);

say("");
say("--- ⑥ 圖號 img（篆圖形體）---");
say(`  有 img: ${rows.filter((r) => r.img).length}；img="nil": ${rows.filter((r) => r.img === "nil").length}；img 空: ${rows.filter((r) => !r.img).length}`);
say(`  a/b 冊分佈: a=${rows.filter((r) => /a-/.test(r.img)).length}, b=${rows.filter((r) => /b-/.test(r.img)).length}`);
say(`  → resources 容器只有 logo，图形实际不在 adb 内（見 docs/link-efficiency §4）`);

say("");
say("--- ⑦ 構形描述與 IDS ---");
say(`  正文含「从…」說形: ${rows.filter((r) => r.cong).length}`);
say(`  含 IDS 構形符（⿰⿱…）: ${rows.filter((r) => r.ids).length}`);

say("");
say("--- ⑧ 缺字／佔位符（？●□ 與 PUA）---");
const ph = rows.filter((r) => r.placeholder);
say(`  含佔位符的字條: ${ph.length}`);
for (const [k, n] of [...count(ph, (r) => r.placeholder)].sort((a, b) => b[1] - a[1]).slice(0, 10))
  say(`    ${k}: ${n}`);
say(`  其中字頭本身就是佔位符/PUA: ${rows.filter((r) => r.placeholder && /？●□/.test(r.head)).length}`);

// 同形字頭（同一字形多條）
say("");
say("--- ⑨ 同一字形多個字條（同形字）---");
const byHead = new Map<string, Row[]>();
for (const r of rows) (byHead.get(r.head) ?? byHead.set(r.head, []).get(r.head)!).push(r);
const dup = [...byHead].filter(([, v]) => v.length > 1);
say(`  不同字頭字串: ${byHead.size}；重複字頭: ${dup.length} 組、涉及 ${dup.reduce((n, [, v]) => n + v.length, 0)} 條`);
for (const [h, v] of dup.sort((a, b) => b[1].length - a[1].length).slice(0, 12))
  say(`    「${h}」×${v.length}: ${v.map((r) => `${r.id}${r.rv !== "0" ? "(重文" + r.rv + ")" : ""}`).join(" ")}`);

// 自檢：非「CJK基本」的字頭，把原始行直接寫進檔案，避免終端 CJK 亂碼誤判
const exotic = rows.filter((r) => r.headPlane !== "CJK基本");
const chk: string[] = [`非基本平面／特殊字頭共 ${exotic.length} 條`];
for (const r of exotic.slice(0, 25))
  chk.push(`[${r.headPlane}] head=「${r.head}」 cp=${[...r.head].map((c) => "U+" + c.codePointAt(0)!.toString(16).toUpperCase()).join(",")}\n  RAW ${r.line}: ${lines[r.line - 1].slice(0, 120)}`);
writeFileSync("out/swjz-glyph-selfcheck.txt", chk.join("\n") + "\n", "utf8");

writeFileSync("out/swjz-glyphs.tsv",
  ["id\timg\thead\theadPlane\t重文\t體類\t本字\tseal\tIDS\t从形\t佔位符\tline"].concat(
    rows.map((r) => [r.id, r.img, r.head, r.headPlane, r.rv, r.style, r.lemma, r.seal, r.ids, r.cong, r.placeholder, r.line].join("\t"))
  ).join("\n") + "\n", "utf8");
writeFileSync("out/swjz-glyphs.txt", out.join("\n") + "\n", "utf8");
console.log(`entries=${rows.length} dupHead=${dup.length} variant=${rows.filter((r) => r.rv !== "0").length} seal=${seal.length} placeholder=${ph.length}`);
