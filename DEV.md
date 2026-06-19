# 開發者文件

## 部署

本專案建議部署在支援 Serverless Functions 的平台：

- **Vercel（建議）**：使用 `vercel` CLI 或連結 GitHub repo 後即可零設定自動部署（免費額度足夠），會同時部署靜態檔案與 `api/stock-price.js`。
- **純靜態檔案託管**（如 GitHub Pages）：頁面仍可正常開啟使用，但因為沒有 `/api/stock-price`，持股現價會自動 fallback 成「估計值」，使用者仍可隨時手動輸入現價。

## 本機開發

- **完整測試（含現價自動抓取）**：安裝 [Vercel CLI](https://vercel.com/docs/cli) 後執行 `npx vercel dev`（第一次需要 `vercel login`），瀏覽器開啟 `http://localhost:3000/`。
- **僅測試非現價功能**：執行 `python3 -m http.server 8000`，瀏覽器開啟 `http://localhost:8000/`。此模式下 `/api/stock-price` 會回傳 404，現價會自動走 fallback 鏈（快取或估計值），其餘功能不受影響。

> 注意：直接用瀏覽器以 `file://` 開啟 `index.html` 會因為 `fetch('db/...')` 等請求被 CORS 擋下而無法正常載入初始資料，請務必透過上述任一種簡易伺服器開啟。
