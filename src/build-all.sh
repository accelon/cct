#!/usr/bin/env bash
# build-all.sh — 把 18 個 ADB 從 updb 一路建到 .adb（一次一個，省記憶體）
# 用法： bash src/build-all.sh
set -u
cd /d/2026/cct

LOG="out/haodoo-adb/build.log"
rm -f "$LOG"
: > "$LOG"

# 清掉舊的 manifest，讓這次結果是乾淨的
rm -f out/haodoo-adb/manifest.tsv

DBS=$(python -c "import csv;rows=list(csv.DictReader(open('raw/haodoo/manifest/adb-plan.tsv'),delimiter='\t'));print(' '.join(sorted({r['adb'] for r in rows})))")

echo "BUILD START $(date)  ADBs: $DBS" | tee -a "$LOG"
for db in $DBS; do
  echo "===== [$db] decode $(date) =====" | tee -a "$LOG"
  python src/updb2xml.py --adb "$db" >> "$LOG" 2>&1
  if [ ! -f "out/haodoo-adb/$db.xml" ]; then
    echo "!! [$db] XML 未產生，跳過打包" | tee -a "$LOG"
    continue
  fi
  echo "===== [$db] pack $(date) =====" | tee -a "$LOG"
  bun run src/haodoo-pack.ts "out/haodoo-adb/$db.xml" >> "$LOG" 2>&1
  rc=$?
  if [ $rc -ne 0 ]; then
    echo "!! [$db] 打包失敗 rc=$rc" | tee -a "$LOG"
    continue
  fi
  # 低記憶體自檢：只讀容器（source/tokens/tags/tables/attributes），不整本解壓
  insp=$(cd /d/2026/adb-converter/ts && bun run src/cli.ts inspect "D:/2026/cct/out/haodoo-adb/$db.adb" 2>&1)
  if echo "$insp" | grep -q "attributes.sorted" && echo "$insp" | grep -q "source"; then
    echo "[$db] inspect PASS" | tee -a "$LOG"
  else
    echo "!! [$db] inspect FAIL" | tee -a "$LOG"
  fi
  # 打包完即刪中間 XML，省磁碟（需要時 python src/updb2xml.py --adb $db 可重建）
  rm -f "out/haodoo-adb/$db.xml"
  echo "----- [$db] 完成 $(date) -----" | tee -a "$LOG"
done
echo "BUILD DONE $(date)" | tee -a "$LOG"
