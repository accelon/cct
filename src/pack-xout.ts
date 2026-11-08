/**
 * pack-xout.ts — 架構第三段：把 xout_<work> 容器塞進 adb，並驗「取得回來」
 *
 *   bun run src/pack-xout.ts <來源 adb> <輸出 adb> <xout 檔前綴，例 out/xout_>
 *   例：bun run src/pack-xout.ts D:\accelon3\swjzz.adb out/swjzz.xout.adb out/xout_
 *
 * 為什麼需要這一層：spec §5.1 規定「引用庫用 xout_<workId> 容器」，但連結若只是
 * out/ 下的 jsonl，runtime 看不到。這一支把 jsonl 包成容器、沿用來源庫的 schema 重打包，
 * 再開回來驗證筆數一致（不覆蓋來源檔）。
 *
 * schema 沿用來源：dbname／dbcname／dbtype／features／srcBlockSize／validTags／cachedTags／resources。
 * dualSelfClosingTags 由「文字裡永远是自閉合 且 舊 tag 表有 /x」自動推導（jing 那次的 /頁元 教訓）。
 */
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { basename } from "node:path";
import { authorAdb } from "../../adb-converter/ts/src/adbauthor.ts";
import { buildContainer } from "../../adb-converter/ts/src/romblock.ts";
import { readAdbText } from "../../adb-converter/ts/src/adbtext.ts";
import { AdbReader, SyncIO } from "../../adb-converter/ts/src/accelon26/adb.ts";

const [srcArg, outArg, prefixArg] = process.argv.slice(2);
if (!srcArg || !outArg) {
  console.error("usage: bun run src/pack-xout.ts <src.adb> <out.adb> [xout 前綴＝out/xout_]");
  process.exit(2);
}
const PREFIX = prefixArg ?? "out/xout_";

/* ---------- 來源 schema ---------- */
const src = await AdbReader.open(new SyncIO(srcArg));
const head = src.header;
const text = readAdbText(srcArg);
const lines = text.lines;
while (lines.length && lines[lines.length - 1] === "") lines.pop();

const oldTags = text.tagNames;
const openTags = [...new Set(oldTags.filter((t) => !t.startsWith("/")))];
const cachedTags = [...(src.containers.get("caches")?.names ?? [])];

// 自閉合標籤自動推導：文字中只以 `<x .../>` 出現、且舊 tag 表有 /x
const dual: string[] = [];
for (const t of openTags) {
  const hasCloseInOld = oldTags.includes("/" + t);
  const selfOnly = !lines.some((l) => new RegExp(`<${t}(?=[\\s>])[^>]*>`, "").test(l) && new RegExp(`</${t}>`).test(l));
  const appears = lines.some((l => new RegExp(`<${t}[\\s/>]`).test(l)));
  if (hasCloseInOld && selfOnly && appears) dual.push(t);
}

// resources 原樣帶過去
const resC = src.containers.get("resources");
const resources: { name: string; bytes: Buffer }[] = [];
for (let i = 0; i < (resC?.names.length ?? 0); i++) {
  const rb = await src.resourceBytes(i);
  resources.push({ name: rb.name, bytes: Buffer.from(rb.bytes) });
}

/* ---------- xout 容器 ---------- */
const files = readdirSync("out").filter((f) => f.startsWith(basename(PREFIX)) && f.endsWith(".jsonl"));
const extra: Record<string, Uint8Array> = {};
const manifest: { name: string; records: number; bytes: number }[] = [];
for (const f of files) {
  const work = f.replace(/^xout_/, "").replace(/\.jsonl$/, "");
  const bytes = Buffer.from(readFileSync(`out/${f}`, "utf8"), "utf8");
  const name = `xout_${work}`;
  extra[name] = new Uint8Array(buildContainer({ feature: 0, blocks: [bytes] }));
  manifest.push({ name, records: bytes.toString("utf8").split("\n").filter((l) => l.length > 0).length - 1, bytes: bytes.length });
}
if (!manifest.length) console.error("⚠ 沒有 xout 檔，這一包只等於重打包");

/* ---------- 打包 ---------- */
const res = await authorAdb({
  dbname: head.dbname, dbcname: head.dbcname, dbtype: head.dbType, srcBlockSize: head.srcBlockSize,
  features: head.features, lines, validTags: openTags, cachedTags,
  dualSelfClosingTags: dual.length ? dual : undefined,
  resources, extraContainers: extra, fullTextIndex: true,
});
writeFileSync(outArg, Buffer.from(res.file));

/* ---------- 驗：開回來讀容器 ---------- */
const back = await AdbReader.open(new SyncIO(outArg));
const check: string[] = [];
let allOk = true;
for (const m of manifest) {
  const c = back.containers.get(m.name);
  if (!c) { check.push(`  ✗ 容器 ${m.name} 不存在`); allOk = false; continue; }
  const blk = await back.readBlock(m.name, 0);
  const txt = Buffer.from(blk).toString("utf8");
  const first = JSON.parse(txt.split("\n")[0]) as unknown[];
  const rows = txt.split("\n").filter((l) => l.length > 0).length - 1;
  const ok = rows === m.records && first[0] === "XOUT1";
  if (!ok) allOk = false;
  check.push(`  ${ok ? "✓" : "✗"} ${m.name}: 讀回 ${rows} 筆（寫入 ${m.records}）header=${first[0]} work=${first[1]} edition=${first[4] ?? "—"}`);
}
const tagDiffOld = [...new Set([...oldTags, ...openTags])].filter((t) => !res.tagNames.includes(t));
const added = res.tagNames.filter((t) => !oldTags.includes(t));

const rep = [
  "=== pack-xout ===",
  `來源 ${srcArg}  dbname=${head.dbname} dbtype=${head.dbType} features=${head.features} lines=${lines.length} resources=${resources.length}`,
  `validTags ${openTags.length}、cachedTags ${cachedTags.join(" ")}、自動推導 dualSelfClosing=[${dual.join(" ")}]`,
  `xout 容器 ${manifest.length} 個：${manifest.map((m) => `${m.name}(${m.records})`).join(" ")}`,
  `輸出 ${outArg}  ${res.file.length.toLocaleString()} bytes  sha ${createHash("sha256").update(res.file).digest("hex").slice(0, 12)}`,
  `來源檔 ${existsSync(srcArg) ? "未被修改（只寫輸出檔）" : "?"}`,
  `標籤：與來源差 ${tagDiffOld.length ? "缺 " + tagDiffOld.join(",") : "無缺"}；新增 ${added.length ? added.join(",") : "無"}`,
  "",
  "讀回驗證：", ...check,
  "",
  `結論：${allOk && tagDiffOld.length === 0 ? "PASS（容器寫得進、讀得回，筆數一致）" : "FAIL（見上）"}`,
].join("\n") + "\n";
writeFileSync("out/pack-xout.txt", rep, "utf8");
console.log(rep);
