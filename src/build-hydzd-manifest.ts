/**
 * build-hydzd-manifest.ts — hydzd（漢語大字典）的「字＋例＋行＋字元」anchor manifest
 *
 *   bun run src/build-hydzd-manifest.ts [來源 xml，預設 out/hydzd.xml]
 *
 * 結構（實測自交付版 hydzd.adb）：
 *   <詞 py="…">字頭</詞>            82,280 筆，**完全沒有 id**
 *   <例 t="説文">…</例>             成對＝短值包住
 *   <例 t="義項"/>                  自閉合＝分隔列，內容在它之後的正文行，直到下一個 <例>／<詞>
 * 同一字頭會有多輪「拼音→音韻→義項」（多音字），所以 zone 另記 pronGroup。
 *
 * 地址模型（作者要的 字＋例→行→字元）：
 *   anchorId＝字頭文字（撞名加 #N，N＝文件序；需不需要、多少筆，本腳本量出來）
 *   a-b     ＝ entry 正文內的漢字序（raw code point，右開；與 jing／swjz 同規定）
 *   textHash＝ spec §4.4（NFKC→首個漢字→s2t→首個漢字→VMAP）；0 漢字 → 空字串
 *
 * 全線性：先逐行算 raw 漢字串與折疊串，再用前綴和取偏移（72 萬行不能巢狀掃）。
 * 產出：out/hydzd-entry.tsv、out/hydzd-zone.tsv、out/hydzd-manifest.txt
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { foldChars, loadFold } from "./jing-anchors.ts";

const src = process.argv[2] ?? "out/hydzd.xml";
const lines = readFileSync(src, "utf8").split(/\r?\n/);
const N = lines.length;
const fold = loadFold();
const HAN = /\p{Script=Han}/gu;

let foldMiss = 0;
const rawAt = new Array<string>(N);      // 該行的漢字（去標籤）
const foldAt = new Array<string>(N);     // 摺疊後的漢字串
const pref = new Int32Array(N + 1);      // raw 漢字數前綴和
for (let i = 0; i < N; i++) {
  const r = lines[i].replace(/<[^>]*>/g, "").match(HAN)?.join("") ?? "";
  rawAt[i] = r;
  const f = foldChars([...r], fold);
  foldAt[i] = f.n1; foldMiss += f.miss;
  pref[i + 1] = pref[i] + r.length;
}
const hashOf = (s: string): string => (s ? createHash("sha256").update(s, "utf8").digest("hex").slice(0, 16) : "");

const ENTRY_RE = /^<詞([^>]*)>([\s\S]*?)<\/詞>\s*$/;
const ZONE_SELF = /^<例([^>]*?)\/>\s*$/;
const ZONE_PAIR = /^<例([^>]*)>([\s\S]*?)<\/例>\s*$/;

type Entry = { head: string; attrs: string; py: string; line: number; end: number; han: number; hash: string; zones: number; groups: number; anchorId: string; dupSeq: number };
type Zone = { e: number; seq: number; group: number; t: string; form: string; line: number; end: number; a: number; b: number; han: number; hash: string; bodyLines: number };

const entries: Entry[] = [];
const zones: Zone[] = [];

for (let i = 0; i < N; i++) {
  const em = lines[i].match(ENTRY_RE);
  if (!em) continue;
  const attrs = em[1];
  entries.push({
    head: em[2], attrs: attrs.trim(), py: attrs.match(/\spy="([^"]*)"/)?.[1] ?? "",
    line: i + 1, end: N, han: 0, hash: "", zones: 0, groups: 0, anchorId: "", dupSeq: 0,
  });
}
const eAtLine = new Map<number, number>();
entries.forEach((e, k) => eAtLine.set(e.line - 1, k));
// entry 範圍：[line, next entry line)
entries.forEach((e, k) => { e.end = k + 1 < entries.length ? entries[k + 1].line : N + 1; });

// zone 掃描（線性；每個 zone 的內容尾 = 下一個 zone 或 entry 尾）
let ei = -1, zSeq = 0, group = 0;
const pending: { k: number; line: number; t: string; form: string }[] = [];
for (let i = 0; i < N; i++) {
  if (eAtLine.has(i)) {
    ei = eAtLine.get(i)!; zSeq = 0; group = 0;
    continue;
  }
  if (ei < 0) continue;
  const e = entries[ei];
  let t = "", form = "";
  if (ZONE_SELF.test(lines[i])) { t = (lines[i].match(ZONE_SELF)?.[1] ?? "").match(/\st="([^"]*)"/)?.[1] ?? ""; form = "separator"; }
  else if (ZONE_PAIR.test(lines[i])) { t = (lines[i].match(ZONE_PAIR)?.[1] ?? "").match(/\st="([^"]*)"/)?.[1] ?? ""; form = "paired"; }
  else continue;
  zSeq++; e.zones++;
  if (t.includes("拼音")) { group++; e.groups++; }
  pending.push({ k: ei, line: i + 1, t: t.trim(), form, group: Math.max(1, group), seq: zSeq } as never);
}
// 定尾：下一個 pending zone 行 或 entry 尾
for (let p = 0; p < pending.length; p++) {
  const z = pending[p] as { k: number; line: number; t: string; form: string; group: number; seq: number };
  const nx = p + 1 < pending.length && pending[p + 1].k === z.k ? pending[p + 1].line : entries[z.k].end;
  const e = entries[z.k];
  let hanStr = "", foldStr = "", bodyLines = 0;
  if (z.form === "paired") {
    hanStr = rawAt[z.line - 1]; foldStr = foldAt[z.line - 1]; bodyLines = 1;
  } else {
    for (let ln = z.line; ln < nx - 1; ln++) { hanStr += rawAt[ln]; foldStr += foldAt[ln]; if (lines[ln].trim() !== "") bodyLines++; }
  }
  zones.push({
    e: z.k, seq: z.seq, group: z.group, t: z.t, form: z.form, line: z.line, end: nx,
    a: pref[z.line - (z.form === "paired" ? 1 : 0)] - pref[e.line], b: 0,
    han: hanStr.length, hash: hashOf(foldStr), bodyLines,
  });
  zones[zones.length - 1].b = zones[zones.length - 1].a + hanStr.length;   // b＝a＋該 zone 漢字數
  void nx;
}
// entry 正文與 hash
for (const e of entries) {
  let hs = "", fs = "";
  for (let ln = e.line; ln < e.end - 1; ln++) { hs += rawAt[ln]; fs += foldAt[ln]; }
  e.han = hs.length; e.hash = hashOf(fs);
}

/* ---- anchorId：撞名才 #N ---- */
const cnt = new Map<string, number>();
for (const e of entries) cnt.set(e.head, (cnt.get(e.head) ?? 0) + 1);
const seen = new Map<string, number>();
for (const e of entries) {
  const n = (seen.get(e.head) ?? 0) + 1; seen.set(e.head, n);
  e.dupSeq = n;
  e.anchorId = (cnt.get(e.head) ?? 1) > 1 ? `${e.head}#${n}` : e.head;
}

