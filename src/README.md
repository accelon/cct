# src — builders

還沒實作。每個 adb 一支 builder，或共用一個以 `works.tsv` 為輸入的 builder。

預計：

```text
src/build-13j.ts       13j（13 works；semantic segment）
src/build-shuowen.ts   swjz／swjzz／swjzzp（char:w…）
src/check-anchors.ts   anchor manifest、duplicate、跨版本字 id
```

規則：

- 用母區 `D:\2026\adb-converter\ts\src\adbauthor.ts` 的 `authorAdb`，不要自寫打包。
- 漢字／VA／頁座標用母區共用 helper。
- 13j：`<章>`／`<節>`／`<項>` 加穩定 id；不要用 page。
- swjz／swjzz：`<字 id>` 三版必須一致；不要用頁。
- 建置輸出先到 `out/`，驗證後 copy 到 `D:\accelon3\<adb>.adb`。
- 大量引用 links 不寫在正文；引用庫自己的 `xout_<workId>` 是另一區的責任。
- 舊 `src/legacy/split-*.js`／`gen-yijing.js` 是 legacy；不是新管線。
