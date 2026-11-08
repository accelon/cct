/**
 * verify-openlib.ts — openlib 連結的雙向可解析性驗證（全部重算，不吃建連結時的記憶體）
 *
 *   bun run src/verify-openlib.ts [adb路徑，預設 out/openlib.adb]
 *
 * ① xout 的目標錨點 `詞:<字頭[#N]>` 是否真的存在於 hydzd 自己的 anchorId 集合（並比 textHash）
 * ② xout 的來源錨點 `章:<id>` 是否真的存在於本庫 章.id（ readers 靠這個落地）
 * ③ 引文 n1 串重算：是否仍在該章、且起點與记录的 span 一致
 * ④ xrev 的 targetPage／targetDb 一致性
 * ⑤ 抽 3 條完整鏈路（字頭 → 引文 → 書名／章頁）給人工看
 */
import { readFileSync, writeFileSync } from "node:fs";
import { foldChars, loadFold } from "./jing-anchors.ts";
import { AdbReader, SyncIO } from "../../adb-converter/ts/src/accelon26/adb.ts";

const path = process.argv[2] ?? "out/openlib.adb";
const fold = loadFold();
const n1 = (s: string) => foldChars([...s.replace(/[^\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/g, "")], fold).n1;
const LIT = "D:/2026/openlit/out";

/* hydzd 端 anchorId → textHash */
const heads = new Map<string, string>();
{
  const t = readFileSync("out/hydzd-entry.tsv", "utf8").split(/\r?\n/);
  const c = t[0].split("\t");
  const iId = c.indexOf("anchorId"), iH = c.indexOf("textHash");
  for (let i = 1; i < t.length; i++) {
    const f = t[i].split("\t");
    if (!f[iId]) continue;
    heads.set(f[iId], f[iH]);              // anchorId 已自帶 #a（指派表的寫法），不再附加
  }
}

/* openlit：每本 → { title, chs: 章 id → n1 正文 }（章 id 在同本內唯一） */
type BookIx = { title: string; chs: Map<string, string> };
const byBk3 = new Map<string, BookIx>();
const chaptersOf = (bk3: string): BookIx => {
  const cached = byBk3.get(bk3);
  if (cached) return cached;
  const raw = readFileSync(`${LIT}/${bk3}.txt`, "utf8").split(/\r?\n/);
  const title = raw.find((l) => l.startsWith("<書 "))?.match(/<書 id="bk\d+"[^>]*>([\s\S]*?)<\/書>/)?.[1]?.trim() ?? "?";
  const chs = new Map<string, string>();
  let cur: string | null = null;
  for (const l of raw) {
    const h = l.match(/^<章 id="([^"]*)"/);
    if (h) { cur = h[1]; if (!chs.has(cur)) chs.set(cur, ""); continue; }
    if (cur === null || /^</.test(l) || l === "") continue;
    chs.set(cur, chs.get(cur)! + n1(l));
  }
  const ix = { title, chs };
  byBk3.set(bk3, ix);
  return ix;
};

const r = await AdbReader.open(new SyncIO(path));
const chAttr = await r.attributeValues("章.id");
const bkAttr = await r.attributeValues("書.id");
const pageSet = new Set(chAttr?.values ?? []);

type Xout = { ch: string; a: number; b: number; head: string; quote: string; hash: string; kind: string; conf: number };
const xout = readFileSync("out/xout_hydzd.jsonl", "utf8").split("\n").filter((l) => l).slice(1)
  .map((l) => {
    const x = JSON.parse(l) as [string, number, number, number, string, number, number, string, string, number, string];
    return { ch: x[0].replace(/^章:/, ""), a: x[2], b: x[3], head: x[4].replace(/^詞:/, ""), quote: x[7], hash: x[10], kind: x[8], conf: Number(x[9]) } satisfies Xout;
  });

/* 第二級（cite-var）用的 n2：把 Unihan 語義異體類折到代表字；第一級連結仍按 n1 驗，兩條標準不混 */
const VROOT = new Map<string, string>();
for (const l of readFileSync("data/char-variant.tsv", "utf8").split(/\r?\n/)) {
  if (!l || l.startsWith("#")) continue;
  const [c, root] = l.split("\t");
  if (c && root && c !== root) VROOT.set(c, root);
}
const toN2 = (s: string) => { let o = ""; for (const c of s) o += VROOT.get(c) ?? c; return o; };
const xrev = readFileSync("out/xrev.jsonl", "utf8").split("\n").filter((l) => l).slice(1)
  .map((l) => JSON.parse(l) as [string, string, number, string, string, string]);

/* xrev: 章 id → 是哪一本（用 audit 表的 hit 列還原，避免掃全部 657 本） */
const chToBk = new Map<string, string>();
for (const l of readFileSync("out/openlib-cites.tsv", "utf8").split(/\r?\n/)) {
  const isHit = /^hit(-var|-fuzzy)?\t/.test(l);   // 兩級連結都要還原成 章→書 對照
  if (!isHit) continue;
  const c = l.split("\t");
  if (c[9] && c[6]) chToBk.set(c[9], c[6]);
}


