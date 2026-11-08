import { readFileSync } from "node:fs";
import { api } from "./wslib.mjs";
const rows = readFileSync("D:/2026/modern/manifest-children.tsv", "utf8").split(/\r?\n/).filter((l) => l).slice(1).map((l) => l.split("\t"));
const t3 = rows.slice(0, 3).map((r) => r[2]);
console.log("樣本標題:", JSON.stringify(t3));
const q = await api({ action: "query", titles: t3.join("|"), prop: "revisions", rvprop: "ids|timestamp", rvlimit: 1 });
console.log("回應鍵:", Object.keys(q));
if (q.error) console.log("API error:", JSON.stringify(q.error));
for (const p of Object.values(q?.query?.pages ?? {})) {
  console.log(`  title=${p.title} missing=${p.missing ?? "-"} revid=${p.revisions?.[0]?.revid ?? "-"} ts=${p.revisions?.[0]?.timestamp ?? "-"}`);
}
if (q.continue) console.log("continue:", JSON.stringify(q.continue));
