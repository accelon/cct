/**
 * diag-class.ts - count Han under different classifier definitions for one segment
 *   bun run src/diag-class.ts <headingLine> <endLine>
 */
import { readFileSync, writeFileSync } from "node:fs";

const target = Number(process.argv[2] ?? "420");
const end = Number(process.argv[3] ?? String(target + 6));
const lines = readFileSync("out/13j.xml", "utf8").split("\n");

const TAGS = ["\u7ae0", "\u7bc0", "\u9805"].join("|"); // zhang / jie / xiang
const headRe = new RegExp("^<(?:" + TAGS + ")[^>]*>[\\s\\S]*?</(?:" + TAGS + ")>(.*)$");
const residual = (lines[target - 1].match(headRe) ?? [, ""])[1];
let raw = residual;
for (let ln = target + 1; ln < end; ln++) raw += lines[ln - 1];
const stripped = raw.replace(/<[^>]*>/g, "");
const chars = [...stripped];

const isBmpThree = (x: number): boolean =>
  (x >= 0x3400 && x <= 0x4dbf) || (x >= 0x4e00 && x <= 0x9fff) || (x >= 0xf900 && x <= 0xfaff);
const isHanScript = (c: string): boolean => /\p{Script=Han}/u.test(c);

const han = chars.filter(isHanScript);
const bmp = chars.filter((c) => isBmpThree(c.codePointAt(0)!));
const hanPlusExtB = chars.filter((c) => {
  const x = c.codePointAt(0)!;
  return isBmpThree(x) || (x >= 0x20000 && x <= 0x2ffff);
});

const out: string[] = [];
out.push(`segment: heading line ${target}, body ${target + 1}..${end - 1}`);
out.push(`chars total = ${chars.length}`);
out.push(`Script=Han  = ${han.length}   (parent-workspace rule)`);
out.push(`BMP three    = ${bmp.length}   (old j-coordinate rule)`);
out.push(`BMP+ExtB     = ${hanPlusExtB.length}`);
const disagree = chars.filter((c) => {
  const v = [isHanScript(c), isBmpThree(c.codePointAt(0)!)].map((b) => (b ? 1 : 0));
  return v[0] !== v[1];
});
out.push(`disagreements = ${disagree.length}`);
for (const c of disagree) {
  const x = c.codePointAt(0)!;
  out.push(`  U+${x.toString(16).toUpperCase()} hanScript=${isHanScript(c)} bmpThree=${isBmpThree(x)}`);
}
writeFileSync("out/diag-class.txt", out.join("\n") + "\n", "utf8");
console.log(`line ${target}: han=${han.length} bmp=${bmp.length} bmp+extB=${hanPlusExtB.length} disagree=${disagree.length}`);
