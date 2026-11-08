/**
 * assign-hydzd-ids.ts — 比照 cyd，為 hydzd 的 82,280 個 `<詞>` 生成 id 分配表
 *
 *   bun run src/assign-hydzd-ids.ts
 *
 * cyd 慣例（MEMORY）：`<詞 id zy="注音" py="拼音">`，連結用 `<聯 n="詞條">`，
 * 同形字靠 `a="N"`（本區 hydcd 規則）區分；id 只是穩定序號，不進對外地址。
 * hydzd 現況：`<詞>` 完全無 id（實測 0/82,280），149 組字頭重複 → 只能靠 #N，
 * 而 #N 綁文件序，插一條就全亂。所以補 id。
 *
 * 產出：out/hydzd-id-assign.tsv（行號、現況 attrs、字頭、id、a 序、anchorId 建議）
 *       out/hydzd-id-assign.txt（統計）
 * ⚠ 這一支**只產表**，不改 out/hydzd.xml、不打包、不碰 D:\accelon3\hydzd.adb。
 */
import { readFileSync, writeFileSync } from "node:fs";

const lines = readFileSync("out/hydzd.xml", "utf8").split(/\r?\n/);
type Row = { line: number; attrs: string; head: string; id: number; a: number; anchor: string };
const rows: Row[] = [];
const seen = new Map<string, number>();

const RE = /^<詞([^>]*)>([\s\S]*?)<\/詞>\s*$/;
for (let i = 0; i < lines.length; i++) {
  const m = lines[i].match(RE);
  if (!m) continue;
  const head = m[2].trim();
  const n = (seen.get(head) ?? 0) + 1;
  seen.set(head, n);
  rows.push({
    line: i + 1, attrs: m[1].trim(), head, id: rows.length + 1,
    a: n,                                        // 同形序（cyd/hydcd 的 a= 語意）
    anchor: (seen.get(head) ?? 1) > 1 || true ? `${head}` : head,
  });
}

// anchorId 建議：唯一字頭→裸字頭；重複→字頭＋a 序（渲染成「阿²房」那一套），
// 不依賴文件序，所以日後插條不會亂。
const headCount = new Map<string, number>();
for (const r of rows) headCount.set(r.head, (headCount.get(r.head) ?? 0) + 1);

const tsv = ["line\tattrs\thead\t詞.id\t詞.a\tanchorId建議\t需不需要a"].join("\n");
const body = rows.map((r) => [
  r.line, r.attrs, r.head, r.id, r.a,
  (headCount.get(r.head) ?? 1) > 1 ? `${r.head}#${r.a}` : r.head,
  (headCount.get(r.head) ?? 1) > 1 ? "要" : "不要",
].join("\t"));

const dupGroups = [...headCount].filter(([, n]) => n > 1).length;
const dupRows = [...headCount].filter(([, n]) => n > 1).reduce((n, [, c]) => n + c, 0);
const withAttrs = rows.filter((r) => r.attrs).length;
const report = [
  "=== hydzd `<詞>` 補 id 分配表（比照 cyd）===",
  `字頭條目 ${rows.length}；有屬性的 ${withAttrs}；字頭種類 ${headCount.size}`,
  `重複字頭 ${dupGroups} 組、涉及 ${dupRows} 筆 → 這些才需要 a=（其余 a 一律 1，可省略）`,
  `id 規劃：詞.id ＝ 文件序 1..${rows.length}（穩定、只給 adb 內部用，對外地址仍是字頭）`,
  `anchorId 建議：唯一→裸字頭；重複→「字頭#a」（綁字頭本身，插條不亂）`,
  "",
  "重複最多的字頭（前 12）：",
  ...[...headCount].filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([h, n]) => `  「${h}」×${n}`),
  "",
  "落地影響（打包前必須知道）：",
  "  1) `<詞>` 加 id＝每個字條 +4 VA（標籤固定 TAGLENGTH=4，與屬性長度無關）→ 82,280 條共 +329,120 VA；",
  "     本庫的連結是 `<聯 n=詞條>` 名稱型、沒有 j= 座標型，所以庫內連結不受影響；但任何外部 VA 引用會全部位移。",
  "  2) validTags 要含 詞；caches 現況是「詞」單鍵（樹 s=$詞 t=詞），加 id 不改 cache 鍵。",
  "  3) hydzd.adb 今天已被該區重建過 → 覆蓋前要確認沒有別人在同時間動它（母區紀律）。",
].join("\n") + "\n";

writeFileSync("out/hydzd-id-assign.tsv", tsv + "\n" + body.join("\n") + "\n", "utf8");
writeFileSync("out/hydzd-id-assign.txt", report, "utf8");
console.log(`rows=${rows.length} heads=${headCount.size} dupGroups=${dupGroups} dupRows=${dupRows}`);
