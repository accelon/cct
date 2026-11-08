/**
 * pack-swjz.ts — 打包新 swjz.adb 並就地驗證（先出到 out/，不直接覆蓋 accelon3）
 *
 *   bun run src/pack-swjz.ts            → out/swjz.new.adb ＋ out/swjz-pack.txt
 *   bun run src/pack-swjz.ts --ship     → 另外複製到 D:\accelon3\swjz.adb（覆蓋前自動備份舊檔）
 *
 * schema 沿舊庫（out/swjz.meta.txt），只新增兩個標記：部目（照 swjzz 慣例）、構形（照 swjzz 慣例）。
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, copyFileSync, existsSync } from "node:fs";
import { AdbReader, SyncIO } from "../../adb-converter/ts/src/accelon26/adb.ts";
import { authorAdb } from "../../adb-converter/ts/src/adbauthor.ts";
import { readAdbText } from "../../adb-converter/ts/src/adbtext.ts";

const OLD = "D:\\accelon3\\swjz.adb";
const SHIP = process.argv.includes("--ship");

const lines = readFileSync("out/swjz.new.xml", "utf8").split("\n");
for (let i = 0; i < lines.length; i++) {
  if (/[\r\n]/.test(lines[i])) throw new Error(`line ${i + 1} 含 CR/LF`);
}

/* ---- 舊庫 schema ---- */
const oldTags = readFileSync("out/swjz.meta.txt", "utf8").split(/\r?\n/)
  .filter((l) => /^\d+\t/.test(l)).map((l) => l.split("\t")[1]).filter(Boolean);
const openOld = [...new Set(oldTags.filter((t) => !t.startsWith("/")))];
const ADDED = ["部目", "構形"];
const validTags = [...openOld, ...ADDED];

const oldAdb = await AdbReader.open(new SyncIO(OLD));
const cachedTags = [...(oldAdb.containers.get("caches")?.names ?? []), "部目"];
// resources 原樣帶過去（舊庫只有 accelon3_logo.png）；AdbReader 只提供依 index 讀取
const resC = oldAdb.containers.get("resources");
const resNames = [...(resC?.names ?? [])];
const resources: { name: string; bytes: Buffer }[] = [];
for (let i = 0; i < resNames.length; i++) {
  const rb = await oldAdb.resourceBytes(i);
  resources.push({ name: rb.name, bytes: Buffer.from(rb.bytes) });
}
const head = oldAdb.header;

const res = await authorAdb({
  dbname: head.dbname, dbcname: head.dbcname, dbtype: head.dbType, srcBlockSize: head.srcBlockSize,
  features: head.features, lines, validTags, cachedTags, resources,
});
writeFileSync("out/swjz.new.adb", Buffer.from(res.file));
const sha = createHash("sha256").update(res.file).digest("hex");

/* ---- 驗證：新檔 vs 舊檔 ---- */
const neu = await AdbReader.open(new SyncIO("out\\swjz.new.adb"));
const oTxt = readAdbText(OLD), nTxt = readAdbText("out\\swjz.new.adb");
let vaDiff = 0, vaFirst = -1, vaLastDelta = 0;
for (let i = 0; i < Math.max(oTxt.linesVirtual.length, nTxt.linesVirtual.length); i++) {
  const d = (nTxt.linesVirtual[i] ?? 0) - (oTxt.linesVirtual[i] ?? 0);
  if (d !== 0) { vaDiff++; if (vaFirst < 0) vaFirst = i + 1; vaLastDelta = d; }
}
const attrZiOld = (await oldAdb.attributeValues("字.id"))?.values.length ?? 0;
const attrZiNew = (await neu.attributeValues("字.id"))?.values.length ?? 0;
const attrBuNew = (await neu.attributeValues("部目.n"))?.values.length ?? 0;
const orphanNew = nTxt.lines.reduce((n, l) => n + [...l.matchAll(/<字(?![^>]*\s+id=")/g)].length, 0);
const tagDiff = [...new Set([...oldTags.filter((t) => !t.startsWith("/")), ...ADDED])]
  .filter((t) => !neu.containers.get("tags")!.names.includes(t) && !neu.containers.get("tags")!.names.includes("/" + t));

const rep = [
  "=== pack-swjz ＋驗證 ===",
  `lines 舊 ${oTxt.lines.length} / 新 ${nTxt.lines.length}`,
  `字.id  舊 ${attrZiOld} → 新 ${attrZiNew}`,
  `部目.n 新 ${attrBuNew}（附錄已獨立，照 swjzz 慣例 n="1..540"）`,
  `無 id 的 <字> 新 ${orphanNew}（舊 540）`,
  `tags 舊 ${oldTags.length} → 新 ${neu.containers.get("tags")!.names.length}（新增 ${ADDED.join("、")}）；缺標籤 ${tagDiff.length ? tagDiff.join(",") : "無"}`,
  `caches 新 ${neu.containers.get("caches")!.names.join(" ")}`,
  `resources ${resources.length}/${resNames.length} 帶過去（${resources.map((r) => r.name).join(",")}）`,
  `VA 位移：${vaDiff} 行不同（首次 line ${vaFirst}，末段累計 +${vaLastDelta}）← 新增 ${ADDED.join("/")} 標籤邊界所致，屬預期`,
  `file out/swjz.new.adb ${res.file.length} bytes  sha256 ${sha}`,
  `features=${head.features} dbtype=${head.dbType} dbname=${head.dbname}（沿用舊值）`,
].join("\n") + "\n";
writeFileSync("out/swjz-pack.txt", rep, "utf8");

if (SHIP) {
  const bak = "out/swjz-original.adb";
  if (!existsSync(bak)) copyFileSync(OLD, bak);
  const bakSha = createHash("sha256").update(readFileSync(bak)).digest("hex").slice(0, 12);
  copyFileSync("out/swjz.new.adb", OLD);
  const nowSha = createHash("sha256").update(readFileSync(OLD)).digest("hex").slice(0, 12);
  writeFileSync("out/swjz-pack.txt", rep + `\n--ship-- 舊檔已備份 ${bak}（sha ${bakSha}）；D:\\accelon3\\swjz.adb 現 sha ${nowSha}\n`, "utf8");
  console.log(`SHIP: 舊檔備份 out/swjz-original.adb（${bakSha}），現行 accelon3 sha ${nowSha}`);
}
console.log(rep.split("\n").slice(1, 8).join(" | "));
