/**
 * build-openlib-links.ts — openlib（657 本小說）↔ hydzd（漢語大字典）書證的字元級連結
 *
 *   bun run src/build-openlib-links.ts --suggest      # 只列「對不上但有疑似」的書名候選
 *   bun run src/build-openlib-links.ts                # 正式建連結（含 xrev／xout／稽核表）
 *   bun run src/build-openlib-links.ts --quote-min=8  # 引文最少幾個汉字（預設 8）
 *
 * 輸入
 *   out/hydzd.xml                      字典原文（<詞> 字頭、<例 t="…"> zone、書證行）
 *   out/hydzd-entry.tsv                字頭 anchorId／textHash（本腳本沿用同一 textHash 口徑）
 *   D:\2026\openlit\out\<id>.txt       657 本小說（<書>/<章> 標記＋正文）
 *
 * 輸出
 *   out/xout_hydzd.jsonl               正向：openlib 的章 → hydzd 的字頭（XOUT1，沿用 link-swjzz-to-jing 的行形狀）
 *   out/xrev.jsonl                     反向：hydzd 引了 openlib 哪一頁（XREV1，母區讀者目前只認這個）
 *   out/openlib-cites.tsv              逐條稽核：命中/多命中/搜不到/書名未配，全留痕
 *   out/openlib-cites-report.txt       統計摘要
 *
 * 比對標準（用戶定的「同名＋別名表」，逐字元命中是底線）
 *   兩邊都走 n1 摺疊（NFKC→首個漢字→OpenCC s2t→首個漢字→VMAP），只留漢字後做 indexOf
 *   → 繁簡／異體差異不影響命中，但不做任何模糊／省字容忍（省字會錯鏈，進另一級再談）
 */
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { foldChars, loadFold } from "./jing-anchors.ts";

const SUGGEST = process.argv.includes("--suggest");
const QUOTE_MIN = Number(process.argv.find((a) => a.startsWith("--quote-min="))?.slice(12) ?? 8);   // 只約束第三級
const MIN_HAN = Number(process.argv.find((a) => a.startsWith("--min-han="))?.slice(10) ?? 2);        // 精確級（①②）的最短引文
const fold = loadFold();
let foldMiss = 0;

/** 字元級比對用的正規化：只留漢字 → n1 摺疊 */
const n1 = (s: string): string => {
  const h = s.replace(/[^\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/g, "");
  const r = foldChars([...h], fold);
  foldMiss += r.miss;
  return r.n1;
};

/* n2＝在 n1 之上再併 Unihan 語義異體類（data/char-variant.tsv）。
 * 只拿去做「找回引文」的比對，不参与 textHash（hash 一律 n1，免得與 gycd 失去可比性）。
 * 表不存在或 --no-variant 時整個第二級關閉，第一級結果與前次逐字元相同。 */
const VROOT = new Map<string, string>();
if (!process.argv.includes("--no-variant") && existsSync("data/char-variant.tsv")) {
  for (const l of readFileSync("data/char-variant.tsv", "utf8").split(/\r?\n/)) {
    if (!l || l.startsWith("#")) continue;
    const [c, root] = l.split("\t");
    if (c && root && c !== root) VROOT.set(c, root);
  }
}
const n2 = (s: string): string => {
  if (!VROOT.size) return s;
  let o = "";
  for (const c of s) o += VROOT.get(c) ?? c;
  return o;
};
const variantOn = VROOT.size > 0;

/* ───────── openlit 書名／章 索引 ───────── */
type Ch = { id: string; n1: string };
type Book = { id: string; title: string; key: string; chs: Ch[] };
const LIT = "D:/2026/openlit/out";
const books: Book[] = [];
for (const f of readdirSync(LIT).filter((x) => /^\d+\.txt$/.test(x)).sort()) {
  const id = f.replace(".txt", "");
  const raw = readFileSync(`${LIT}/${f}`, "utf8").split(/\r?\n/);
  const t = raw.find((l) => l.startsWith("<書 "))?.match(/<書 id="bk\d+"[^>]*>([\s\S]*?)<\/書>/)?.[1] ?? "";
  const chs: Ch[] = [];
  let cur: Ch | null = null;
  for (const l of raw) {
    const m = l.match(/^<章 id="([^"]*)"/);
    if (m) { cur = { id: m[1], n1: "" }; chs.push(cur); continue; }
    if (/^</.test(l) || l === "") continue;
    if (cur) cur.n1 += n1(l);
  }
  books.push({ id, title: t.trim(), key: n1(t), chs });
}
const byKey = new Map<string, Book[]>();
for (const b of books) {
  if (!b.key) continue;
  if (!byKey.has(b.key)) byKey.set(b.key, []);
  byKey.get(b.key)!.push(b);
}

