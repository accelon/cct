/**
 * pack-openlib.ts — 把「657 本小說 ＋ hydzd 書證連結」打成單一 adb（ dbname=openlib ）
 *
 *   bun run src/pack-openlib.ts          # 輸出 out/openlib.adb（不覆蓋任何既有庫）
 *
 * 與 openlit.adb 的差別只有兩件事：
 *   ① dbname／dbcname 換掉（xrev 的 targetDb="openlib" 必須與 dbname 一致，否則讀者配不上）
 *   ② 多兩個容器：xout_hydzd（正向，六階段架構）＋ xrev（反向，母區讀者現在只認這個）
 * 正文行完全沿用 D:\2026\openlit\out\*.txt 的產物（不重讀 372 MB 的 openlit.adb）。
 */
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { authorAdb } from "../../adb-converter/ts/src/adbauthor.ts";
import { buildContainer } from "../../adb-converter/ts/src/romblock.ts";
import { AdbReader, SyncIO } from "../../adb-converter/ts/src/accelon26/adb.ts";

const LIT = "D:/2026/openlit/out";
const files = readdirSync(LIT).filter((f) => /^\d+\.txt$/.test(f)).sort();
if (!files.length) { console.error("openlit 的 out/*.txt 不见了"); process.exit(2); }

const lines: string[] = ["<集>開文庫小說</集>", '<隱><樹 s="*" t="書">目錄</樹></隱>', ""];
let idFixed = 0;
for (const f of files) {
  const bkKey = `bk${f.replace(".txt", "").padStart(3, "0")}`;
  const tsv = readFileSync(`${LIT}/${f}`, "utf8").replace(/\r?\n$/, "").split(/\r?\n/);
  for (const raw0 of tsv) {
    // 章 id 加書目前綴 → 全庫唯一（657 本裡有 401 種回目跨書撞名，連結不能含糊）
    const l = /^<章 id="/.test(raw0) ? raw0.replace(/^<章 id="/, `<章 id="${bkKey}/`) : raw0;
    if (l !== raw0) idFixed++;
    if (/[\r\n]/.test(l)) throw new Error(`${f} 行內有 CR/LF`);
    if (l.length > 4000) throw new Error(`${f} 行超過 4,000：${l.length}`);
    lines.push(l);
  }
  lines.push("", "");
}

/* 連結容器 */
const extra: Record<string, Uint8Array> = {};
const info: { name: string; records: number }[] = [];
for (const [path, name, hdr] of [["out/xout_hydzd.jsonl", "xout_hydzd", "XOUT1"], ["out/xrev.jsonl", "xrev", "XREV1"]] as const) {
  const bytes = Buffer.from(readFileSync(path, "utf8"), "utf8");
  const first = JSON.parse(bytes.toString("utf8").split("\n")[0]) as unknown[];
  if (first[0] !== hdr) throw new Error(`${path} 的標頭不是 ${hdr}（是 ${String(first[0])}）`);
  extra[name] = new Uint8Array(buildContainer({ feature: 0, blocks: [bytes] }));
  info.push({ name, records: bytes.toString("utf8").split("\n").filter((l) => l.length > 0).length - 1 });
}

const res = await authorAdb({
  dbname: "openlib", dbcname: "開文庫小說（附漢語大字典書證）", dbtype: 0, srcBlockSize: 16384,
  lines, validTags: ["集", "隱", "樹", "書", "章"], cachedTags: ["書", "章", "集"],
  fullTextIndex: true, extraContainers: extra,
});
writeFileSync("out/openlib.adb", Buffer.from(res.file));
const sha = createHash("sha256").update(res.file).digest("hex");

/* ───────── 驗回 ───────── */
const r = await AdbReader.open(new SyncIO("out/openlib.adb"));
const bk = await r.attributeValues("書.id");
const ch = await r.attributeValues("章.id");
const pageSet = new Set(ch?.values ?? []);
const check: string[] = [];
let ok = true;

for (const m of info) {
  const c = r.containers.get(m.name);
  if (!c) { check.push(`  ✗ ${m.name} 容器不存在`); ok = false; continue; }
  const txt = Buffer.from(await r.readBlock(m.name, 0)).toString("utf8");
  const rows = txt.split("\n").filter((l) => l.length > 0);
  const head = JSON.parse(rows[0]) as unknown[];
  const n = rows.length - 1;
  // 標頭欄位序不同：XOUT1 = [標頭, work, 筆數, hash, edition]；XREV1 = [標頭, 筆數]
  const declared = m.name === "xrev" ? Number(head[1]) : Number(head[2]);
  const cntOk = n === m.records && declared === n;
  check.push(`  ${cntOk ? "✓" : "✗"} ${m.name}: 寫入 ${m.records}、讀回 ${n}、標頭 ${String(head[0])}${m.name === "xrev" ? "" : " work=" + String(head[1])}、宣告 ${declared}`);
  if (!cntOk) ok = false;

  if (m.name === "xrev") {
    // 關鍵一哩：每條 targetPage（第 5 欄）都必須是本章庫真的有的 章.id，否則讀者永遠配不到
    let hit = 0, bad: string[] = [];
    for (const l of rows.slice(1)) {
      const rec = JSON.parse(l) as [string, string, number, string, string, string];
      if (rec[3] !== "openlib") { bad.push(`targetDb=${rec[3]}`); continue; }
      if (pageSet.has(rec[4])) hit++; else if (bad.length < 5) bad.push(rec[4].slice(0, 18));
    }
    check.push(`  ${bad.length === 0 ? "✓" : "✗"} xrev 的 targetPage 全部命中 章.id：${hit}/${n}${bad.length ? "　例外 " + bad.join(" | ") : ""}`);
    if (bad.length) ok = false;
    const pages = new Set(rows.slice(1).map((l) => (JSON.parse(l) as string[])[4]));
    const heads = new Set(rows.slice(1).map((l) => (JSON.parse(l) as string[])[1]));
    check.push(`  · 覆蓋 ${pages.size} 個章節頁、${heads.size} 個字典字頭`);
  }
}
const rep = [
  "=== pack-openlib ===",
  `來源 ${files.length} 本（D:\\2026\\openlit\\out\\*.txt）、行 ${lines.length.toLocaleString()}、章 id 加書目前綴 ${idFixed.toLocaleString()} 處`,
  `連結容器：${info.map((i) => `${i.name}(${i.records})`).join(" ")}`,
  `out/openlib.adb  ${res.file.length.toLocaleString()} bytes  sha256 ${sha.slice(0, 12)}`,
  `讀回 dbname=${r.header.dbname}、dbtype=${r.header.dbType}、書.id ${bk?.values.length}、章.id ${ch?.values.length}` +
    `（頁面集合 ${pageSet.size} 種）、containers=${[...r.containers.keys()].join(" ")}`,
  "",
  "驗回：", ...check,
  "",
  `結論：${ok ? "PASS（容器在、筆數對、targetPage 全部落得到頁）" : "FAIL（見上）"}`,
].join("\n") + "\n";
writeFileSync("out/pack-openlib.txt", rep, "utf8");
console.log(rep);
