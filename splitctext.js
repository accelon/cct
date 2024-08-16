/* convert ctext into chinese and english text */

import {readTextLines,writeChanged,nodefs} from "ptk/nodebundle.cjs"
await nodefs;
const inp=process.argv[2];

let group=0;
const split=(lines)=>{ //grouping zh and en text
    const out=[];
    let prev='zh',enlines=[],zhlines=[];
    for(let i=0;i<lines.length;i++) {
        const line=lines[i];
        const m=line.match(/[\u3400-\u9fff]/);
        if (m) {
            if (prev!=='zh') {
                out[group]=[zhlines,enlines];
                zhlines=[];
                enlines=[];
                group++;
            }
            zhlines.push(line);
            prev='zh'
        } else {
            enlines.push(line);
            prev='en'
        }
    }
    out[group]=[zhlines,enlines];
    return out;
}
if (!fs.existsSync(inp)) {
    console.log('missing input filename');
} else {
    const lines=readTextLines(inp)
    const out=split(lines);
    const zh=[],en=[];
    for (let i=0;i<out.length;i++) {
        let [zhlines,enlines]=out[i]
        let linecount=zhlines.length;
        if (enlines.length>linecount) {
            zhlines=zhlines.join('\n').replace(/。/g,'。\n').trim().split('\n')
            linecount=zhlines.length;
            if (enlines.length>linecount) linecount=enlines.length;
        }
        for (let j=0;j<linecount;j++) {
            zh.push(zhlines[j]||'')
            en.push(enlines[j]||'')
        }
    }
    writeChanged(inp+'.zh',zh.join('\n'),true)
    writeChanged(inp+'.en',en.join('\n'),true)
}