/* ───────── 三級書名解析（各級都可查核，不模糊配對）─────────
 * ① 同名：hydzd 寫的書名 n1 後與 openlit 書名 n1 完全相等
 * ② 切篇：hydzd 常把篇名寫進書名（《世説新語‧文學》《徐霞客遊記‧粤西遊日記一》）
 *         → 取第一個分隔號之前的「書名本體」再比 ①（一次救回幾百種篇名寫法）
 * ③ 別名：真正的書名改稱，逐條人工寫（照 data/openlit-titles.tsv 的實際寫法，不憑記憶）
 * 同書多本（如 歷史通俗演義 bk112／bk117）由 byKey 自動給多候選，不算模糊。
 */
const ALIAS_RAW: Record<string, string> = {
  "水滸傳": "水滸全傳",           // bk019（bk632 古本水滸傳、bk633 後水滸傳、bk142 水滸後傳各有本名，不受影響）
  "石頭記": "紅樓夢",             // bk006
  "聊齋志異": "聊齋誌異",         // bk090（本庫用「誌」）
  "聊齋": "聊齋誌異",
  "封神榜": "封神演義",           // bk017（bk005 封神演義一改 另有本名）
  "拍案驚奇": "初刻拍案驚奇",      // bk092（二刻 bk097、三刻 bk634 不受影響）
  "古今小說": "喻世明言",          // bk093（《喻世明言》初題「古今小說」）
  "列國志": "東周列國志",          // bk020
  "醒世恒言": "醒世恆言",          // bk096
  "俠女奇緣": "兒女英雄傳",        // bk087
  "嶽武穆王精忠傳": "說岳全傳",     // bk032
  "鏡花緣全傳": "鏡花緣",          // bk086
};
const ALIAS = new Map<string, string>(Object.entries(ALIAS_RAW).map(([k, v]) => [n1(k), v]));
const ALIAS_BK = new Map<string, string>();       // 別名目標書名 → 它的 n1 key
for (const v of new Set(Object.values(ALIAS_RAW))) ALIAS_BK.set(v, n1(v));
const SEP = /[‧··・/、，,]/;                        // 書名與篇名的分隔號

const lookup = (k: string): Book[] | null => (k && byKey.get(k)) ?? null;
/** 回傳候補書＋配上的是哪一級（① name ② dot ③ alias） */
const resolveBook = (name: string): { books: Book[]; how: "name" | "dot" | "alias" } | null => {
  const k = n1(name);
  const direct = lookup(k);
  if (direct) return { books: direct, how: "name" };
  const head = name.split(SEP)[0].trim();
  const hk = n1(head);
  if (hk !== k) {
    const d2 = lookup(hk);
    if (d2) return { books: d2, how: "dot" };
  }
  const al = ALIAS.get(k) ?? (hk !== k ? ALIAS.get(hk) : undefined);
  if (al) {
    const d3 = lookup(ALIAS_BK.get(al)!);
    if (d3) return { books: d3, how: "alias" };
  }
  return null;
};

/* ───────── hydzd 端：anchorId ＋ hash（一律沿用指派表，不自己數 #N）─────────
 * assign-hydzd-ids.ts 的規劃：唯一字頭→裸字頭；重複字頭→「字頭#a」（每一筆都帶 #a）
 * 所以查表以 <詞> 那一行（xml 行號）為準，這樣開頭第一筆（如 二#1）也不會被我寫成裸「二」。
 */
