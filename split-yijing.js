import {readTextLines,writeChanged,nodefs} from "ptk/nodebundle.cjs"
await nodefs;

const lines=readTextLines('raw/yijing-combined.txt');
const YI=[],TUAN=[],XIANG=[],WENYEN=[];

let out,group=0,id='';
for (let i=0;i<lines.length;i++) {
    const line=lines[i];
    const m=line.match(/(yb\d+)/);
    if (m) {
        group++;
        id=m[1];
        out=YI;
    } else if (~line.indexOf('彖傳:')){
        out=TUAN;
    } else if (~line.indexOf('象傳:')){
        out=XIANG;
    } else if (~line.indexOf('文言')){
        out=WENYEN;
    } else {
        if (!out[group]) out[group]=id+'\n';
        out[group]+=line+'\n';  
    }
}

writeChanged('temp/yi.txt',YI.join('\n'),true)
writeChanged('temp/tuan.txt',TUAN.join('\n'),true)
writeChanged('temp/xiang.txt',XIANG.join('\n'),true)
writeChanged('temp/wenyen.txt',WENYEN.join('\n'),true)