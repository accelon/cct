# swjz／swjzz／swjzzp — 說文解字注

## 現況

- 成品目標：`D:\accelon3\swjz.adb`、`swjzz.adb`、`swjzzp.adb`（版本是否全發由作者定）
- 同一 work：`shuowen`
- 現有 adb：`swjz`（78,671 行）、`swjzz`／`swjzzp`（60,754 行）
- 三者各 10,706 個 `<字 id="w…">`，集合完全相同
- 沒有 `<頁>`；章節用 `<chaptertitle id>`／`<卷 id>`

## 新管線要求

1. 保留 `<字 id="w…">`；三版 id 必須一致。
2. anchor 用 `char:w…`，不是 page／line。
3. `a-b` 相對字條內漢字；不是全 adb byte offset。
4. 不把 edition 排版寫進引用；edition 只由 catalog 決定。
5. 打包前產生 anchor manifest：anchorId、kind=char、textHash。
6. 同一 work 的多個 edition 共用 anchor；同一字內容差異用 textHash／版本處理。

## 驗收

- [ ] 三版字 id 各 10,706、交集 10,706。
- [ ] `shuowen?w0010010` 在三個 edition 都能定位。
- [ ] 不需要頁碼；不把行號寫進 anchor。
- [ ] 字條內 range 邊界正確（含最後一字）。
- [ ] `works.tsv` 的 shuowen editions 與實際 adb 一致。

## 待辦

- [ ] 確認來源與版本（swjz／swjzz 的 raw 或既有 adb）
- [ ] 寫 `src/build-shuowen.ts`
- [ ] 產生 anchor manifest／跨版本 id 檢查
- [ ] 輸出 adb 並記 version-log