const idByLine = new Map<number, string>();
{
  const t = readFileSync("out/hydzd-id-assign.tsv", "utf8").split(/\r?\n/);
  const c = t[0].split("\t");
  const iLine = c.indexOf("line"), iAnchor = c.indexOf("anchorId建議");
  for (let i = 1; i < t.length; i++) {
    const f = t[i].split("\t");
    if (f[iLine]) idByLine.set(Number(f[iLine]), f[iAnchor]);
  }
}
const headHash = new Map<string, string>();
{
  const tsv = readFileSync("out/hydzd-entry.tsv", "utf8").split(/\r?\n/);
  const cols = tsv[0].split("\t");
  const iId = cols.indexOf("anchorId"), iH = cols.indexOf("textHash");
  for (let i = 1; i < tsv.length; i++) {
    const c = tsv[i].split("\t");
    if (!c[iId]) continue;
    if (!headHash.has(c[iId])) headHash.set(c[iId], c[iH]);
  }
}

/* ───────── hydzd.xml 逐行掃描 ───────── */
const xml = readFileSync("out/hydzd.xml", "utf8").split(/\r?\n/);
const HEAD = /^<詞([^>]*)>([\s\S]*?)<\/詞>\s*$/;
const ZONE = /<例[^>]*\bt="([^"]*)"/;
const BOOKQ = /《([^》\n]{1,20})》/;
const CITE = /“((?:[^“”]|‘[^’]*’)+)”/;      // 引文：“…”（內層 ‘…’ 可嵌套）
const VOL  = /^(?:又|按)?\s*第?([一二三四五六七八九十百零〇\d]{1,8})\s*[回卷折章篇則節]/;

type Cite = { head: string; headKey: string; zoneSeq: number; zoneT: string; book: string; vol: string; quote: string; line: number; inherited: boolean };
const cites: Cite[] = [];
let head = "", headKey = "", zoneSeq = 0, zoneT = "", lastBook = "";

for (let i = 0; i < xml.length; i++) {
  const l = xml[i];
  const hm = l.match(HEAD);
  if (hm) {
    head = hm[2].trim();
    headKey = idByLine.get(i + 1) ?? head;          // 以指派表為準（重複字頭每筆都帶 #a）
    zoneSeq = 0; zoneT = ""; lastBook = "";
    continue;
  }
  if (!head) continue;
  const zm = l.match(ZONE);
  if (zm) { zoneSeq++; zoneT = zm[1]; lastBook = ""; continue; }
  if (/^</.test(l.trim())) continue;                       // 標籤行不當書證
  if (!l.includes("《") && !VOL.test(l.trim())) continue;   // 沒書名也不是「又第N回」式續引
  const bm = l.match(BOOKQ);
  let book = "", inherited = false;
  if (bm) { book = bm[1].trim(); lastBook = book; }
  else if (lastBook) { book = lastBook; inherited = true; }
  else continue;
  const qm = l.match(CITE);
  if (!qm) continue;
  const vm = l.match(VOL);
  cites.push({ head, headKey, zoneSeq: Math.max(zoneSeq, 1), zoneT, book, vol: vm ? `第${vm[1]}` : "", quote: qm[1].trim(), line: i + 1, inherited });
}

/* ───────── 書名配對統計 ───────── */
const matchedBooks = new Map<string, number>();
const unmatched = new Map<string, number>();
const howTally = { name: 0, dot: 0, alias: 0 } as Record<string, number>;
for (const c of cites) {
  const r = resolveBook(c.book);
  if (r) { matchedBooks.set(c.book, (matchedBooks.get(c.book) ?? 0) + 1); howTally[r.how]++; }
  else unmatched.set(c.book, (unmatched.get(c.book) ?? 0) + 1);
}

