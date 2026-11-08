import {toBase26,readTextLines,writeChanged,nodefs} from "ptk/nodebundle.cjs"
await nodefs;
const lines=readTextLines('raw/yijing-combined.txt');
const YI=[],TUAN=[],XIANG=[],WENYEN=[];

let out,group=0,id='';
for (let i=0;i<lines.length;i++) {
    const line=lines[i];
    const m=line.match(/(y\d+)/);
    
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
const tidy_Yi=(lines)=>{
    lines=lines.join('\n').split('\n')
    const out=[];
    let id='',prev='';
    for (let i=0;i<lines.length;i++) {
        const line=lines[i];
        if (line.match(/y(\d+)/)) {
            id =line;
            prev='^'+line+ ' ';
        } else {
            if (line+prev) out.push(prev+line.replace('\t','\t'+prev));
            prev='';
        }
    }
    return out;
}
const tidy_Xiang=(lines)=>{
    lines=lines.join('\n').split('\n')
    const out=[];
    let id='',prev='';
    for (let i=0;i<lines.length;i++) {
        const line=lines[i];
        if (!line) continue;
        if (line.match(/y(\d+)/)) {
            id =line;
            prev='^'+line+ ' ';
        } else if (line.match(/^(\d )/)) {
            prev='^'+id+ toBase26(parseInt(line[0])-2)+' '
        } else {
            out.push(prev+line.replace('\t','\t'+prev));
            prev='';
        }
    }
    return out;
}
writeChanged('temp/yi.txt',tidy_Yi(YI).join('\n'),true);
writeChanged('temp/tuan.txt',tidy_Yi(TUAN).join('\n'),true);
writeChanged('temp/xiang.txt',tidy_Xiang(XIANG).join('\n'),true);
writeChanged('temp/wenyen.txt',tidy_Yi(WENYEN).join('\n'),true);