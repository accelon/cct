/**
 * extract-adb.ts — 把舊 adb 解成 XML 文字＋容器量測報告
 *
 * 用法：
 *   bun run src/extract-adb.ts <adb 路徑> <輸出字首>
 * 例：
 *   bun run src/extract-adb.ts D:\accelon3\13j.adb out/13j
 *
 * 產出（不進版控）：
 *   <字首>.xml      —— 逐行的 adb 標記文字（一行一個 adb 行）
 *   <字首>.meta.txt  —— header、tagNames＋VA 命中數、caches／resources 鍵、行數統計
 *
 * 只用母區共用工具（adbtext.ts＋accelon26/adb.ts），不自寫容器解析。
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { readAdbText } from "../../adb-converter/ts/src/adbtext.ts";
import { AdbReader, SyncIO } from "../../adb-converter/ts/src/accelon26/adb.ts";

const [adbPath, outStem] = process.argv.slice(2);
if (!adbPath || !outStem) {
  console.error("usage: bun run src/extract-adb.ts <adb> <out-stem>");
  process.exit(2);
}

const adb = readAdbText(resolve(adbPath));
const lines = adb.lines;
writeFileSync(resolve(`${outStem}.xml`), lines.join("\n"), "utf8");

// caches / resources 的鍵名＝authorAdb 的 cachedTags／resources 依據
const reader = await AdbReader.open(new SyncIO(resolve(adbPath)));
const cacheNames = [...(reader.containers.get("caches")?.names ?? [])];
const resourceNames = [...(reader.containers.get("resources")?.names ?? [])];

const tagStats = adb.tagNames.map((name, i) => ({ name, hits: adb.tagHits(i).length }));

const meta: string[] = [];
meta.push(`source : ${adbPath}`);
meta.push(`size   : ${adb.size}`);
meta.push(`header : ${JSON.stringify(adb.header)}`);
meta.push(`srcBlockSize: ${adb.srcBlockSize}`);
meta.push(`lines  : ${lines.length}`);
meta.push(`chars  : ${lines.join("").length}`);
meta.push(`longest line: ${lines.reduce((m, l) => Math.max(m, l.length), 0)}`);
meta.push(`over 4000 chars: ${lines.filter((l) => l.length > 4000).length}`);
meta.push(`tags declared (open, /close): ${adb.tagNames.length}`);
meta.push(`tokens container: ${adb.tokenNames.length}`);
meta.push(`lines.physical: ${adb.linesPhysical.length}`);
meta.push(`lines.virtual : ${adb.linesVirtual.length}`);
meta.push(`caches keys   : ${cacheNames.length ? cacheNames.join(" | ") : "(未取得，見 extract 報告)"}`);
meta.push(`resources keys: ${resourceNames.length}`);
if (resourceNames.length <= 40) meta.push(`resources      : ${resourceNames.join(" | ")}`);
meta.push("");
meta.push("=== tag hit counts (VA 數) ===");
for (const t of tagStats) meta.push(`${t.hits}\t${t.name}`);
meta.push("");
meta.push("=== first 60 lines ===");
meta.push(...lines.slice(0, 60).map((l, i) => `${i + 1}: ${l}`));

mkdirSync(dirname(resolve(outStem)), { recursive: true });
writeFileSync(resolve(`${outStem}.meta.txt`), meta.join("\n") + "\n", "utf8");

console.log(`${adbPath}: lines=${lines.length} tags=${adb.tagNames.length} -> ${outStem}.xml`);
void resourceNames;
adb.close();
