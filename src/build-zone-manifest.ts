/**
 * build-zone-manifest.ts — 為 swjz／swjzz 產 char 層與「例（zone）」層 anchor manifest
 *
 *   bun run build-zone-manifest.ts swjz
 *   bun run build-zone-manifest.ts swjzz
 *
 * 對應作者要的粒度「字＋例，然後是行，盡量字元級」：
 *   字  ＝ <字 id="w…">        → anchorId = w…（kind=char）
 *   例  ＝ 字條內的體例區塊      → zoneId = w…/<序>（kind=zone；tag 記在欄位，不進 id）
 *   行  ＝ zone 內第幾個正文行    → zoneLine（1 起，跳空行）
 *   字元 ＝ zone 內漢字序 a-b     → a/b（code point，右開）；同時給整條字條的 spanA/spanB
 *
 * textHash 依 ancient-book-xref-spec.md §4.4（摺疊表 data/char-fold.tsv）；0 漢字 → 空字串。
 * 產出：out/<adb>-char.tsv、out/<adb>-zone.tsv、out/<adb>-zones-report.txt
 */
import { readFileSync, writeFileSync } from "node:fs";
import { loadFold, textHashOf } from "./jing-anchors.ts";

const which = process.argv[2] ?? "swjz";
if (which !== "swjz" && which !== "swjzz") {
  console.error("usage: bun run src/build-zone-manifest.ts <swjz|swjzz> [來源 xml，預設 out/<adb>.xml]");
  process.exit(2);
}

// 交付版要對「實際打進 adb 的那份文字」建 manifest：swjz 的修正版在 out/swjz.new.xml
const src = process.argv[3] ?? `out/${which}.xml`;
const outTag = process.argv[3] ? `${which}-new` : which;
const lines = readFileSync(src, "utf8").split(/\r?\n/);
const fold = loadFold();

// 字條邊界：有 id 的 <字 ...> 行；zone 標籤依各版實際體例
const ZONE_TAGS = which === "swjz"
  ? ["粗", "duan_note", "seal_script", "note"]
  : ["說文", "說文異", "段注", "構形", "篆", "注"];
const zoneRe = new RegExp(`^<(${ZONE_TAGS.join("|")})(?=[\\s>])([^>]*)>([\\s\\S]*?)</\\1>$`);

type CharRow = {
  id: string; head: string; img: string; line: number; end: number;
  juan: string; bu: string; han: number; textHash: string; zones: number;
};
type ZoneRow = {
  charId: string; zoneSeq: number; tag: string; line: number; end: number;
  a: number; b: number; spanA: number; spanB: number; zoneLine: number;
  han: number; textHash: string; head: string;
};

const chars: CharRow[] = [];
const zones: ZoneRow[] = [];
const orphanZone: string[] = [];
let cur: CharRow | null = null;
let juan = "", bu = "";
let foldMiss = 0;

const hanArr = (s: string): string[] => s.replace(/<[^>]*>/g, "").match(/\p{Script=Han}/gu) ?? [];

// 先掃出所有字條行，才能定 end
const charLineIdx: number[] = [];
lines.forEach((l, i) => { if (/<字\s+id="w\d{7}"|<字[^>]*\sid="w\d{7}"/.test(l)) charLineIdx.push(i); });

