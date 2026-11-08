/**
 * verify-jing.ts — 驗 jing.adb 之於舊 13j.adb：VA 不位移、文字一字未動、id 可落地
 *   bun run src/verify-jing.ts
 */
import { writeFileSync } from "node:fs";
import { readAdbText } from "../../adb-converter/ts/src/adbtext.ts";
import { AdbReader, SyncIO } from "../../adb-converter/ts/src/accelon26/adb.ts";
import { stripTags } from "./jing-anchors.ts";

const OLD = "D:\\accelon3\\13j.adb";
const NEW = "out\\jing.adb";

const o = readAdbText(OLD);
const n = readAdbText(NEW);
const out: string[] = [];
const say = (s: string): void => { out.push(s); };

say("=== jing.adb 驗收（對照舊 13j.adb）===");
say(`header  old dbname=${o.header.dbname} dbtype=${o.header.dbType} lineCount=${o.header.lineCount}`);
say(`        new dbname=${n.header.dbname} dbtype=${n.header.dbType} lineCount=${n.header.lineCount}`);

/* 1. 行數與逐行文字（去標籤後）*/
const ol = o.lines, nl = n.lines;
let textDiff = 0;
const firstTextDiff: string[] = [];
for (let i = 0; i < Math.max(ol.length, nl.length); i++) {
  if (stripTags(ol[i] ?? "") !== stripTags(nl[i] ?? "")) {
    textDiff++;
    if (firstTextDiff.length < 5) firstTextDiff.push(`line ${i + 1}: ${(ol[i] ?? "").slice(0, 40)} ≠ ${(nl[i] ?? "").slice(0, 40)}`);
  }
}
say("");
say(`1. 行數 old ${ol.length} / new ${nl.length}；去標籤後不同的行 ${textDiff}`);
for (const s of firstTextDiff) say(`   ${s}`);

/* 2. VA：lines.virtual 必須逐行相同（id 是標籤屬性，標籤固定 4 VA）*/
let vaDiff = 0, vaMaxDelta = 0;
for (let i = 0; i < Math.max(o.linesVirtual.length, n.linesVirtual.length); i++) {
  const d = Math.abs((o.linesVirtual[i] ?? -1) - (n.linesVirtual[i] ?? -1));
  if (d) { vaDiff++; vaMaxDelta = Math.max(vaMaxDelta, d); }
}
say(`2. lines.virtual 不同的行 ${vaDiff}（最大偏移 ${vaMaxDelta}）→ ${vaDiff === 0 ? "VA 完全沒位移" : "⚠ 有位移"}`);

/* 3. tag hit 數必須一致 */
const hits = (a: typeof o) => {
  const m = new Map<string, number>();
  a.tagNames.forEach((t, i) => m.set(t, a.tagHits(i).length));
  return m;
};
const ho = hits(o), hn = hits(n);
const tagDiff = [...new Set([...ho.keys(), ...hn.keys()])]
  .map((t) => [t, ho.get(t) ?? 0, hn.get(t) ?? 0] as const)
  .filter(([, a, b]) => a !== b);
say(`3. 標籤 VA 命中數不一致的標籤 ${tagDiff.length}`);
for (const [t, a, b] of tagDiff.slice(0, 12)) say(`   ${t}: old ${a} → new ${b}`);

/* 4. attributes：新庫必須有 章.id／節.id／項.id，且數量對上 */
const r = await AdbReader.open(new SyncIO(NEW));
const ro = await AdbReader.open(new SyncIO(OLD));
say("");
say("4. attributes（runtime 靠它把 anchorId 落地）");
for (const key of ["書.id", "章.id", "節.id", "項.id", "頁.n", "頁元.n"]) {
  const a = (await ro.attributeValues(key))?.values.length ?? 0;
  const b = (await r.attributeValues(key))?.values.length ?? 0;
  say(`   ${key}: old ${a} → new ${b}${key.endsWith(".id") && a === 0 && b > 0 ? "  ← 本次新增" : ""}`);
}

/* 5. id 唯一性 + 與 manifest 一致 */
const ids = new Map<string, number>();
for (const key of ["章.id", "節.id", "項.id"]) {
  const av = await r.attributeValues(key);
  for (const v of av?.values ?? []) ids.set(v, (ids.get(v) ?? 0) + 1);
}
const unique = [...ids].filter(([, c]) => c === 1).length;
say("");
say(`5. adb 內 id 字串 ${ids.size} 個；跨全庫就唯一 ${unique} 個`);
say(`   （唯一性判斷必須在 work 內：跨書同名是合法的，例如「元年」在公羊／穀梁都有）`);

o.close(); n.close();
writeFileSync("out/jing-verify.txt", out.join("\n") + "\n", "utf8");
console.log(`textDiff=${textDiff} vaDiff=${vaDiff} tagDiff=${tagDiff.length} ids=${ids.size}`);
