/**
 * make-variant-table.ts — 建「語義異體類」表 n2（只用於找回引文，不改 n1／textHash）
 *
 *   bun run src/make-variant-table.ts
 *
 * 為什麼不直接擴充 n1：
 *   data/char-fold.tsv 是 gycd `norm_char(tier=1)`（ancient-book-xref-spec §4.4）的凍結複製，
 *   四庫的 textHash 都按它算。Unihan 語義異體不在 §4.4 內，併進去會讓既有 hash 全部漂移、
 *   而且喪失與 gycd 的可比性。所以這裡另出一張 n2 表：比對時用，算 hash 時不用。
 *
 * 輸入：D:\2026\adb-converter\vendor\Unihan_Variants.txt（本機既有，未抓網）
 * 欄位：kSemanticVariant ＋ kSpecializedSemanticVariant（兩档分開統計，因為後者更窄、易誤傷）
 *       —— 不收 kSimplifiedVariant／kTraditionalVariant：繁簡已由 OpenCC 在 n1 內處理
 *       —— 不收 kJapaneseOld/NewVariant：日文新舊字體不適用於漢語大字典
 *       —— kZVariant 另計（異體＝同字，實務上也常被當錯字來源）
 * 輸出：data/char-variant.tsv   char \t root \t tier（tier=sem|spec|z）
 */
import { readFileSync, writeFileSync } from "node:fs";
import { foldChars, loadFold } from "./jing-anchors.ts";

const UNIHAN = "D:/2026/adb-converter/vendor/Unihan_Variants.txt";
/* Unihan kSemanticVariant 的語意是「某些語境同義」，實測混入不可互換的字（查核見 out/probe-fold-suspects.txt
 * 與 out/audit-fuzzy-links.txt 的差字對）：綠↔氯（氯是近代化學字，同「录」聲旁而被收）、
 * 的↔嶩、罵↔傌、螫↔着（著/着 我們要，螫 不能拖進來）。這幾個字不加入任何等價類，
 * 其餘照收。剔的是「髒成員」，不是整條欄位——否則 413 條 著/着 的連結會一起消失。 */
const DENY = new Set(["氯", "嶩", "傌", "螫"]);
const fold = loadFold();
const cp = (hex: string) => String.fromCodePoint(parseInt(hex.replace("U+", ""), 16));
/** 先過 n1（NFKC→首漢字→s2t→VMAP），讓 Unihan 的異體類疊在既有摺疊之上，而不是繞過它 */
const n1 = (c: string) => foldChars([c], fold).n1 || c;

const raw = readFileSync(UNIHAN, "utf8").split(/\r?\n/);
const parent = new Map<string, string>();
const find = (x: string): string => {
  let r = x;
  while (parent.get(r) !== r) r = parent.get(r)!;
  let y = x;
  while (parent.get(y) !== r) { const nx = parent.get(y)!; parent.set(y, r); y = nx; }
  return r;
};
const union = (a: string, b: string) => {
  if (!parent.has(a)) parent.set(a, a);
  if (!parent.has(b)) parent.set(b, b);
  const ra = find(a), rb = find(b);
  if (ra !== rb) parent.set(ra < rb ? rb : ra, ra < rb ? ra : rb);   // 代表字取較小碼位，穩定可重現
};
const stat = { sem: 0, spec: 0, z: 0, rows: 0, bad: 0, denied: 0 } as Record<string, number>;
const tiersOf = new Map<string, string>();

for (const l of raw) {
  if (!l || l.startsWith("#")) continue;
  const p = l.split("\t");
  if (p.length < 3) continue;
  stat.rows++;
  let tier = "";
  if (p[1] === "kSemanticVariant") tier = "sem";
  else if (p[1] === "kSpecializedSemanticVariant") tier = "spec";
  else if (p[1] === "kZVariant") tier = "z";
  else continue;
  const src = n1(cp(p[0]));
  for (const t of p[2].trim().split(/\s+/)) {
    if (!/^U\+/.test(t)) { stat.bad++; continue; }        // 有別名註解混在值裡，跳過
    const tc = n1(cp(t));
    if (tc === src) continue;
    if (DENY.has(src) || DENY.has(tc)) { stat.denied++; continue; }
    union(src, tc);
    stat[tier]++;
    const key = [src, tc].sort()[0] + "|" + [src, tc].sort()[1];
    if (!tiersOf.has(key)) tiersOf.set(key, tier);
  }
}

const rows: string[] = ["# n2 語義異體類表：char\troot\ttier（tier=sem 語義異體｜spec 特化語義異體｜z 同字異體）"];
const byTier = { sem: 0, spec: 0, z: 0 } as Record<string, number>;
for (const c of [...parent.keys()].sort()) {
  const root = find(c);
  if (root === c) continue;
  rows.push(`${c}\t${root}\t${tiersOf.get([c, root].sort()[0] + "|" + [c, root].sort()[1]) ?? "sem"}`);
  byTier[tiersOf.get([c, root].sort()[0] + "|" + [c, root].sort()[1]) ?? "sem"]++;
}
writeFileSync("data/char-variant.tsv", rows.join("\n") + "\n", "utf8");
console.log([
  `Unihan_Variants 讀 ${stat.rows} 列；語義異體 ${stat.sem}、特化 ${stat.spec}、Z ${stat.z}（值內非 U+ 記號跳過 ${stat.bad}）`,
  `輸出 data/char-variant.tsv：${rows.length - 1} 個字有非自身代表字（sem ${byTier.sem}／spec ${byTier.spec}／z ${byTier.z}）`,
  `剔除 Unihan 髒成員的連結請求 ${stat.denied} 次（氯／嶩／傌／螫）`,
].join("\n"));
