/**
 * analyze-dump.ts — 量測解出来的 adb 標記，作為 anchor 方案的事實基礎
 *
 *   bun run src/analyze-dump.ts 13j
 *   bun run src/analyze-dump.ts swjz
 *
 * 產出（out/，不進版控）：
 *   out/13j-tree.tsv      每個 章/節/項：book、level、label、path、是否 leaf、漢字數、textHash
 *   out/13j-manifest.tsv  leaf anchor 的 canonical id（最少祖先）＋ manifest 欄位
 *   out/13j-report.txt    統計、撞名判定、篇內子章候選
 *   out/swjz-report.txt   字 id 結構、img、卷／部、範圍統計
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const mode = process.argv[2];
if (mode !== "13j" && mode !== "swjz") {
  console.error("usage: bun run src/analyze-dump.ts <13j|swjz>");
  process.exit(2);
}

const HAN = /\p{Script=Han}/gu;
/** 依码点的漢字陣列（不可用 join().length，星體字會被算成 2 — 母區 adb-knowhow §3） */
const hanArr = (s: string): string[] => s.replace(/<[^>]*>/g, "").match(HAN) ?? [];

/**
 * textHash ＝ ancient-book-xref-spec.md §4.4（gycd 實作）：
 *   n1 = 每個漢字依 data/char-fold.tsv 摺疊（NFKC → 首個漢字 → OpenCC s2t → 首個漢字 → VMAP）
 *   textHash = sha256(n1 utf-8) hex 前 16
 * 表由 src/make-fold-table.py 產生；查不到就退回 NFKC＋記 miss（不靜默算錯）。
 */
const FOLD = new Map<string, string>();
// Python 在 Windows 寫出的表是 CRLF：必須同時切 \r\n，否則每個替換值多帶一個 \r，hash 全錯
for (const l of readFileSync("data/char-fold.tsv", "utf8").split(/\r?\n/)) {
  if (!l || l.startsWith("#")) continue;
  const [from, to] = l.split("\t");
  if (from !== undefined && to !== undefined) FOLD.set(from, to);
}
let foldMiss = 0;
const normHan = (chars: string[]): string =>
  chars.map((c) => {
    const f = FOLD.get(c);
    if (f !== undefined) return f;
    foldMiss++;
    const nn = c.normalize("NFKC");
    const hm = nn.match(HAN);
    return hm ? hm[0] : c;
  }).join("");
const hashOf = (chars: string[]): string => createHash("sha256").update(normHan(chars), "utf8").digest("hex").slice(0, 16);

const report: string[] = [];
const say = (s = ""): void => { report.push(s); };

