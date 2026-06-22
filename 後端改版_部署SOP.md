# 後端改版 · 部署 SOP（不用 cmd / 不用 wrangler）

> 用途：每次「後端程式」改過（`punch-backend/src/index.js`），用這招把新版推上線。
> 前端（網頁 index.html / punch.html / admin.html）不用這招，那個雙擊 `部署.bat` 就好。
> 怎麼分辨？改的是 `punch-backend` 裡的東西 = 後端，用這張 SOP。

---

## 一句話
**Cloudflare 後台 → 打開 Worker → 把新程式碼整段貼上去 → Deploy。** 全程點滑鼠。

---

## 步驟

1. **先複製新程式碼**
   - 打開檔案：`Downloads\廣修網站\punch-backend\src\index.js`
   - （右鍵 → 開啟方式 → 記事本）
   - 在裡面按 **Ctrl+A**（全選）→ **Ctrl+C**（複製）

2. **進 Cloudflare 後台**
   - 網址：**https://dash.cloudflare.com**
   - 帳號：`coating_wu@darryking.com`

3. **左邊選單** → **Workers & Pages**（或 Compute → Workers & Pages）

4. 點清單裡的 **`guangxiu-punch`**

5. 右上角點 **`</> Edit code`**（編輯程式碼），會開一個程式碼編輯器

6. **換掉舊程式碼**
   - 在左邊程式碼區**點一下**
   - **Ctrl+A**（全選舊的，反白）→ **Delete**（刪光）
   - **Ctrl+V**（貼上新的）

7. 右上角按藍色 **`Deploy`**

8. **完成**：上方版本號會變成一串新的、後面標 **(Active) Latest**，就成功了

---

## 重點 / 常見問題

- **D1 資料庫、ADMIN_KEY 不會被動到** —— 那些是綁在 Worker 上的設定，只換程式碼不影響，免重設。
- **貼上後程式碼長得跟舊的不一樣（比較短、開頭是中文註解）是正常的。**
- **怎麼確認真的上線了？** 版本號變新 + 標 Active 就對了。要更保險可請 Claude 打一次 API 測。
- **為什麼不用 `部署.bat` 的 wrangler？** 那個要先 `wrangler login` 登入 Cloudflare，沒登入就會卡。這招完全跳過，最穩。

---

## 線上資訊速查
- Worker 名稱：`guangxiu-punch`
- 線上網址：`https://guangxiu-punch.coating-wu.workers.dev`
- 後台主密碼（ADMIN_KEY）：`gx-admin-2026`
- 管理員登入：員工編號 `000` ＋密碼 `gx-admin-2026`