if (SUGGEST) {
  /* 精準候選：一方書名完整包含另一方（≥3 字），或同幹（前 2 字相同）且同尾類（傳/演義/記/錄/話本…）
   * 上一版用「2 字共同子串」跑出來的都是垃圾（史記‧司馬相如列傳 ↔ 海上花列傳），故改規則 */
  const SUFFIX = /(演義|外史|全傳|後傳|前傳|小傳|傳|記|錄|譜|案|話本|緣|志|吟|史|傳奇|彈詞|演义)$/;
  const stem = (k: string) => k.replace(SUFFIX, "");
  const sug: string[] = [];
  const uk = [...unmatched.entries()].sort((a, b) => b[1] - a[1]);
  for (const [name, n] of uk.slice(0, 1200)) {
    const k = n1(name);
    if (k.length < 2) continue;
    const hits: string[] = [];
    for (const b of books) {
      if (b.key.length < 2) continue;
      let why = "";
      if (b.key.includes(k) && k.length >= 3) why = "內含";
      else if (k.includes(b.key) && b.key.length >= 3) why = "含它";
      else if (stem(k) === stem(b.key) && stem(k).length >= 2) why = "同幹";
      if (why) hits.push(`${b.id}:${b.title}[${why}]`);
    }
    if (hits.length) sug.push(`《${name}》 ${n} 次 → ${hits.slice(0, 4).join(" ")}`);
  }
  const rep = [
    "=== 別名候選（人工定案，腳本不自作主張）===",
    `cites 共 ${cites.length.toLocaleString()} 條；書名直接對上 ${matchedBooks.size} 種／${[...matchedBooks.values()].reduce((a, b) => a + b, 0).toLocaleString()} 條`,
    `對不上 ${unmatched.size} 種，其中符合「包含／同幹」者 ${sug.length} 種，按書證次數排列：`,
    ...sug.slice(0, 80),
    "",
    `（摺疊表 miss ${foldMiss.toLocaleString()} 次）`,
  ].join("\n") + "\n";
  writeFileSync("out/openlib-alias-suggest.txt", rep, "utf8");
  console.log(rep.split("\n").slice(0, 14).join("\n"));
  process.exit(0);
}

/* ───────── 字元級命中 ───────── */
/* 章 id 在 657 本裡有 401 種跨書撞名（如「第五卷」），連結必須落到唯一頁 → openlib 統一用 `bkNNN/回目`
 * 對應的正文 id 由 pack-openlib.ts 一起改寫（這是新庫，不影響 openlit.adb 的既有 id） */
const pageKey = (bk: Book, chId: string) => `bk${bk.id.padStart(3, "0")}/${chId}`;

/* 第二級用的 n2 正文快取（n2 是逐字 1:1 映射，長度與 n1 相同 → span 起點兩者通用） */
const n2Cache = new Map<string, string[]>();
const n2of = (bk: Book) => {
  const k = bk.id;
  let a = n2Cache.get(k);
  if (!a) { a = bk.chs.map((c) => n2(c.n1)); n2Cache.set(k, a); }
  return a;
};

/* 第三級：探針錨定的容忍對齊（用戶標準「≥80% 字元正確即算有用引文」）
 * 做法：在引文上等距取最多 5 個 K=4 字探針 → 在章內 indexOf 探針 → 由探針在引文中的偏移反推起點
 *       → 同長度視窗逐位比對取相同字比例。能吃到「版本異文／傳抄錯字／字典省字」三類差異。
 * 防錯鏈：起點去重（同視窗不重複計）；最佳與次佳比例差 <0.05 視為含糊，不硬鏈。 */
