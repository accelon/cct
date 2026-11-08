/**
 * verify-xout-jing.ts — 反解驗證 out/xout_<work>.jsonl
 *
 *   bun run src/verify-xout-jing.ts
 *
 * 三件事：
 *   1) anchorId 是否存在於 jing manifest（gate：不存在就不是合法 xout）
 *   2) 用 targetA-targetB 從 anchor 漢字串切片，是否等於 quote（摺疊後比對，容異體）
 *   3) 記錄的 targetTextHash 是否等於目前 manifest 的 hash（版本一致性）
 * 輸出：out/xout-verify.txt
 */
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { buildSegments, foldChars, loadFold, loadQuezi } from "./jing-anchors.ts";

const HAN = /\p{Script=Han}/gu;
const rawHan = (s: string): string[] => s.replace(/<[^>]*>/g, "").match(HAN) ?? [];
const fold = loadFold();
const jingLines = readFileSync("out/jing.xml", "utf8").split(/\r?\n/);
const { segs } = buildSegments(jingLines, fold, loadQuezi());

const byKey = new Map<string, typeof segs[number]>();
for (const s of segs) byKey.set(`${s.work}?${s.id}`, s);

const anchorHan = (s: typeof segs[number]): string => {
  let body = s.residual;
  for (let ln = s.line + 1; ln < s.textEnd; ln++) body += "\n" + jingLines[ln - 1];
  return rawHan(body).join("");
};

const files = readdirSync("out").filter((f) => /^xout_.*\.jsonl$/.test(f));
const out: string[] = [];
const say = (s = ""): void => { out.push(s); };
const st = { total: 0, ok: 0, noAnchor: 0, sliceBad: 0, hashBad: 0, badSamples: [] as string[] };

for (const f of files) {
  const lines = readFileSync(`out/${f}`, "utf8").split(/\r?\n/).filter((l) => l.length > 0);
  const head = JSON.parse(lines[0]) as unknown[];
  let n = 0;
  for (const l of lines.slice(1)) {
    const r = JSON.parse(l) as [string, number, number, number, string, number, number, string, string, number, string];
    const [srcAnchor, , sA, sB, targetAnchor, a, b, quote, kind, conf, tHash] = r;
    const work = head[1] as string;
    const id = targetAnchor.replace(/^seg:/, "");
    st.total++; n++;
    const seg = byKey.get(`${work}?${id}`);
    if (!seg) { st.noAnchor++; say(`  ✗ ${f}: anchor 不存在 ${work}?${id}（${srcAnchor}）`); continue; }
    if (tHash !== seg.textHash) { st.hashBad++; if (st.badSamples.length < 10) st.badSamples.push(`  hash 不符 ${work}?${id}：記錄 ${tHash} 現值 ${seg.textHash}`); }
    const han = anchorHan(seg);
    const slice = han.slice(a, b);
    if (!slice || foldChars([...slice], fold).n1 !== foldChars([...quote], fold).n1) {
      st.sliceBad++;
      if (st.badSamples.length < 10) st.badSamples.push(`  切片不符 ${work}?${id}#${a}-${b}｜切到「${slice.slice(0, 22)}」≠「${quote.slice(0, 22)}」`);
      continue;
    }
    st.ok++;
  }
  say(`${f}  header=["XOUT1","${head[1]}",${head[2]},"${head[3]}","${head[4]}"]  記錄 ${n} 筆`);
}

say("");
say(`=== 反解結果：總 ${st.total}｜通過 ${st.ok}｜anchor 不存在 ${st.noAnchor}｜切片不符 ${st.sliceBad}｜textHash 不符 ${st.hashBad} ===`);
for (const s of st.badSamples) say(s);
writeFileSync("out/xout-verify.txt", out.join("\n") + "\n", "utf8");
console.log(`total=${st.total} ok=${st.ok} noAnchor=${st.noAnchor} sliceBad=${st.sliceBad} hashBad=${st.hashBad}`);
