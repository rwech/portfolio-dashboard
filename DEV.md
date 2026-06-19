# 開發者文件

## 部署

### 方式一：全部部署在 Vercel（最簡單）

使用 `vercel` CLI 或連結 GitHub repo 後即可零設定自動部署（免費額度足夠），會同時部署靜態檔案與 `api/stock-price.js`，不需要額外設定。

### 方式二：HTML 部署在 GitHub Pages，`/api/stock-price` 部署在 Vercel

兩個服務分屬不同網域，需要額外兩個步驟：

1. **部署後端到 Vercel**：將本 repo 連結到 Vercel（或執行 `vercel`），Vercel 只會用到 `api/stock-price.js`；部署完成後會取得一個網域，例如 `https://your-project.vercel.app`。
2. **設定前端指向該網域**：編輯 [src/config.js](src/config.js)，將 `apiBaseUrl` 改成上一步取得的 Vercel 網域（不要加結尾斜線），例如：

   ```js
   apiBaseUrl: 'https://your-project.vercel.app',
   ```

3. **部署 HTML 到 GitHub Pages**：到 repo 的 Settings → Pages，Source 選擇要發布的分支與 `/ (root)` 目錄即可（本專案本身就是純靜態的 `index.html` + `src/`，不需要額外建置步驟）。
4. **CORS 白名單**：`api/stock-price.js` 預設只允許 `https://rwech.github.io` 這個來源呼叫（其餘來源會收到 403）。若你的 GitHub Pages 網域不同，或之後想改用自訂網域，到 Vercel 專案的 Settings → Environment Variables 設定 `ALLOWED_ORIGINS`（逗號分隔多個來源），不需要改程式碼。同網域請求（方式一）不受影響，因為瀏覽器通常不會在同網域請求帶上 `Origin` 標頭。

若不想串接 Vercel 後端，純靜態託管也能正常運作：沒有 `/api/stock-price` 時，持股現價會自動 fallback 成「估計值」，使用者仍可隨時手動輸入現價。

## 本機開發

- **完整測試（含現價自動抓取）**：安裝 [Vercel CLI](https://vercel.com/docs/cli) 後執行 `npx vercel dev`（第一次需要 `vercel login`），瀏覽器開啟 `http://localhost:3000/`。
- **僅測試非現價功能**：執行 `python3 -m http.server 8000`，瀏覽器開啟 `http://localhost:8000/`。此模式下 `/api/stock-price` 會回傳 404，現價會自動走 fallback 鏈（快取或估計值），其餘功能不受影響。

> 注意：直接用瀏覽器以 `file://` 開啟 `index.html` 會因為 `fetch('db/...')` 等請求被 CORS 擋下而無法正常載入初始資料，請務必透過上述任一種簡易伺服器開啟。