const FUZZY_MIN = Number(process.argv.find((a) => a.startsWith("--fuzzy-min="))?.slice(12) ?? 0.8);
const fuzzyOn = !process.argv.includes("--no-fuzzy");
const FUZZY_K = 4;
function fuzzyFind(bks: Book[], q2: string): { bk: Book; ch: Ch; a: number; score: number } | "ambig" | null {
  if (q2.length < FUZZY_K + 2) return null;
  const spots = [0, Math.floor(q2.length * 0.25), Math.floor(q2.length * 0.5), Math.floor(q2.length * 0.75), Math.max(0, q2.length - FUZZY_K)]
    .filter((v, i, a) => a.indexOf(v) === i);
  const probes = spots.map((s) => ({ s, p: q2.slice(s, s + FUZZY_K) }));
  const seen = new Set<string>();
  let best: { bk: Book; ch: Ch; a: number; score: number } | null = null;
  let second = 0;
  for (const bk of bks) {
    const arr = n2of(bk);
    for (let i = 0; i < arr.length; i++) {
      const t = arr[i];
      if (t.length < q2.length) continue;
      for (const { s, p } of probes) {
        let at = t.indexOf(p);
        while (at >= 0) {
          for (let d = -2; d <= 2; d++) {                    // 省字／衍字會讓整段偏移，±2 內取最佳
            const start = at - s + d;
            if (start < 0 || start + q2.length > t.length) continue;
            const key = `${bk.id}|${i}|${start}`;
            if (seen.has(key)) continue;
            seen.add(key);
            let same = 0;
            for (let k = 0; k < q2.length; k++) if (t[start + k] === q2[k]) same++;
            const score = same / q2.length;
            if (score >= FUZZY_MIN) {
              if (!best || score > best.score) { if (best) second = Math.max(second, best.score); best = { bk, ch: bk.chs[i], a: start, score }; }
              else second = Math.max(second, score);
            }
          }
          at = t.indexOf(p, at + 1);
        }
      }
    }
  }
  if (!best) return null;
  return second > 0 && best.score - second < 0.05 ? "ambig" : best;
}

type Row = { c: Cite; bk: Book; ch: Ch; a: number; b: number; nHits: number; bookN: number; how: string; isVar: boolean; isFuzzy: boolean; score: number };
const rows: Row[] = [];
const audit: string[] = ["status\tline\thead\tzoneT\tbook\thow\tresolvedBk\tquoteHan\tquote\tchId\tspan"];
for (const c of cites) {
  const q = n1(c.quote);
  if (q.length < MIN_HAN) { audit.push(`short\t${c.line}\t${c.head}\t${c.zoneT}\t${c.book}\t-\t-\t${q.length}\t${c.quote}\t-\t-`); continue; }
  const cand = resolveBook(c.book);
  if (!cand) { audit.push(`nobook\t${c.line}\t${c.head}\t${c.zoneT}\t${c.book}\t-\t-\t${q.length}\t${c.quote}\t-\t-`); continue; }
  let found: { bk: Book; ch: Ch; a: number; n: number }[] = [];
  for (const bk of cand.books) {
    for (const ch of bk.chs) {
      let p = ch.n1.indexOf(q), n = 0;
      while (p >= 0) { n++; if (n === 1) found.push({ bk, ch, a: p, n }); p = ch.n1.indexOf(q, p + 1); if (n > 4) break; }
    }
  }
  let isVar = false;
  if (!found.length && variantOn) {                       // 第二級：n2（n1 ＋ Unihan 語義異體類）再試一次
    const q2 = n2(q);
    if (q2 !== q) {
      let vn = 0;
      for (const bk of cand.books) {
        const arr = n2of(bk);
        for (let i = 0; i < arr.length; i++) {
          let p = arr[i].indexOf(q2);
          while (p >= 0) { vn++; if (vn === 1) found.push({ bk, ch: bk.chs[i], a: p, n: 1 }); p = arr[i].indexOf(q2, p + 1); if (vn > 4) break; }
          if (vn > 4) break;
        }
        if (vn > 4) break;
      }
      if (found.length === 1) isVar = true;
      else if (found.length) {
        audit.push(`ambig-var\t${c.line}\t${c.head}\t${c.zoneT}\t${c.book}\t${cand.how}\t${cand.books.map((b) => b.id).join("/")}\t${q.length}\t${c.quote}\t-\t-`);
        continue;
      }
    }
  }
  let isFuzzy = false, score = 1;
  if (!found.length && fuzzyOn && q.length >= QUOTE_MIN) {                          // 第三級：容忍對齊（≥FUZZY_MIN 比例）
    const fz = fuzzyFind(cand.books, n2(q));
    if (fz === "ambig") {
      audit.push(`ambig-fuzzy\t${c.line}\t${c.head}\t${c.zoneT}\t${c.book}\t${cand.how}\t${cand.books.map((b) => b.id).join("/")}\t${q.length}\t${c.quote}\t-\t-`);
      continue;
    }
    if (fz) { found = [{ bk: fz.bk, ch: fz.ch, a: fz.a, n: 1 }]; isFuzzy = true; score = fz.score; }
  }
  if (!found.length) { audit.push(`miss\t${c.line}\t${c.head}\t${c.zoneT}\t${c.book}\t${cand.how}\t${cand.books.map((b) => b.id).join("/")}\t${q.length}\t${c.quote}\t-\t-`); continue; }
  if (found.length > 1) {
    audit.push(`ambiguous\t${c.line}\t${c.head}\t${c.zoneT}\t${c.book}\t${cand.how}\t${found.map((f) => f.bk.id).join("/")}\t${q.length}\t${c.quote}\t${found.slice(0, 3).map((f) => f.ch.id.slice(0, 12)).join("|")}\t-`);
    continue;
  }
  const f = found[0];
  rows.push({ c, bk: f.bk, ch: f.ch, a: f.a, b: f.a + q.length, nHits: f.n, bookN: cand.books.length, how: cand.how, isVar, isFuzzy, score });
  audit.push(`${isFuzzy ? "hit-fuzzy" : isVar ? "hit-var" : "hit"}\t${c.line}\t${c.head}\t${c.zoneT}\t${c.book}\t${cand.how}\t${f.bk.id}\t${q.length}\t${c.quote}\t${pageKey(f.bk, f.ch.id)}\t${f.a}-${f.a + q.length}\t${score.toFixed(3)}`);
}

