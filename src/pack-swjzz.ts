/**
 * pack-swjzz.ts — 用 swjzz 工作區自己的管線重建 swjzz.adb（不互抄產生器）
 *
 *   bun run src/pack-swjz.ts → 我这边建 swjz；这支是 **呼叫母區 ts/tools/swjz-pack.ts**
 *   bun run src/pack-swjzz.ts            → out/swjzz.rebuild.adb（先比對，不覆蓋 accelon3）
 *   bun run src/pack-swjzz.ts --ship     → 比對通過後才落地 D:\accelon3\swjzz.adb（舊檔先備份）
 *
 * 為什麼要包一層：swjz-pack.ts 的第 4、5 參數是 dbcname（CJK），
 * 經 PowerShell 傳參會走 codepage 而變成亂碼 → 用 Node 直接 spawn（UTF-16 argv）才正確。
 */
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";

const TOOL = "D:/2026/adb-converter/ts/tools/swjz-pack.ts";
const TXT = "D:/2026/swjzz/build/swjz-seal.txt";        // ＝現行交付版的輸入
const SEAL = "D:/2026/swjzz/build/seal2";               // 7,052 個小篆 SVG
const OUT = "out/swjzz.rebuild.adb";
const SHIPPED = "D:\\accelon3\\swjzz.adb";
const SHIP = process.argv.includes("--ship");

if (!existsSync(TXT) || !existsSync(SEAL)) {
  console.error(`找不到 ${TXT} 或 ${SEAL}`);
  process.exit(1);
}

const run = spawnSync("bun", ["run", TOOL, TXT, OUT, "swjzz", "說文解字注", SEAL], { encoding: "utf8" });
if (run.status !== 0) {
  console.error("母區打包器回非零：\n" + (run.stderr ?? "") + (run.stdout ?? ""));
  process.exit(1);
}
const toolLog = (run.stderr ?? "").split(/\r?\n/).filter((l) => /wrote|resources|tags|caches|WARN/.test(l));

/* ---- 與現行交付版逐行比對（同一份文字應該只差 header 時間戳／壓縮雜訊）---- */
const mine = readFileSync(OUT);
const now = readFileSync(SHIPPED);
const sha = (b: Buffer): string => createHash("sha256").update(b).digest("hex");

const dump = "out/swjzz.xml";                             // 現行 adb 的解包（已抽好）
const rebuiltTxt = readFileSync(TXT, "utf8").replace(/\n$/, "").split("\n");
const shippedTxt = readFileSync(dump, "utf8").replace(/\n$/, "").split("\n");
let lineDiff = 0;
const first: string[] = [];
for (let i = 0; i < Math.max(rebuiltTxt.length, shippedTxt.length); i++) {
  if (rebuiltTxt[i] !== shippedTxt[i]) {
    lineDiff++;
    if (first.length < 4) first.push(`line ${i + 1}: 源 ${String(rebuiltTxt[i]).slice(0, 46)} ≠ adb ${String(shippedTxt[i]).slice(0, 46)}`);
  }
}

const rep = [
  "=== pack-swjzz（用 swjzz 區自己的管線重建）===",
  `輸入 ${TXT}  ${statSync(TXT).size.toLocaleString()} bytes`,
  `小篆 SVG 目錄 ${SEAL}：${readdirSync(SEAL).filter((f) => /\.svg$/i.test(f)).length} 個`,
  ...toolLog.map((l) => "  " + l),
  `輸出 ${OUT}  ${mine.length.toLocaleString()} bytes  sha ${sha(mine).slice(0, 12)}`,
  `現行 ${SHIPPED}  ${now.length.toLocaleString()} bytes  sha ${sha(now).slice(0, 12)}`,
  `大小差 ${mine.length - now.length}、完全相同=${sha(mine) === sha(now)}`,
  `源文字 vs adb 解包：不同行 ${lineDiff}／${shippedTxt.length}`,
  ...first.map((s) => "   " + s),
].join("\n") + "\n";
writeFileSync("out/swjzz-pack.txt", rep, "utf8");
console.log(rep);

if (SHIP) {
  if (lineDiff !== 0) {
    console.error("源文字與現行 adb 不一致 → 中止，請先確認要交付的是哪一版內容");
    process.exit(1);
  }
  const bak = "out/swjzz-original.adb";
  if (!existsSync(bak)) copyFileSync(SHIPPED, bak);
  copyFileSync(OUT, SHIPPED);
  console.log(`SHIP: 舊檔備份 ${bak}（sha ${sha(readFileSync(bak)).slice(0, 12)}），現行 sha ${sha(readFileSync(SHIPPED)).slice(0, 12)}`);
}
