import {readTextLines,writeChanged,nodefs} from "ptk/nodebundle.cjs"
await nodefs;

const YI=readTextLines('temp/yi.txt')
const XIANG=readTextLines('temp/xiang.txt')
const TUAN=readTextLines('temp/tuan.txt')

const split_tab=(name,lines,zhheader,enheader)=>{
    const ZH=[zhheader] ,EN=[enheader];
    for (let i=0;i<lines.length;i++){
        const [zh,en]=lines[i].split('\t')
        ZH.push(zh.match(/\^y\d+ /)?'\t'+zh:zh);
        EN.push(en.match(/\^y\d+ /)?'\t'+en:en)
    }
    writeChanged('off/'+name+'.pgd',ZH.join('\n'),true)
    writeChanged('off/'+name+'-legge.pgd',EN.join('\n'),true)
}

split_tab('yi',YI,"{id:'yi',title:'易',aligncaption:'中'}","{id:'yi-legge',title:'YiJing',aligncaption:'En'}");
split_tab('yixiang',XIANG,"{id:'yixiang',title:'易象',aligncaption:'中'}","{id:'yixiang-legge',title:'YiXiang',aligncaption:'En'}");
split_tab('yituan',TUAN,"{id:'yituan',title:'易彖',aligncaption:'中'}","{id:'yituan-legge',title:'YiTuan',aligncaption:'En'}");