/* ───────── 產出 xout_hydzd.jsonl（正向）───────── */
const manHash = createHash("sha256").update(rows.map((r) => `${r.c.headKey}\t${headHash.get(r.c.headKey) ?? ""}`).join("\n"), "utf8").digest("hex").slice(0, 16);
const xout = [JSON.stringify(["XOUT1", "hydzd", rows.length, `sha256:${manHash}`, "openlib"])];
for (const r of rows) {
  xout.push(JSON.stringify([
    `章:${pageKey(r.bk, r.ch.id)}`, -1, r.a, r.b,                       // 來源：openlib 的章 ＋ 章內字元區間
    `詞:${r.c.headKey}`, 0, n1(r.c.quote).length,          // 目標：hydzd 字頭 anchor
    r.c.quote, r.isFuzzy ? "cite-fuzzy" : r.isVar ? "cite-var" : "cite",
    r.isFuzzy ? Math.round(r.score * 100) : r.isVar ? 80 : 100, headHash.get(r.c.headKey) ?? "",
  ]));
}
writeFileSync("out/xout_hydzd.jsonl", xout.join("\n") + "\n", "utf8");

/* ───────── 產出 xrev.jsonl（反向，母區讀者讀這個）─────────
 * 行形狀 ["<srcDb>","<srcPage>",<srcVa>,"<targetDb>","<targetPage>","<quote>"]
 * srcVa 填 0：母區 anchorIndex 用的是「宿主庫」座標系，跨庫 va 沒有意義（見報告 §caveat）
 */
const xrev = [JSON.stringify(["XREV1", rows.length])];
for (const r of rows) xrev.push(JSON.stringify(["hydzd", r.c.headKey, 0, "openlib", pageKey(r.bk, r.ch.id), r.c.quote]));
writeFileSync("out/xrev.jsonl", xrev.join("\n") + "\n", "utf8");