let h1 = 0, h1hash = 0, bad1: string[] = [];
for (const x of xout) {
  if (!heads.has(x.head)) { if (bad1.length < 5) bad1.push(x.head); continue; }
  h1++; if (heads.get(x.head) === x.hash) h1hash++;
}
let h2 = 0, bad2: string[] = [];
for (const x of xout) { if (pageSet.has(x.ch)) h2++; else if (bad2.length < 5) bad2.push(x.ch.slice(0, 18)); }

let h3 = 0, h3span = 0, v3 = 0, f3 = 0, f3sum = 0, bad3: string[] = [];
for (const x of xout) {
  const bk = chToBk.get(x.ch);
  if (!bk) { if (bad3.length < 5) bad3.push("查不到這本書：" + x.ch.slice(0, 12)); continue; }
  const bk3 = bk.padStart(3, "0");
  const raw = x.ch.includes("/") ? x.ch.slice(x.ch.indexOf("/") + 1) : x.ch;   // 錨點是 bkNNN/回目，正文索引仍用原回目
  const text = chaptersOf(bk3).chs.get(raw) ?? "";
  const q = n1(x.quote);
  if (!text || q.length === 0) { if (bad3.length < 5) bad3.push(`章內無文字 ${bk3}/${x.ch.slice(0, 10)}`); continue; }
  const hay = x.kind !== "cite" ? toN2(text) : text;        // 第二、三級都在 n2 座標下驗
  if (x.kind === "cite-fuzzy") {
    const pat = toN2(q);
    const win = hay.slice(x.a, x.a + pat.length);
    if (win.length !== pat.length) { if (bad3.length < 5) bad3.push(`${bk3}/${x.ch.slice(0, 10)} 視窗越界`); continue; }
    let same = 0;
    for (let k = 0; k < pat.length; k++) if (pat[k] === win[k]) same++;
    const ratio = same / pat.length;
    if (ratio < 0.8) { if (bad3.length < 5) bad3.push(`${bk3}/${x.ch.slice(0, 10)} 重算只有 ${(ratio * 100).toFixed(0)}%`); continue; }
    f3++; f3sum += ratio;
    if (Math.round(ratio * 100) !== x.conf) { if (bad3.length < 5) bad3.push(`${bk3} confidence=${x.conf} 但重算 ${Math.round(ratio * 100)}`); continue; }
    h3++; if (x.a >= 0) h3span++;
    continue;
  }
  const pat = x.kind === "cite-var" ? toN2(q) : q;
  const at = hay.indexOf(pat);
  if (at < 0) { if (bad3.length < 5) bad3.push(`${bk3}/${x.ch.slice(0, 10)} 引文不在章內`); continue; }
  h3++; if (at === x.a) h3span++;
  if (x.kind === "cite-var") v3++;
}

let h4 = 0, bad4: string[] = [];
for (const y of xrev) {
  if (y[0] !== "hydzd" || y[3] !== r.header.dbname || !pageSet.has(y[4])) { if (bad4.length < 5) bad4.push(`${y[3]}?${y[4].slice(0, 12)}`); continue; }
  h4++;
}

const rep = [
  "=== openlib 連結雙向驗證 ===",
  `本檔 ${path}  dbname=${r.header.dbname}  書 ${bkAttr?.values.length}  章.id ${chAttr?.values.length}（不同 id ${pageSet.size}）`,
  `xout ${xout.length} 筆｜xrev ${xrev.length} 筆`,
  `① 目標字頭存在於 hydzd：${h1}/${xout.length}${bad1.length ? "　缺 " + bad1.join("|") : "　✅"}`,
  `   textHash 與 hydzd-entry.tsv 一致：${h1hash}/${xout.length}`,
  `② 來源章 id 在本庫 章.id：${h2}/${xout.length}${bad2.length ? "　缺 " + bad2.join("|") : "　✅"}`,
  `③ 引文重算仍在該章：${h3}/${xout.length}；起點 span 也復現：${h3span}/${xout.length}（第二級 cite-var ${v3} 條按 n2 驗；第三級 cite-fuzzy ${f3} 條按視窗比例驗，平均 ${((f3sum / Math.max(1, f3)) * 100).toFixed(1)}%）${bad3.length ? "　異常 " + bad3.join(" | ") : ""}`,
  `④ xrev 三要素（srcDb=hydzd、targetDb=${r.header.dbname}、targetPage 存在）：${h4}/${xrev.length}${bad4.length ? "　異常 " + bad4.join("|") : "　✅"}`,
  "",
  "【抽 3 條完整鏈路】",
  ...xout.slice(0, 3).map((x, i) => {
    const bk = chToBk.get(x.ch);
    const bk3 = bk ? bk.padStart(3, "0") : "000";
    const ix = chaptersOf(bk3);
    return `  ${i + 1}. 字典〈${x.head}〉引「${x.quote.slice(0, 30)}…」 → 《${ix.title}》bk${bk3}「${x.ch.slice(0, 24)}」`;
  }),
  "",
  `結論：${h1 === xout.length && h2 === xout.length && h3 === xout.length && h4 === xrev.length ? "PASS（兩端都落得到真實錨點，引文可重算）" : "見上，未全數通過"}`,
].join("\n") + "\n";
writeFileSync("out/verify-openlib.txt", rep, "utf8");
console.log(rep);
