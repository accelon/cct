/**
 * haodoo-pack.ts — 把 updb2xml.py 產生的 Accelon XML 行打包成 .adb
 *
 *   bun run src/haodoo-pack.ts <haodoo-xxx.xml> [--no-index]
 *
 * 一行一個 adb 行（updb2xml 保證正文裡的 `<` `>` 已是全形，不會被誤判為標籤）。
 * 超過 4,000 字的長行先折開（沿用 tei-pack.ts 的 splitLongLine：不切進 `<…>` 標籤、
 * 不切開代理對），再交給 adb-converter 的 authorAdb 重建 source/tokens/tags/tables/
 * attributes/attributes.sorted 全部容器（byte-compatible 於 accelon3 閱讀器）。
 *
 * dbname 取自檔名；dbcname（中文顯示名）取自 raw/haodoo/manifest/adb-plan.tsv。
 * 產出的 .adb 與每筆清單（manifest.tsv）都寫在與 xml 同目錄（即 out/haodoo-adb/）。
 *
 * 注意：本程式 import 了 D:/2026/adb-converter/ts 的 authorAdb（絕對路徑），
 * 那個 repo 本身不被修改；壓縮靠 libbz2（bun:ffi），Windows 上由
 * C:/Program Files/Git/mingw64/bin/libbz2-1.dll 提供。
 */
import { existsSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { basename, dirname } from 'node:path';
import { authorAdb } from 'D:/2026/adb-converter/ts/src/adbauthor.ts';

const CCT = 'D:/2026/cct';
const PLAN_TSV = `${CCT}/raw/haodoo/manifest/adb-plan.tsv`;
const MANIFEST = `${CCT}/out/haodoo-adb/manifest.tsv`;

function sha256Hex(buf: Uint8Array): string {
  // 用 Node 的 crypto（abx 也用同套，便於交叉比對）
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const crypto = require('node:crypto');
  return crypto.createHash('sha256').update(Buffer.from(buf)).digest('hex');
}

function dbcnameFor(dbname: string): string {
  if (!existsSync(PLAN_TSV)) return dbname;
  const text = readFileSync(PLAN_TSV, 'utf8');
  const lines = text.split('\n');
  const header = lines[0].split('\t');
  const ai = header.indexOf('adb');
  const di = header.indexOf('dbcname');
  if (ai < 0 || di < 0) return dbname;
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split('\t');
    if (cols[ai] === dbname) return cols[di];
  }
  return dbname;
}

/**
 * 一行最多 4,000 字（authorAdb 的 MAXLINELEN = 8192 bytes = 4096 字）。
 * 超長行折開：不切進 `<…>` 標籤，也不切開代理對。
 */
const MAXCHARS = 4000;
function splitLongLine(line: string): string[] {
  if (line.length <= MAXCHARS) return [line];
  const out: string[] = [];
  let i = 0;
  while (i < line.length) {
    let end = Math.min(line.length, i + MAXCHARS);
    if (end < line.length) {
      const lt = line.lastIndexOf('<', end - 1);
      if (lt >= i && line.indexOf('>', lt) >= end) end = lt; // 退到標籤之前
      const hi = line.charCodeAt(end - 1);
      if (hi >= 0xd800 && hi <= 0xdbff) end--; // 不要切開代理對
      if (end <= i) end = Math.min(line.length, i + MAXCHARS); // 保險
    }
    out.push(line.slice(i, end));
    i = end;
  }
  return out;
}

async function main() {
  const rawArgs = process.argv.slice(2);
  const noIndex = rawArgs.includes('--no-index');
  const xmlFile = rawArgs.find((a) => !a.startsWith('--'));
  if (!xmlFile || !existsSync(xmlFile)) {
    console.error('usage: bun run src/haodoo-pack.ts <haodoo-xxx.xml> [--no-index]');
    process.exit(2);
  }
  const dbname = basename(xmlFile).replace(/\.xml$/i, '');
  const dbcname = dbcnameFor(dbname);
  const outDir = dirname(xmlFile);
  const outFile = `${outDir}/${dbname}.adb`;

  const text = readFileSync(xmlFile, 'utf8');
  let rawLines = text.split('\n').map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l));
  while (rawLines.length && rawLines[rawLines.length - 1] === '') rawLines.pop();
  const lines = rawLines.flatMap(splitLongLine);
  if (lines.length !== rawLines.length) {
    console.error(`long lines split: +${lines.length - rawLines.length} line(s)`);
  }
  const chars = lines.reduce((s, l) => s + l.length, 0);
  console.error(`read ${xmlFile}: ${rawLines.length} lines → ${lines.length} packed, ${chars.toLocaleString()} chars`);

  const t0 = Date.now();
  const res = await authorAdb({
    dbname,
    dbcname,
    lines,
    dbtype: 4,
    fullTextIndex: !noIndex,
    log: (m) => console.error(m),
  });
  writeFileSync(outFile, res.file);
  const secs = (Date.now() - t0) / 1000;
  const sha = sha256Hex(res.file);

  console.error(
    `wrote ${basename(outFile)}: ${(res.file.length / 1048576).toFixed(1)} MiB, ` +
      `${res.lines} lines, ${res.tokens} tokens/${res.tokenHits} hits${noIndex ? ' (no index)' : ''}, ` +
      `${res.tagNames.length} tags, maxVA=${res.maxBlockOffset}, ${secs.toFixed(1)}s`,
  );

  // 清單（可累加；每跑一個 ADB 就 append 一筆）
  const row = [
    dbname,
    dbcname,
    res.file.length,
    res.lines,
    res.tokens,
    res.tokenHits,
    chars,
    sha,
    secs.toFixed(1),
  ].join('\t');
  if (!existsSync(MANIFEST)) {
    appendFileSync(MANIFEST, 'dbname\tdbcname\tbytes\tlines\ttokens\thits\tchars\tsha256\tsecs\n');
  }
  appendFileSync(MANIFEST, row + '\n');
  console.log(row);
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