/* ---- 簡繁摺疊會不會把不同字頭合成同一個 ---- */
const fmap = new Map<string, string[]>();
for (const e of entries) {
  const f = foldChars([...e.head], fold).n1;
  (fmap.get(f) ?? fmap.set(f, []).get(f)!).push(e.head);
}
const clash = [...fmap].filter(([, arr]) => new Set(arr).size > 1);

/* ---- 報告 ---- */
const tDist = new Map<string, number>();
for (const z of zones) tDist.set(z.t || "(無 t)", (tDist.get(z.t || "(無 t)") ?? 0) + 1);
const dup = [...cnt].filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1]);
const med = (a: number[]): number => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)] ?? 0; };

const rep2 = [
  `=== hydzd 字＋例 manifest（${src}，${N} 行）===`,
  `字頭 entry: ${entries.length}；例 zone: ${zones.length}；摺疊表查不到字: ${foldMiss}`,
  `<詞> 帶 id: ${entries.filter((e) => e.attrs.includes("id=")).length}；帶 py: ${entries.filter((e) => e.py).length}`,
  `→ 字頭若完全沒有 id，anchorId 只能靠字頭文字（見下）`,
  "",
  `字頭撞名: ${dup.length} 組、涉及 ${dup.reduce((n, [, c]) => n + c, 0)} 筆 → 這些需要 #N`,
  `  最多例: ${dup.slice(0, 10).map(([h, n]) => `${h}×${n}`).join("  ")}`,
  `簡繁摺疊後會把不同字頭合成同一串: ${clash.length} 組`,
  `  例: ${clash.slice(0, 10).map(([, arr]) => [...new Set(arr)].join("/")).join("  ")}`,
  "",
  `zone t= 分佈（前 14）:`,
  ...[...tDist].sort((a, b) => b[1] - a[1]).slice(0, 14).map(([k, v]) => `  ${k}: ${v}`),
  `成對包住 ${zones.filter((z) => z.form === "paired").length}／自閉合分隔列 ${zones.filter((z) => z.form === "separator").length}`,
  `多讀音字頭（pronGroups>1）: ${entries.filter((e) => e.groups > 1).length}；最多 ${Math.max(...entries.map((e) => e.groups))} 輪`,
  `沒有 zone 的字頭: ${entries.filter((e) => e.zones === 0).length}（純參見條目？）`,
  "",
  `entry 漢字數 min ${Math.min(...entries.map((e) => e.han))}／中位 ${med(entries.map((e) => e.han))}／max ${Math.max(...entries.map((e) => e.han))}`,
  `zone 漢字數 min ${Math.min(...zones.map((z) => z.han))}／中位 ${med(zones.map((z) => z.han))}／max ${Math.max(...zones.map((z) => z.han))}`,
  `zone >240 漢字（xout quote 上限）: ${zones.filter((z) => z.han > 240).length}`,
  `zone 0 漢字（textHash 依慣例留空）: ${zones.filter((z) => z.han === 0).length}`,
  `entry 0 漢字: ${entries.filter((e) => e.han === 0).length}`,
].join("\n") + "\n";

writeFileSync("out/hydzd-entry.tsv", [
  ["anchorId", "head", "dupSeq", "py", "attrs", "line", "end", "hanCount", "textHash", "zones", "pronGroups"].join("\t"),
  ...entries.map((e) => [e.anchorId, e.head, e.dupSeq, e.py, e.attrs, e.line, e.end, e.han, e.hash, e.zones, e.groups].join("\t")),
].join("\n") + "\n", "utf8");
writeFileSync("out/hydzd-zone.tsv", [
  ["anchorId", "zoneSeq", "pronGroup", "t", "form", "line", "a", "b", "bodyLines", "hanCount", "textHash"].join("\t"),
  ...zones.map((z) => [entries[z.e].anchorId, z.seq, z.group, z.t, z.form, z.line, z.a, z.b, z.bodyLines, z.han, z.hash].join("\t")),
].join("\n") + "\n", "utf8");
writeFileSync("out/hydzd-manifest.txt", rep2, "utf8");
console.log(`entries=${entries.length} zones=${zones.length} dupHead=${dup.length} simpTradClash=${clash.length} foldMiss=${foldMiss}`);
