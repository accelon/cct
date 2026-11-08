/**
 * verify-hydzd-ab.ts — 反解驗證：用 entry 的漢字串依 manifest 的 a-b 切片，
 *                      必須等於該 zone 自己掃出來的漢字串。
 *   bun run src/verify-hydzd-ab.ts [取樣數，預設 400]
 *
 * 這是「字元級定位能不能落地」的直接證據；抽樣跨 form（paired／separator）。
 */
import { readFileSync } from "node:fs";

const SAMPLE = Number(process.argv[2] ?? "400");
const lines = readFileSync("out/hydzd.xml", "utf8").split(/\r?\n/);
const HAN = /\p{Script=Han}/gu;
const rawHan = (s: string): string => s.replace(/<[^>]*>/g, "").match(HAN)?.join("") ?? "";

const ent = readFileSync("out/hydzd-entry.tsv", "utf8").split(/\r?\n/).filter((l) => l.length > 0);
const ecols = ent[0].split("\t");
const entries = ent.slice(1).map((l) => {
  const c = l.split("\t"); const r: Record<string, string> = {};
  ecols.forEach((k, i) => { r[k] = c[i] ?? ""; });
  return r;
});
const lineIdx = new Map<number, Record<string, string>>();
entries.forEach((e, i) => lineIdx.set(Number(e.line), e));

const zon = readFileSync("out/hydzd-zone.tsv", "utf8").split(/\r?\n/).filter((l) => l.length > 0);
const zcols = zon[0].split("\t");
const zones = zon.slice(1).map((l) => {
  const c = l.split("\t"); const r: Record<string, string> = {};
  zcols.forEach((k, i) => { r[k] = c[i] ?? ""; });
  return r;
});

// entry 正文漢字串（排除字頭行）
const entryHan = new Map<string, string>();
for (const e of entries) {
  let s = "";
  for (let ln = Number(e.line) + 1; ln < Number(e.end); ln++) s += rawHan(lines[ln - 1]);
  entryHan.set(e.anchorId, s);
}

// 每個 zone 的 ground truth：自己那段的漢字串
function zoneTruth(z: Record<string, string>): string {
  const e = entries.find((x) => x.anchorId === z.anchorId);
  if (!e) return "";
  const start = Number(z.line) + (z.form === "separator" ? 1 : 0);
  const end = Number(e.end);
  if (z.form === "paired") return rawHan(lines[Number(z.line) - 1]);
  let s = "";
  for (let ln = start; ln < end; ln++) {
    const l = lines[ln - 1];
    if (/^<(詞|例)/.test(l)) break;                    // 遇到下一個區塊就停
    s += rawHan(l);
  }
  return s;
}

const step = Math.max(1, Math.floor(zones.length / SAMPLE));
let ok = 0, bad = 0, noEntry = 0;
const badSamples: string[] = [];
for (let i = 0; i < zones.length; i += step) {
  const z = zones[i];
  const txt = entryHan.get(z.anchorId);
  if (txt === undefined) { noEntry++; continue; }
  const a = Number(z.a), b = Number(z.b);
  const slice = txt.slice(a, b);
  const truth = zoneTruth(z);
  if (slice === truth) ok++;
  else {
    bad++;
    if (badSamples.length < 6) badSamples.push(
      `${z.anchorId} zone${z.zoneSeq} t=${z.t} form=${z.form} a=${a} b=${b} len=${b - a}/${truth.length}\n   切片: ${slice.slice(0, 46)}\n   實際: ${truth.slice(0, 46)}`);
  }
}
console.log(`抽樣 ${ok + bad}／間距 ${step}：反解相同 ${ok}（${((ok / Math.max(1, ok + bad)) * 100).toFixed(1)}%）、不同 ${bad}、查無 entry ${noEntry}`);
for (const s of badSamples) console.log("---\n" + s);