for (let i = 0; i < lines.length; i++) {
  // swjz 的字條／區塊行前有 tab 縮排，一律先剝掉行首空白再比（swjzz 沒縮排，同样安全）
  const raw = lines[i].replace(/^\s+/, "");
  const jm = raw.match(/^<卷[^>]*\sid="([^"]*)"[^>]*>([\s\S]*?)<\/卷>/);
  if (jm) { juan = jm[1]; continue; }
  const jm2 = raw.match(/^<卷[^>]*\sid="([^"]*)"/);
  if (jm2) { juan = jm2[1]; continue; }
  const bm = raw.match(/^<部[^>]*>([\s\S]*?)<\/部>/);
  if (bm) { bu = bm[1].replace(/<[^>]*>/g, "").trim(); continue; }
  // swjz 沒有 <卷>，用 chaptertitle；附錄用 part_word
  const cm = raw.match(/^<chaptertitle[^>]*\sid="([^"]*)"/);
  if (cm) { juan = cm[1]; continue; }

  const zm = raw.match(/^<字([^>]*)>([\s\S]*?)<\/字>/);
  if (zm && /\sid="(w\d{7})"/.test(zm[1])) {
    const id = zm[1].match(/\sid="(w\d{7})"/)![1];
    const end = charLineIdx.includes(i + 1) ? charLineIdx[charLineIdx.indexOf(i + 1)] + 1 : i + 1;
    if (cur) cur.end = i + 1;
    cur = { id, head: zm[2], img: zm[1].match(/\simg="([^"]*)"/)?.[1] ?? "", line: i + 1, end: lines.length, juan, bu, han: 0, textHash: "", zones: 0 };
    chars.push(cur);
    continue;
  }
  // 無 id 的 <字>（swjz 的書末部首附錄嵌在 <part_word> 內）→ 全行掃描，不限行首
  for (const oz of raw.matchAll(/<字(?![^>]*\sid=")[^>]*>([\s\S]*?)<\/字>/g))
    orphanZone.push(`line ${i + 1}: <字>無 id，內容「${oz[1]}」`);

  const q = raw.match(zoneRe);
  if (q) {
    if (!cur) { orphanZone.push(`line ${i + 1}: <${q[1]}> 在任何字條之外`); continue; }
    cur.zones++;
    const k = zones.filter((z) => z.charId === cur!.id).length + 1;
    zones.push({
      charId: cur.id, zoneSeq: k, tag: q[1], line: i + 1, end: i + 1,
      a: 0, b: 0, spanA: 0, spanB: 0, zoneLine: 1, han: 0, textHash: "", head: cur.head,
    });
  }
}

/* ---- 算 zone 與字條的漢字偏移 ---- */
const charIdx = new Map<string, CharRow>();
for (const c of chars) charIdx.set(c.id, c);
for (let i = 0; i < chars.length; i++) {
  const c = chars[i];
  c.end = i + 1 < chars.length ? chars[i + 1].line : lines.length;
}

// zone 的 a-b：相對於「整條字條漢字串」；zoneLine：zone 標籤在字條內第幾個正文行
const zoneByChar = new Map<string, ZoneRow[]>();
for (const z of zones) (zoneByChar.get(z.charId) ?? zoneByChar.set(z.charId, []).get(z.charId)!).push(z);

for (const c of chars) {
  const seg = lines.slice(c.line - 1, c.end - 1);
  const all = hanArr(seg.join(""));
  c.han = all.length;
  const th = textHashOf(all, fold);
  c.textHash = th.hash; foldMiss += th.miss;
  let pos = 0;                 // 已累計的漢字數（字條起點＝0；字頭本身計入）
  let bodyLine = 0;
  for (let li = 0; li < seg.length; li++) {
    const raw = seg[li];
    const hanHere = hanArr(raw);
    const zq = raw.match(zoneRe);
    if (zq) {
      const isHeadLine = /<字[^>]*\sid="w\d{7}"/.test(raw);
      bodyLine++;
      const zz = (zoneByChar.get(c.id) ?? []).filter((z) => z.line === c.line + li);
      for (const z of zz) {
        z.a = pos; z.b = pos + hanHere.length; z.spanA = pos; z.spanB = pos + hanHere.length;
        z.zoneLine = bodyLine; z.end = c.line + li + 1; z.han = hanHere.length;
        const zh = textHashOf(hanHere, fold);
        z.textHash = zh.hash; foldMiss += zh.miss;
      }
    } else if (isHeadOnly(raw)) {
      // 字頭行（可能同帶 <圖>）：漢字屬字頭，不算正文行
    } else if (raw.trim() !== "" && !/^<圖/.test(raw.trim())) {
      bodyLine++;
    }
    pos += hanHere.length;
  }
  void all;
}
function isHeadOnly(raw: string): boolean {
  return /<字[^>]*\sid="w\d{7}"[^>]*>[\s\S]*?<\/字>/.test(raw);
}

/* ---- 輸出 ---- */
writeFileSync(`out/${outTag}-char.tsv`, [
  ["charId", "head", "juan", "bu", "line", "end", "hanCount", "textHash", "zoneBlocks", "img"].join("\t"),
  ...chars.map((c) => [c.id, c.head, c.juan, c.bu, c.line, c.end, c.han, c.textHash, c.zones, c.img].join("\t")),
].join("\n") + "\n", "utf8");

writeFileSync(`out/${outTag}-zone.tsv`, [
  ["charId", "zoneSeq", "tag", "line", "a", "b", "zoneLine", "hanCount", "textHash", "head"].join("\t"),
  ...zones.map((z) => [z.charId, z.zoneSeq, z.tag, z.line, z.a, z.b, z.zoneLine, z.han, z.textHash, z.head].join("\t")),
].join("\n") + "\n", "utf8");

const tagCount = new Map<string, number>();
for (const z of zones) tagCount.set(z.tag, (tagCount.get(z.tag) ?? 0) + 1);
const rep = [
  `=== ${which} 字／例 manifest ===`,
  `字條（有 id）: ${chars.length}；例區塊: ${zones.length}；查不到摺疊字: ${foldMiss}`,
  `例標籤分佈: ${[...tagCount].map(([k, v]) => `${k}=${v}`).join("  ")}`,
  `字條外／無 id 的 <字> 或例: ${orphanZone.length} 筆`,
  ...orphanZone.slice(0, 6).map((s) => "  " + s),
  `0 漢字的例區塊: ${zones.filter((z) => z.han === 0).length}（textHash 依慣例留空）`,
  `例區塊 >240 漢字: ${zones.filter((z) => z.han > 240).length}（xout quote 上限）`,
  `跨区重複 charId: ${chars.length - new Set(chars.map((c) => c.id)).size}`,
].join("\n") + "\n";
writeFileSync(`out/${outTag}-zones-report.txt`, rep, "utf8");
console.log(`${which}: chars=${chars.length} zones=${zones.length} orphanOrNoId=${orphanZone.length} foldMiss=${foldMiss}`);
