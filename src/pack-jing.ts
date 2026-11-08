/**
 * pack-jing.ts — 用母區 authorAdb 打包 out/jing.adb（不覆蓋 D:\accelon3）
 *
 *   bun run src/pack-jing.ts            → out/jing.adb ＋ out/jing-pack.txt
 *
 * schema 沿用舊 13j.adb（見 out/13j.meta.txt）：
 *   dbname jing／dbcname 十三經／dbtype 0／srcBlockSize 16384
 *   validTags = 舊開標籤 9 個（集 隱 樹 書 頁元 頁 章 節 項）
 *   cachedTags = 舊 caches 鍵（書 章 集 項 節）
 *   resources = 無（舊庫 resources 是空的）
 * 紀律：先到 out/ 驗證；要複製到 D:\accelon3\jing.adb 必須另一步（且 jing 是新檔名，不覆蓋任何東西）。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { authorAdb } from "../../adb-converter/ts/src/adbauthor.ts";

const lines = readFileSync("out/jing.xml", "utf8").split("\n");
for (let i = 0; i < lines.length; i++) {
  if (/[\r\n]/.test(lines[i])) throw new Error(`line ${i + 1} 含 CR/LF，不能打包`);
}

const VALID = ["集", "隱", "樹", "書", "頁元", "頁", "章", "節", "項"];
const CACHED = ["書", "章", "集", "項", "節"];
// 舊 13j.adb 用 dualIndexSelfClosing='nonskip'：自閉合且非 skip 的標籤（頁元）要有 close hit，
// skip 標籤（頁）不要。authorAdb 的對應欄位是 dualSelfClosingTags（給了就以它為準）。
const DUAL = ["頁元"];

const res = await authorAdb({
  dbname: "jing",
  dbcname: "十三經",
  dbtype: 0,
  srcBlockSize: 16384,
  lines,
  validTags: VALID,
  cachedTags: CACHED,
  dualSelfClosingTags: DUAL,
  fullTextIndex: true,
});

/* 與舊庫標籤集合完全一致（差一個 /頁元 就會在这里爆） */
const oldTags = readFileSync("out/13j.meta.txt", "utf8").split(/\r?\n/)
  .filter((l) => /^\d+\t/.test(l)).map((l) => l.split("\t")[1]).filter(Boolean);
const missOld = oldTags.filter((t) => !res.tagNames.includes(t));
const extraNew = res.tagNames.filter((t) => !oldTags.includes(t));

writeFileSync("out/jing.adb", Buffer.from(res.file));
const sha = createHash("sha256").update(res.file).digest("hex");

const out = [
  "=== pack-jing ===",
  `lines         : ${res.lines}`,
  `tagNames      : ${res.tagNames.length}（${res.tagNames.join(" ")}）`,
  `cachedKeys    : ${res.cachedKeys.join(" ")}`,
  `tokens        : ${res.tokens}，tokenHits ${res.tokenHits}`,
  `srcBlocks     : ${res.srcBlocks}，maxBlockOffset ${res.maxBlockOffset}`,
  `textBytes     : ${res.textBytes}`,
  `resources     : ${res.resources}（${res.resourceBytes} bytes）`,
  `file          : out/jing.adb  ${res.file.length} bytes`,
  `sha256        : ${sha}`,
  `標籤對照舊庫  : ${missOld.length === 0 && extraNew.length === 0 ? "PASS（17 個完全一致）"
    : `FAIL 缺 ${missOld.join(",")} / 多 ${extraNew.join(",")}`}`,
].join("\n") + "\n";
writeFileSync("out/jing-pack.txt", out, "utf8");
console.log(`jing.adb: ${res.file.length} bytes, lines=${res.lines}, tags=${res.tagNames.length}, caches=${res.cachedKeys.length}, tagDiff=${missOld.length + extraNew.length}, sha=${sha.slice(0, 12)}`);