/* ================================ 13j ================================ */
if (mode === "13j") {
  const lines = readFileSync("out/13j.xml", "utf8").split("\n");

  /* 缺字修正表（data/quezi-fix.tsv）：只有「行號＋原標籤＋前後文」三者相符才套用。
   * 這是來源缺字的修復依據，出處記在表內；不符就拒絕並回報，絕不猜字。 */
  type Fix = { oldLabel: string; context: string; newLabel: string; note: string };
  const QUEZI = new Map<number, Fix>();
  try {
    const raw = readFileSync("data/quezi-fix.tsv", "utf8").replace(/^/, "").split(/\r?\n/).filter((l) => l.length > 0);
    const head = raw[0].split("\t");
    for (const l of raw.slice(1)) {
      const c = l.split("\t");
      const rec: Record<string, string> = {};
      head.forEach((k, i) => { rec[k] = c[i] ?? ""; });
      QUEZI.set(Number(rec.line), { oldLabel: rec.oldLabel, context: rec.contextMustContain, newLabel: rec.newLabel, note: rec.note });
    }
  } catch {
    QUEZI.clear();
  }
  const fixApplied: string[] = [];
  const fixRejected: string[] = [];

  type Node = {
    book: string;
    level: 0 | 1 | 2;          // 章／節／項
    label: string;               // canonical 標題（可含缺字修正）
    originLabel: string;          // 原樣顯示文字（含佔位符，不改）
    line: number;              // 標題行（1-based）
    endLine: number;           // 子樹結束（同層或更淺的標題行）——只用於嵌套
    textEnd: number;           // anchor 文字結束（下一個「任意」語意節點）——契約 §4
    textSet: boolean;          // textEnd 只設一次（第一个下個節點就是尾）
    residual: string;          // 標題行 </節> 之後殘留的正文（要併入本段）
    children: Node[];
    parent: Node | null;
    han: number;               // 本 anchor 的正文漢字數
  };
  const LEVELS = ["章", "節", "項"] as const;

  let book = "(前言)";
  const roots: Node[] = [];
  const all: Node[] = [];
  const open: (Node | null)[] = [null, null, null];
  const books: { id: string; text: string; line: number }[] = [];

  lines.forEach((raw, i) => {
    const ln = i + 1;
    const bookM = raw.match(/^<書(?:\s[^>]*?)?\s+id="([^"]*)"[^>]*>([\s\S]*?)<\/書>/);
    if (bookM) {
      for (let l = 2; l >= 0; l--) if (open[l]) { open[l]!.endLine = ln; if (!open[l]!.textSet) { open[l]!.textEnd = ln; open[l]!.textSet = true; } open[l] = null; }
      book = bookM[1];
      books.push({ id: bookM[1], text: bookM[2], line: ln });
      return;
    }
    const m = raw.match(/^<(章|節|項)([^>]*)>([\s\S]*?)<\/\1>(.*)$/);
    if (!m) return;
    const level = LEVELS.indexOf(m[1]) as 0 | 1 | 2;
    let label = m[3].trim();
    const originLabel = m[3];                       // 顯示文字一律保留原樣（含佔位符）
    const fx = QUEZI.get(ln);
    if (fx) {
      const ctx = lines.slice(ln, ln + 2).join("");
      if (label === fx.oldLabel && ctx.includes(fx.context)) {
        label = fx.newLabel;
        fixApplied.push(`line ${ln}「${fx.oldLabel}」→「${fx.newLabel}」｜前後文相符：${fx.context}`);
      } else {
        fixRejected.push(`line ${ln}：表內原標籤「${fx.oldLabel}」现爲「${label}」，或前後文缺「${fx.context}」→ 不套用`);
      }
    }
    // ① anchor 文字範圍：第一個遇到的「任意下個節點」就是尾（只設一次）
    for (let l = 2; l >= 0; l--) if (open[l] && !open[l]!.textSet) { open[l]!.textEnd = ln; open[l]!.textSet = true; }
    // ② 嵌套：只有同層＋更深層才收，父節點繼續開著
    for (let l = 2; l >= level; l--) if (open[l]) { open[l]!.endLine = ln; open[l] = null; }
    const parent = level > 0 ? open[level - 1] : null;
    const node: Node = {
      book, level, label, originLabel, line: ln, endLine: lines.length, textEnd: lines.length,
      textSet: false, children: [], parent, han: 0, residual: m[4] ?? "",
    };
    if (parent) parent.children.push(node); else roots.push(node);
    open[level] = node;
    all.push(node);
  });
  for (let l = 2; l >= 0; l--) if (open[l]) {
    open[l]!.endLine = lines.length;
    if (!open[l]!.textSet) { open[l]!.textEnd = lines.length; open[l]!.textSet = true; }
    open[l] = null;
  }

  // 契約 §4：anchor 文字 ＝ 標題行 </tag> 之後的殘餘 ＋ 到下一個任意節點前的整行
  for (const n of all) {
    let body = n.residual;
    for (let ln = n.line + 1; ln < n.textEnd; ln++) body += "\n" + lines[ln - 1];
    n.han = hanArr(body).length;
  }

  const isLeaf = (n: Node): boolean => n.children.length === 0;
  const pathOf = (n: Node): string[] => {
    const p: string[] = [];
    for (let x: Node | null = n; x; x = x.parent) p.unshift(x.label);
    return p;
  };

  /* ---- 每本書層級統計 */
  say("=== 每本書的 章/節/項 與 leaf（leaf＝無子節點）===");
  say("book\t章\t節\t項\tleaf\tleaf級別");
  const byBook = new Map<string, Node[]>();
  for (const n of all) (byBook.get(n.book) ?? byBook.set(n.book, []).get(n.book)!).push(n);
  for (const [b, arr] of byBook) {
    const c = [0, 0, 0];
    for (const n of arr) c[n.level]++;
    const leaves = arr.filter(isLeaf);
    const lv = [...new Set(leaves.map((n) => LEVELS[n.level]))].join("+");
    say(`${b}\t${c[0]}\t${c[1]}\t${c[2]}\t${leaves.length}\t${lv}`);
  }

  /* ---- canonical id：給「全部」語意節點（契約 §3：id 用原文標題、去空白、去括注；
   *      leaf 唯一用 bare，撞名加最少祖先；加到根仍同名＝來源缺陷，不得用 #N 掩蓋） */
  const idLabel = (s: string): string => s.replace(/\s+/g, "").replace(/[（(][^）)]*[）)]/g, "");

  type Row = { book: string; node: Node; id: string; depth: number };
  const rows: Row[] = [];
  const defects: { book: string; label: string; line: number; why: string }[] = [];

  for (const [b, arr] of byBook) {
    const paths = arr.map((n) => pathOf(n).map(idLabel));
    const ids = paths.map((p) => p[p.length - 1]);
    let depth = 1;
    while (true) {
      const dup = new Map<string, number>();
      ids.forEach((s) => dup.set(s, (dup.get(s) ?? 0) + 1));
      const clash = arr.filter((_, k) => (dup.get(ids[k]) ?? 0) > 1);
      if (!clash.length) break;
      const maxDepth = Math.min(...clash.map((n) => pathOf(n).length));
      if (depth >= maxDepth) break;
      for (let k = 0; k < ids.length; k++)
        if ((dup.get(ids[k]) ?? 0) > 1) ids[k] = paths[k].slice(paths[k].length - 1 - depth).join("/");
      depth++;
    }
    const dup2 = new Map<string, number>();
    ids.forEach((s) => dup2.set(s, (dup2.get(s) ?? 0) + 1));
    arr.forEach((n, k) => {
      if ((dup2.get(ids[k]) ?? 0) > 1) {
        defects.push({ book: b, label: n.label, line: n.line, why: `加到根仍同名（×${dup2.get(ids[k])}）→ 需修字或人工定 id` });
        return;                         // 不自動編 #N
      }
      rows.push({ book: b, node: n, id: ids[k], depth: ids[k].split("/").length });
    });
  }

  const depthHist = new Map<number, number>();
  for (const r of rows) depthHist.set(r.depth, (depthHist.get(r.depth) ?? 0) + 1);

  say("");
  say("=== anchor id 所需祖先層數（全部節點，比對 prompts/13j.md §3 的 1,002／1,003／2）===");
  say(`可編 id 的節點: ${rows.length}（另有 ${defects.length} 筆缺陷不編 id）`);
  for (const [d, n] of [...depthHist].sort((a, b) => a[0] - b[0]))
    say(`  ${d === 1 ? "bare id（不需祖先）" : `加 ${d - 1} 層祖先`}: ${n} 個`);

  say("");
  say("=== 需祖先的節點（按書彙整）===");
  const perBook = new Map<string, Row[]>();
  for (const r of rows) if (r.depth > 1) (perBook.get(r.book) ?? perBook.set(r.book, []).get(r.book)!).push(r);
  for (const [b, arr] of perBook) {
    say(`${b}: ${arr.length} 個`);
    for (const r of arr.slice(0, 6)) say(`   ${r.id}\t←「${r.node.label}」`);
    if (arr.length > 6) say(`   ...（共 ${arr.length} 個，全表見 out/13j-manifest.tsv）`);
  }

  /* ---- 缺字／佔位符在標題內 */
  say("");
  say("=== 標題內含非漢字或佔位符（會影響 seg id 可用性）===");
  for (const n of all) {
    if (/[●○□＊*＃#◎]/.test(n.label) || n.label.length === 0)
      say(`  ${n.book}/${LEVELS[n.level]}: 「${n.label}」 行 ${n.line}`);
  }

  /* ---- 篇內子章候選：leaf 級別只有「章」的書，用空行分塊 */
  say("");
  say("=== leaf 只到「章」的書：篇內以空行分塊（子章候選）===");
  say("book\t篇數\t子塊總數\t平均/篇\t比對通說章數");
  const known: Record<string, string> = {
    論語: "498（朱子集注分章）", 孟子: "260（集注分章）", 孝經: "18（今文章）",
    禮記: "篇內無定章", 儀禮: "篇內經/記段", 周易: "64卦＋十翼",
  };
  for (const [b, arr] of byBook) {
    const leaves = arr.filter(isLeaf);
    if (!leaves.length || leaves[0].level !== 0) continue;
    let blocks = 0;
    const perLeaf: number[] = [];
    for (const n of leaves) {
      const blk: string[] = [];
      let cur = "";
      for (let ln = n.line + 1; ln < n.endLine; ln++) {
        const l = lines[ln - 1];
        if (l.trim() === "" || /^<頁/.test(l)) { if (cur.trim()) blk.push(cur.trim()); cur = ""; continue; }
        cur += l.trim();
      }
      if (cur.trim()) blk.push(cur.trim());
      // 首塊常以重複的篇名起頭，會高估差異
      if (blk.length && blk[0].startsWith(n.label)) blk[0] = blk[0].slice(n.label.length);
      const nonEmpty = blk.filter((s) => s.length > 0);
      blocks += nonEmpty.length;
      perLeaf.push(nonEmpty.length);
    }
    say(`  ${b}\t${leaves.length}\t${blocks}\t${(blocks / leaves.length).toFixed(1)}\t${known[b] ?? "—"}`);
    if (b === "論語") {
      say(`   逐篇子塊（前 8 篇）: ${perLeaf.slice(0, 8).join(", ")}`);
      say(`   例 學而 第 2 塊: ${((): string => {
        const n = leaves[0]; const blk: string[] = []; let cur = "";
        for (let ln = n.line + 1; ln < n.endLine; ln++) {
          const l = lines[ln - 1];
          if (l.trim() === "" || /^<頁/.test(l)) { if (cur.trim()) blk.push(cur.trim()); cur = ""; continue; }
          cur += l.trim();
        }
        if (cur.trim()) blk.push(cur.trim());
        return (blk[1] ?? "").slice(0, 30);
      })()}`);
    }
  }

  /* ---- TSV 輸出 */
  const tree: string[] = ["book\tlevel\tlabel\tpath\tisLeaf\tline\ttextEnd\than\tnote"];
  for (const n of all)
    tree.push([n.book, LEVELS[n.level], n.label, pathOf(n).join("/"), isLeaf(n) ? 1 : 0, n.line, n.textEnd, n.han,
      n.residual.trim() ? `殘餘「${n.residual.trim().slice(0, 12)}」` : ""].join("\t"));
  writeFileSync("out/13j-tree.tsv", tree.join("\n") + "\n", "utf8");

  const mf: string[] = ["work\tadbBook\tanchorId\tkind\tlabel\tdisplayPath\tline\thasText\thanCount\ttextHash\tancestorDepth"];
  const WORK: Record<string, string> = {
    周易: "yijing", 尚書: "shangshu", 毛詩: "shijing", 周禮: "zhouli", 儀禮: "yili", 禮記: "liji",
    左傳: "zuozhuan", 公羊傳: "gongyang", 穀梁傳: "guliang", 論語: "lunyu", 孝經: "xiaojing",
    爾雅: "erya", 孟子: "mengzi",
  };
  for (const r of rows) {
    const p = pathOf(r.node);
    // anchor 文字 ＝ 標題行殘餘 ＋ 到下一個任意節點前（契約 §4）
    const body = (() => {
      let s = r.node.residual;
      for (let ln = r.node.line + 1; ln < r.node.textEnd; ln++) s += lines[ln - 1];
      return hanArr(s);
    })();
    mf.push([WORK[r.book] ?? `?${r.book}`, r.book, r.id, "seg", r.node.label, p.join("·"), r.node.line,
      isLeaf(r.node) ? "leaf" : "struct", body.length, hashOf(body), r.depth].join("\t"));
  }
  writeFileSync("out/13j-manifest.tsv", mf.join("\n") + "\n", "utf8");

  say("");
  say("=== 缺字修正表套用情形（data/quezi-fix.tsv）===");
  say(`  表內 ${QUEZI.size} 筆；已套用 ${fixApplied.length} 筆、拒絕 ${fixRejected.length} 筆`);
  for (const s of fixApplied) say(`  OK  ${s}`);
  for (const s of fixRejected) say(`  NO  ${s}`);

  say("");
  say("=== 來源缺陷（不自動編 id，回報作者）===");
  for (const d of defects) say(`  ${d.book} line ${d.line}「${d.label}」: ${d.why}`);
  say(`  合計 ${defects.length} 筆`);

  say("");
  say("=== works.tsv 對照 ===");
  for (const b of byBook.keys()) say(`  adb book id「${b}」→ work「${WORK[b] ?? "未定義！"}」`);
  for (const b of books) if (b.id !== b.text) say(`  注意：id="${b.id}" 顯示=「${b.text}」→ catalog edition.book 要用 id`);

  say("");
  say(`=== textHash 正規化覆蓋 ===`);
  say(`  摺疊表 ${FOLD.size} 字；本次查表 miss ${foldMiss} 次${foldMiss ? " ← 有漢字不在表內，hash 不可與 gycd 相比，要重跑 src/make-fold-table.py" : "（全部命中，可比對）"}`);

  writeFileSync("out/13j-report.txt", report.join("\n") + "\n", "utf8");
  console.log(`13j: nodes=${all.length} idAssigned=${rows.length} struct=${rows.filter((r) => !isLeaf(r.node)).length} defects=${defects.length} foldMiss=${foldMiss}`);
} else {
  /* ================================ swjz ================================ */
  const text = readFileSync("out/swjz.xml", "utf8");
  const lines = text.split("\n");
  const ids: { id: string; img: string; head: string; line: number }[] = [];
  const noId: { attrs: string; head: string; line: number }[] = [];
  let openCount = 0;

  lines.forEach((raw, i) => {
    for (const m of raw.matchAll(/<字([^>]*)>/g)) {
      openCount++;
      const attrs = m[1];
      const idM = attrs.match(/\sid="([^"]*)"/);
      const imgM = attrs.match(/\simg="([^"]*)"/);
      const ci = raw.indexOf("</字>", m.index! + m[0].length);
      const head = ci >= 0 ? raw.slice(m.index! + m[0].length, ci) : "(無同行 </字>)";
      if (!idM) noId.push({ attrs: attrs.trim(), head, line: i + 1 });
      else ids.push({ id: idM[1], img: imgM?.[1] ?? "", head, line: i + 1 });
    }
  });

  say("=== <字> 標記實測 ===");
  say(`<字 開標籤: ${openCount}；有 id: ${ids.length}；無 id: ${noId.length}`);
  say(`不同 id: ${new Set(ids.map((x) => x.id)).size}`);
  say(`</字> 收尾: ${(text.match(/<\/字>/g) ?? []).length}`);

  say("");
  say("=== id 格式 ===");
  const fmt = new Map<string, number>();
  for (const x of ids) { const k = x.id.replace(/\d/g, "N"); fmt.set(k, (fmt.get(k) ?? 0) + 1); }
  for (const [k, n] of fmt) say(`  模式 ${k}: ${n}`);
  const bad = ids.filter((x) => !/^w\d{7}$/.test(x.id));
  say(`  不符合 w+7digits: ${bad.length}`);
  for (const x of bad.slice(0, 10)) say(`    line ${x.line}: ${x.id}`);

  say("");
  say("=== id 結構推導：w = 部(3) + 部內字序(3) + 重文(1) ? ===");
  const perPart = new Map<string, { slots: Set<string>; variants: number; maxSeq: number }>();
  for (const x of ids) {
    if (!/^w\d{7}$/.test(x.id)) continue;
    const rec = perPart.get(x.id.slice(1, 4)) ?? { slots: new Set<string>(), variants: 0, maxSeq: 0 };
    rec.slots.add(x.id.slice(4, 7));
    if (x.id.slice(7) !== "0") rec.variants++;
    rec.maxSeq = Math.max(rec.maxSeq, Number(x.id.slice(4, 7)));
    perPart.set(x.id.slice(1, 4), rec);
  }
  say(`  推得的部數: ${perPart.size}`);
  let overflow = 0, holes = 0, maxSlot = 0, dupVariant = 0;
  const seenSlot = new Set<string>();
  for (const [, rec] of perPart) {
    maxSlot = Math.max(maxSlot, rec.maxSeq);
    if (rec.maxSeq > 999) overflow++;
    const seqs = [...rec.slots].map(Number).sort((a, b) => a - b);
    for (let k = 1; k < seqs.length; k++) if (seqs[k] !== seqs[k - 1] + 1) holes++;
  }
  for (const x of ids) { const key = x.id.slice(0, 7); if (seenSlot.has(key)) dupVariant++; seenSlot.add(key); }
  say(`  單部最大部內序: ${maxSlot}（3 位容量 999）→ 溢出部數 ${overflow}`);
  say(`  部內序斷號次數: ${holes}`);
  say(`  同部同序僅重文不同: ${dupVariant}`);
  const dupIds = new Map<string, number>();
  for (const x of ids) dupIds.set(x.id, (dupIds.get(x.id) ?? 0) + 1);
  say(`  重複 id: ${[...dupIds.values()].filter((n) => n > 1).length}`);
  for (const [id, n] of dupIds) if (n > 1) say(`    ${id} ×${n}`);

  say("");
  say(`=== 無 id 的 <字>（${noId.length}）==="`);
  for (const x of noId.slice(0, 6)) say(`  line ${x.line}: <字 ${x.attrs}>${x.head}`);
  if (noId.length) {
    say(`  行號範圍: ${noId[0].line} … ${noId[noId.length - 1].line}（檔案總行 ${lines.length}）`);
    // 這批無 id 字位於最後一個 chaptertitle 之後？
    let owner = "(開頭)", ownerLine = 0;
    lines.forEach((raw, i) => {
      const m = raw.match(/<chaptertitle id="([^"]*)">([\s\S]{0,120}?)<\/chaptertitle>/);
      if (m && i + 1 <= noId[0].line) { owner = `${m[1]}:「${m[2].replace(/<[^>]*>/g, "").replace(/\s+/g, "")}」`; ownerLine = i + 1; }
    });
    say(`  最後一個章標題（在無 id 字之前）: line ${ownerLine} → ${owner}`);
    for (let ln = noId[0].line - 8; ln <= noId[0].line + 1; ln++) say(`    ${ln}: ${lines[ln - 1].slice(0, 60)}`);
  }

  say("");
  say("=== img 屬性 vs resources 容器 ===");
  say(`  有 img 的 <字>: ${ids.filter((x) => x.img).length}（resources 容器只有 accelon3_logo.png → 圖不在 adb 內）`);
  const pat = new Map<string, number>();
  for (const x of ids) { const k = (x.img || "(無)").replace(/\d/g, "N"); pat.set(k, (pat.get(k) ?? 0) + 1); }
  for (const [k, n] of [...pat].sort((a, b) => b[1] - a[1]).slice(0, 6)) say(`    ${k}: ${n}`);
  say(`  img="nil": ${ids.filter((x) => x.img === "nil").length}`);

  say("");
  say("=== 高階結構 ===");
  const ct = [...text.matchAll(/<chaptertitle id="([^"]*)">([\s\S]{0,200}?)<\/chaptertitle>/g)];
  say(`  chaptertitle: ${ct.length} 個 → ${ct.map((m) => m[1]).join(",")}`);
  for (const m of ct.slice(0, 4)) say(`    ${m[1]} =「${m[2].replace(/<[^>]*>/g, "").replace(/\s+/g, "").slice(0, 30)}」`);
  const pw = [...text.matchAll(/<part_word(?=[\s>])([^>]*)>([\s\S]{0,200}?)<\/part_word>/g)];
  const pwn = [...text.matchAll(/<part_wordnum(?=[\s>])([^>]*)>([\s\S]{0,200}?)<\/part_wordnum>/g)];
  say(`  part_word: ${pw.length}, part_wordnum: ${pwn.length}`);
  for (const m of pw.slice(0, 3)) say(`    part_word:「${m[2].replace(/<[^>]*>/g, "").replace(/\s+/g, "").slice(0, 40)}」`);

  say("");
  say("=== anchor 範圍（字條 → 下一字條）漢字數（末條跨到附錄，已排除）===");
  const counts: number[] = [];
  for (let k = 0; k < ids.length - 1; k++) {
    counts.push(hanArr(lines.slice(ids[k].line - 1, ids[k + 1].line - 1).join("")).length);
  }
  counts.sort((x, y) => x - y);
  const pct = (p: number): number => counts[Math.min(counts.length - 1, Math.floor(counts.length * p))];
  say(`  min ${counts[0]} / p50 ${pct(0.5)} / p90 ${pct(0.9)} / p99 ${pct(0.99)} / max ${counts[counts.length - 1]}`);
  say(`  >240 漢字（xout quote 上限）: ${counts.filter((n) => n > 240).length} 條`);
  say(`  =0 漢字（空字條？）: ${counts.filter((n) => n === 0).length} 條`);

  say("");
  say("=== 標籤清單（正文實際用到的體例）===");
  const tagHits = new Map<string, number>();
  for (const m of text.matchAll(/<([A-Za-z_\u3400-\u9fff][\w\u3400-\u9fff]*)[\s\/>]/g))
    tagHits.set(m[1], (tagHits.get(m[1]) ?? 0) + 1);
  for (const [t, n] of [...tagHits].sort((a, b) => b[1] - a[1])) say(`  ${n}\t${t}`);

  writeFileSync("out/swjz-report.txt", report.join("\n") + "\n", "utf8");
  console.log(`swjz: open=${openCount} ids=${ids.length} noId=${noId.length} unique=${new Set(ids.map((x) => x.id)).size}`);
}
