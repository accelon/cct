#!/usr/bin/env bash
# verify-all.sh — 對 out/haodoo-adb/*.adb 做一致性檢查
#   1) abx inspect：確認容器（source/tokens/tags/tables/attributes/attributes.sorted）都在
#   2) 抽樣 round-trip：對最大 / 中段 / 最小 三個 ADB 做 abx export，與來源 XML 比對
#      字元是否逐字一致（長行折行後應完全吻合）。
set -u
cd /d/2026/adb-converter/ts
OUT="D:/2026/cct/out/haodoo-adb"
LOG="$OUT/verify.log"
: > "$LOG"

echo "VERIFY START $(date)" | tee -a "$LOG"

# 1) inspect 每個 adb
for adb in "$OUT"/*.adb; do
  name=$(basename "$adb")
  [ "$name" = "smoke-test.adb" ] && continue
  echo "===== inspect $name =====" | tee -a "$LOG"
  bun run src/cli.ts inspect "$adb" 2>&1 | grep -E "dbname|outer|sources|tables|^  [a-z]" | head -20 >> "$LOG" 2>&1
done

# 2) 抽樣 round-trip：取位元組數 最大 / 中段 / 最小 三個（排除 smoke-test）
echo "===== round-trip sampling =====" | tee -a "$LOG"
LARGEST=$(ls -S "$OUT"/*.adb | grep -v smoke-test | head -1)
SMALLEST=$(ls -S "$OUT"/*.adb | grep -v smoke-test | tail -1)
MID=$(ls -S "$OUT"/*.adb | grep -v smoke-test | awk 'NR==int((N+1)/2)' N=$(ls "$OUT"/*.adb | grep -v smoke-test | wc -l))
for adb in "$LARGEST" "$MID" "$SMALLEST"; do
  name=$(basename "$adb" .adb)
  echo "----- round-trip $name -----" | tee -a "$LOG"
  rm -rf "$OUT/_v_$name"
  bun run src/cli.ts export "$adb" -o "$OUT/_v_$name" >> "$LOG" 2>&1
  python - "$OUT/$name.xml" "$OUT/_v_$name/$name.xml" >> "$LOG" 2>&1 <<'PY'
import sys,hashlib
srcp,expp=sys.argv[1],sys.argv[2]
src=open(srcp,encoding='utf-8').read()
exp=open(expp,encoding='utf-8').read()
MAX=4000
def split_long(line):
    if len(line)<=MAX: return [line]
    out=[];i=0
    while i<len(line):
        end=min(len(line),i+MAX)
        if end<len(line):
            lt=line.rfind('<',0,end)
            if lt>=i and line.find('>',lt)>=end: end=lt
            hi=ord(line[end-1])
            if 0xd800<=hi<=0xdbff: end-=1
            if end<=i: end=min(len(line),i+MAX)
        out.append(line[i:end]);i=end
    return out
sl=[x for x in src.split('\n')]
while sl and sl[-1]=='': sl.pop()
recon='\n'.join(sum((split_long(l) for l in sl),[]))
ok = recon==exp or recon==(exp+'\n')
print(f"  source chars={len(src)} export chars={len(exp)} roundtrip_exact={ok}")
PY
  rm -rf "$OUT/_v_$name"
done

echo "VERIFY DONE $(date)" | tee -a "$LOG"
