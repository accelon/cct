/**
 * probe-attributes.ts — 查 adb 的 attributes 容器：閱讀器能不能用 id 直接落地
 *   bun run src/probe-attributes.ts D:\accelon3\13j.adb
 *   bun run src/probe-attributes.ts D:\accelon3\swjz.adb
 *
 * 唯讀；只回報 runtime 看得到的 attribute 鍵與筆數。
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { AdbReader, SyncIO } from "../../adb-converter/ts/src/accelon26/adb.ts";

const path = resolve(process.argv[2] ?? "D:\\accelon3\\13j.adb");
const r = await AdbReader.open(new SyncIO(path));
const lines: string[] = [];
const say = (s: string): void => { lines.push(s); };

say(`adb          : ${path}`);
say(`dbname       : ${r.header.dbname}`);
say(`dbtype       : ${r.header.dbType}`);
say(`hasFullTextIndex: ${r.hasFullTextIndex}`);
say(`containers   : ${[...r.containers.keys()].join(", ")}`);

const attrs = r.containers.get("attributes");
say(`attributes 鍵數: ${attrs ? attrs.names.length : 0}`);
for (const n of attrs?.names ?? []) {
  const av = await r.attributeValues(n);
  const k = av?.values.length ?? 0;
  say(`  ${n}: ${k} 筆` + (k ? `  例 ${av!.values.slice(0, 3).join(" | ")}` : "  ← runtime 無 id 可用"));
}

const tags = r.containers.get("tags");
if (tags) {
  say("");
  say("tags 開標籤: " + tags.names.filter((x) => !x.startsWith("/")).join(" "));
}

const caches = r.containers.get("caches");
if (caches) {
  say("");
  say("caches 鍵: " + caches.names.join(" "));
}

const base = path.split("\\").pop() ?? "adb";
writeFileSync(`out/probe-${base}.txt`, lines.join("\n") + "\n", "utf8");
console.log(`${base}: attributes=${attrs?.names.length ?? 0} containers=${r.containers.size}`);
