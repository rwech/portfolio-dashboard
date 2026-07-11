# 開發者文件

## 快速開始

1. **環境需求**：Node.js 18 以上版本（本專案以 Node 22 開發、CI 也使用 Node 22 測試）、npm。
2. **取得程式碼並安裝依賴**：
   ```bash
   git clone https://github.com/rwech/portfolio-dashboard.git
   cd portfolio-dashboard
   npm install
   ```
3. **啟動本機開發伺服器**（任選一種，詳見下方「本機開發」）：
   ```bash
   python3 -m http.server 8000
   ```
   瀏覽器開啟 `http://localhost:8000/`，即可看到「示範模式」內建範例資料。
4. **執行測試與檢查**（送出 PR 前請務必執行，CI 也會自動跑同一指令）：
   ```bash
   npm test
   ```

> 本專案是純前端靜態網頁（無建置步驟、無 bundler），`index.html` 直接以多個 `<script>` 標籤依序載入 `src/*.js`，**不需要** `npm run dev` 或任何打包指令；修改 `src/` 下的檔案後重新整理瀏覽器即可看到效果。

## 專案結構

```
index.html          唯一的 HTML 進入點，依序載入下方所有 src/*.js
src/
  config.js          可調整設定（如 apiBaseUrl）
  storage.js          localStorage 讀寫（交易紀錄、現價快取、篩選條件等）
  csv.js              CSV 解析／序列化／下載
  importer.js          匯入 pipeline 純邏輯：編碼偵測（UTF-8/Big5）、欄位對應猜測、值正規化、去重分析
  exchangeRate.js      匯率抓取與快取
  stockPrice.js        現價抓取（呼叫 /api/stock-price）與快取/估計值 fallback
  roi.js               ROI／損益核心計算邏輯（與 UI 完全無關，最適合寫單元測試）
  charts.js            Chart.js 圖表渲染
  ui.js                DOM 渲染（表格、表單、提示訊息等）
  app.js               串接以上所有模組、處理使用者互動、應用程式狀態（state）
api/
  stock-price.js       Vercel Serverless Function：代為呼叫 Yahoo Finance 取得即時股價（純靜態託管時可省略，現價會自動 fallback）
db/
  *.example.csv        範例資料（示範模式使用，會被 git 追蹤）
  *.csv                你自己的真實交易資料（已加入 .gitignore，不會被提交）
tests/                 Vitest 單元測試，檔名對應 src/api 內的同名模組
scripts/
  check-api-esm.mjs     以 Node 原生 ESM loader 重新載入 api/stock-price.js 的迴歸測試
```

### 模組寫法：`window.PFD.*`（不是 ES Module import/export）

每個 `src/*.js` 都是一個立即執行函式（IIFE），把對外公開的函式/物件掛在共用的全域變數 `window.PFD.<模組名>` 上，例如 `src/csv.js` 結尾會執行：

```js
window.PFD.csv = { parseCsv, stringifyCsv, ... };
```

`index.html` 中 `<script>` 標籤的**載入順序就是相依順序**（例如 `roi.js` 用到 `stockPrice.js` 的函式，所以必須排在它後面），新增模組時請依相依關係插入正確位置。`app.js` 是最後載入、也是最後被呼叫 `init()` 的模組，負責把其他模組串起來並驅動畫面。

撰寫測試時也是用同一套全域變數，而不是 `import { x } from './foo.js'`：

```js
import '../src/storage.js'; // 有相依關係的模組要先 import
import '../src/csv.js';

const { parseCsv } = window.PFD.csv;
```

## 本機開發

- **完整測試（含現價自動抓取）**：安裝 [Vercel CLI](https://vercel.com/docs/cli) 後執行 `npx vercel dev`（第一次需要 `vercel login`），瀏覽器開啟 `http://localhost:3000/`。
- **僅測試非現價功能**：執行 `python3 -m http.server 8000`，瀏覽器開啟 `http://localhost:8000/`。此模式下 `/api/stock-price` 會回傳 404，現價會自動走 fallback 鏈（快取或估計值），其餘功能不受影響。

> 注意：直接用瀏覽器以 `file://` 開啟 `index.html` 會因為 `fetch('db/...')` 等請求被 CORS 擋下而無法正常載入初始資料，請務必透過上述任一種簡易伺服器開啟。

## 程式碼風格

- 使用 [ESLint](eslint.config.js) 檢查常見錯誤與風格問題：`npm run lint`。
- 使用 [Prettier](.prettierrc.json) 自動排版：`npm run format`（寫入修改）或 `npm run format:check`（只檢查、不寫入，CI 沒有強制跑這一項，但建議送 PR 前先跑過）。
- 沒有額外的 commit message 規範，但請用清楚描述「為什麼」而非「做了什麼」的訊息。

## 自動化測試

執行 `npm install` 後，使用 `npm test` 依序執行：

1. **ESLint**：程式碼風格與常見錯誤檢查。
2. **[Vitest](https://vitest.dev/) 單元測試**：涵蓋 `src/` 下核心邏輯（CSV 解析、ROI 計算、現價/匯率轉換、表格渲染的 XSS 防護與報價過期標示等）與 `api/stock-price.js`，並啟用 coverage 報告；若統計式/分支/函式/行數覆蓋率低於 `vitest.config.js` 設定的門檻，測試會失敗（用來防止覆蓋率隨著新功能加入而悄悄下降）。
3. **ESM loader 迴歸測試**（`scripts/check-api-esm.mjs`）：以 Node 原生 ESM loader 重新載入 `api/stock-price.js`，確保其 `export default` 寫法在 Vercel 等純 ESM 執行環境下不會出錯（曾發生過用 `module.exports` 寫法在 production 噴錯、但本機 Vitest 測試因為自帶轉譯而沒抓到的真實案例）。

GitHub Actions（[`.github/workflows/test.yml`](.github/workflows/test.yml)）會在每次 push 到 `main` 與每個 Pull Request 自動執行上述 `npm test`，確保變更不會破壞既有功能或拉低測試覆蓋率。

新增功能時的測試慣例：

- 純邏輯（CSV 解析、ROI 計算、匯率/現價轉換等）請寫在 `src/` 對應模組並在 `tests/<模組名>.test.js` 補上單元測試；這類邏輯與 DOM 無關，最容易測也最該優先補。
- 會操作 DOM 的渲染邏輯（`ui.js`、`app.js`）可參考 `tests/render-integration.test.js`、`tests/app.test.js`，測試環境用 [jsdom](https://github.com/jsdom/jsdom) 模擬瀏覽器。
- 跑 `npx vitest run --coverage` 可在終端機看到逐檔案的覆蓋率報告與未覆蓋行號，用來找出還沒測到的分支。

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
