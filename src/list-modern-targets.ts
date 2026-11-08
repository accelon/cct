/**
 * list-modern-targets.ts — 把「若要收現代文學，第一批該要哪幾本」變成可執行清單
 *
 *   bun run src/list-modern-targets.ts
 *
 * 依據：xdhycd 自己的書目榜（1901–1949 前後作品為主）＋ 公有領域到期判斷。
 * 之所以要這份表：國內兩條現實通道正好互補——
 *   甲、《限量复制民国时期图书》之《中国近现代本土文学作品》專輯：收 1901–1949 出版的現代作家文學圖書
 *       2,654 種 2,783 冊，全文 PDF 可下載，但須經高校圖書館授權（非公開開放式上下載）。
 *   乙、公有領域（作者卒年＋50 ≤ 今年）：可向維基文庫取全文，無需授權。
 * 對照後才知道：哪些書要「申請授權」，哪些根本不用申請。
 */
import { readFileSync, writeFileSync } from "node:fs";

const YEAR = 2026;
const DEATH: Record<string, number> = {
  "魯迅": 1936, "老舍": 1966, "瞿秋白": 1935, "朱自清": 1948, "許地山": 1941, "郁達夫": 1945,
  "趙樹理": 1970, "洪深": 1955, "楊朔": 1968, "王西彥": 1960, "鄒韜奮": 1944, "李劼人": 1962,
  "蕭紅": 1942, "聞一多": 1946, "徐志摩": 1931, "王統照": 1957, "靳以": 1959, "林語堂": 1975,
  "茅盾": 1981, "巴金": 2005, "郭沫若": 1978, "曹禺": 1996, "葉聖陶": 1988, "冰心": 1999,
  "丁玲": 1986, "沈從文": 1988, "柳青": 1978, "周立波": 1979, "張天翼": 1985, "孫犁": 2013,
  "楊沫": 1995, "梁斌": 1996, "魏巍": 2008, "周而復": 2004, "沙汀": 1988, "徐遲": 1996, "毛泽东": 1976,
};
const pd = (a: string) => { const d = DEATH[a.trim()]; return d !== undefined && d + 50 <= YEAR ? "PD" : d !== undefined ? `保護期至 ${d + 50}` : "卒年待查"; };

function csv(l: string) {
  const o: string[] = []; let c = "", q = false;
  for (let i = 0; i < l.length; i++) {
    const ch = l[i];
    if (ch === '"') { if (q && l[i + 1] === '"') { c += '"'; i++; } else q = !q; continue; }
    if (ch === "," && !q) { o.push(c); c = ""; continue; }
    c += ch;
  }
  o.push(c); return o;
}

const lines = readFileSync("D:/2026/xdhycd/out/quotes/book-stats.csv", "utf8").split(/\r?\n/).filter((l) => l);
const h = csv(lines[0]);
const iT = h.indexOf("書名"), iN = h.indexOf("引文總次數"), iA = h.indexOf("主要作者標記"), iTy = h.indexOf("標題類型");
const rows = lines.slice(1).map((l) => csv(l)).map((c) => ({
  t: (c[iT] ?? "").trim(), n: Number(c[iN] ?? 0), a: (c[iA] ?? "").trim(), ty: c[iTy] ?? "",
})).filter((x) => x.t && x.ty !== "傳統典籍" && x.n >= 30).sort((a, b) => b.n - a.n);

const out: string[] = ["title\tcites\tauthor\tstatus\tnote"];
for (const x of rows) {
  const s = pd(x.a);
  out.push(`${x.t}\t${x.n}\t${x.a || "—"}\t${s === "PD" ? "PD" : s.startsWith("保護期") ? "授權" : "待查"}\t${s}`);
}
writeFileSync("data/modern-target-titles.tsv", out.join("\n") + "\n", "utf8");
const nPD = out.filter((l) => l.endsWith("\tPD")).length;
const nLic = out.filter((l) => l.includes("\t授權\t")).length;
const nUnk = out.filter((l) => l.includes("\t待查\t")).length;
console.log([
  `入選門檻：引文 ≥30 次且非傳統典籍 → ${rows.length} 種`,
  `甲類（作者已到期，可直接取公有領域全文）：${nPD} 種、${out.filter((l) => l.endsWith("\tPD")).reduce((s, l) => s + Number(l.split("\t")[1]), 0).toLocaleString()} 次`,
  `乙類（仍在保護期，需授權或走民國複製庫）：${nLic} 種、${rows.filter((x) => pd(x.a).startsWith("保護期")).reduce((s, x) => s + x.n, 0).toLocaleString()} 次`,
  `丙類（作者標記不可靠或卒年待查）：${nUnk} 種`,
  `寫入 data/modern-target-titles.tsv`,
].join("\n"));
