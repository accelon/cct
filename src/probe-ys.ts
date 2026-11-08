import { AdbReader, SyncIO } from 'D:/2026/adb-converter/ts/src/accelon26/adb';
import { VaPaMapper, parseAttrs } from 'D:/2026/adb-converter/ts/src/accelon26/vapa';
import { loadTrees, loadTree } from 'D:/2026/adb-converter/ts/src/accelon26/search';

const path = process.argv[2] ?? 'D:/accelon3/ys.adb';
const reader = await AdbReader.open(new SyncIO(path));
const mapper = new VaPaMapper(reader);
await mapper.init();
const trees = await loadTrees(reader);
console.log('=== <樹> declarations in', path, '===');
for (const t of trees) {
  console.log(`  s="${t.scope}" t="${t.tiers.join(',')}"${t.terminalTier >= 0 ? '(terminal=' + t.tiers[t.terminalTier] + ')' : ''} fullText=${t.fullText} caption=${JSON.stringify(t.caption)}`);
}
const full = trees.filter((t) => t.fullText);
if (full.length) {
  const tree = full[0];
  const instances = await loadTree(reader, tree, {
    attrsAt: async (va) => {
      const el = await mapper.elementAt(va);
      return el ? parseAttrs(el.element.text) : {};
    },
    label: (va, vaEnd) => mapper.nodeLabel(va, vaEnd),
  });
  console.log(`\n=== first 18 tree instances (tree s="${tree.scope}" t="${tree.tiers.join(',')}") ===`);
  for (const i of instances.slice(0, 18)) {
    console.log(`  L${i.depth + 1} <${i.tag}> va=${i.va} label=${JSON.stringify(i.label)} children=[${i.children.join(',')}]${i.childTerminal ? ' (term)' : ''}`);
  }
  // show distinct tags and their counts
  const counts: Record<string, number> = {};
  for (const i of instances) counts[i.tag] = (counts[i.tag] ?? 0) + 1;
  console.log('\n=== tier tag counts (top) ===', JSON.stringify(counts));
  // sample a book label and its first child label
  const books = instances.filter((i) => i.depth === 0);
  if (books.length) {
    console.log('\n=== sample book + first 3 children ===');
    const b = books[0];
    console.log(`  BOOK L1 <${b.tag}> va=${b.va} label=${JSON.stringify(b.label)}`);
    for (const c of instances.filter((i) => i.depth === 1).slice(0, 3)) {
      console.log(`    CHILD L2 <${c.tag}> va=${c.va} label=${JSON.stringify(c.label)}`);
    }
  }
}
reader.close?.();
