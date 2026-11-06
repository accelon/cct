# 13j — 十三經

## 現況

- 成品目標：`D:\accelon3\13j.adb`
- 現有 adb：`D:\accelon3\13j.adb`（可作參考／驗證，不是新管線的來源）
- 13 個 work：周易、尚書、毛詩、周禮、儀禮、禮記、左傳、公羊傳、穀梁傳、論語、
  孝經、爾雅、孟子
- 目前 42,173 行、259 `<章>`、1,448 `<節>`、300 `<項>`、950 `<頁>`（285 個不同 n）

## 新管線要求

1. 一行一個 adb 行；超過 4,000 字要切。
2. `<章>`／`<節>`／`<項>` 加穩定 `id`；顯示文字保留。
3. **不用 `<頁>` 作 xref target**；semantic segment 才是 anchor。
4. leaf id 唯一就用 leaf；撞名才加最少祖先（例 `隱公/經元年`）。
5. 13 個 `<書 id>` 對應 `works.tsv` 的 work id。
6. 打包前產生 anchor manifest：anchorId、kind=seg、parent、textHash。

## 驗收

- [ ] 13 個 work 都有 work catalog entry。
- [ ] 259 章／1,448 節／300 項的 canonical segment id 在各自 work 內唯一。
- [ ] `shijing?關雎`、`shangshu?堯典`、`yijing?乾` 可定位。
- [ ] 撞名 leaf 有最少祖先，且仍唯一。
- [ ] `<頁>`／`<頁元>` 不進 xref manifest。
- [ ] `yijing?乾` 與 `shangshu?堯典` 不會互撞。

## 待辦

- [ ] 確認 raw 來源與版本
- [ ] 寫 `src/build-13j.ts`
- [ ] 產生 anchor manifest
- [ ] 輸出 `D:\accelon3\13j.adb` 並記 version-log