/* ───────── 報告 ───────── */
const perBook = new Map<string, number>();
const perHead = new Map<string, number>();
for (const r of rows) {
  perBook.set(r.bk.id, (perBook.get(r.bk.id) ?? 0) + 1);
  perHead.set(r.c.book, (perHead.get(r.c.book) ?? 0) + 1);
}
const count = (s: string) => audit.filter((l) => l.startsWith(s + "\t")).length;
const rep = [
  "=== openlib ↔ hydzd 書證連結 ===",
  `hydzd 書證解析：${cites.length.toLocaleString()} 條（含續引 ${cites.filter((c) => c.inherited).length.toLocaleString()} 條）`,
  `比對標準：精確級引文 ≥ ${MIN_HAN} 字、容忍級 ≥ ${QUOTE_MIN} 字（${(FUZZY_MIN*100).toFixed(0)}% 相同字）；書名解析 ①同名 ②切篇名 ③別名表 ${Object.keys(ALIAS_RAW).length} 条`,
  `書名配上來路：①同名 ${howTally.name.toLocaleString()}　②切「書名‧篇名」${howTally.dot.toLocaleString()}　③別名 ${howTally.alias.toLocaleString()}（單位：條書證）`,
  `連結裡各來路：${["name", "dot", "alias"].map((k) => `${k} ${rows.filter((r) => r.how === k).length.toLocaleString()}`).join("　")}`,
  `結果：命中 ${rows.length.toLocaleString()}｜多命中 ${(count("ambiguous")).toLocaleString()}｜搜不到 ${(count("miss")).toLocaleString()}｜書名未配 ${(count("nobook")).toLocaleString()}｜引文過短 ${(count("short")).toLocaleString()}`,
  `第二級 n2（n1＋Unihan 語義異體類）：${variantOn ? `啟用，${VROOT.size.toLocaleString()} 個字有別的代表字` : "未啟用"}`,
  `n2 贖回：${rows.filter((r) => r.isVar && !r.isFuzzy).length.toLocaleString()} 條（佔全部連結的 ${((rows.filter((r) => r.isVar && !r.isFuzzy).length / Math.max(1, rows.length)) * 100).toFixed(1)}%）；n2 後仍多命中 ${count("ambig-var")} 條`,
  `第三級容忍對齊：${fuzzyOn ? `啟用，門檻 ≥${(FUZZY_MIN * 100).toFixed(0)}% 相同字` : "未啟用"}`,
  `第3級贖回：${rows.filter((r) => r.isFuzzy).length.toLocaleString()} 條｜因含糊被擋：${count("ambig-fuzzy").toLocaleString()} 條`,
  `第3級分數分布：${[...Array(10)].map((_, i) => { const lo = 0.8 + i * 0.02, hi = lo + 0.02; const n = rows.filter((r) => r.isFuzzy && r.score >= lo && r.score < hi).length; return `${(lo * 100).toFixed(0)}-${(hi * 100).toFixed(0)}:${n}`; }).join(" ")}`,
  `連結長度分布：${[["2-4", 2, 5], ["5-7", 5, 8], ["8-15", 8, 16], ["16-30", 16, 31], ["31+", 31, 99999]].map(([n, lo, hi]) => {
    const k = rows.filter((r) => n1(r.c.quote).length >= (lo as number) && n1(r.c.quote).length < (hi as number)).length;
    return `${n}字 ${k.toLocaleString()}`;
  }).join("｜")}`,
  `涵蓋：${perBook.size} 本小說、${perHead.size} 種書名、hydzd 字頭 ${new Set(rows.map((r) => r.c.headKey)).size.toLocaleString()} 個`,
  `命中率：${((rows.length / Math.max(1, cites.length)) * 100).toFixed(1)}%（分母＝全部書證）`,
  "",
  "【書證最多的前 20 本】",
  ...[...perBook.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)
    .map(([id, n]) => `  bk${id} ${books.find((b) => b.id === id)?.title ?? "?"} → ${n} 條`),
  "",
  "【还没配上的高頻書名前 20（下一步補別名）】",
  ...[...unmatched.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([b, n]) => `  《${b}》 ${n} 次`),
  "",
  `xout_hydzd.jsonl ${xout.length - 1} 筆；xrev.jsonl ${xrev.length - 1} 筆；摺疊 miss ${foldMiss.toLocaleString()}`,
  existsSync("out/xout_hydzd.jsonl") && existsSync("out/xrev.jsonl") ? "兩檔都寫出 ✅" : "⚠ 有檔沒寫出",
].join("\n") + "\n";
writeFileSync("out/openlib-cites.tsv", audit.join("\n") + "\n", "utf8");
writeFileSync("out/openlib-cites-report.txt", rep, "utf8");
console.log(rep.split("\n").slice(0, 10).join("\n"));
