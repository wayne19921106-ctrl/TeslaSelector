# Model Y 配件檢視器

可 360° 旋轉、開關車門與前後廂的 3D 配件檢視器。依官方規格以參數化方式生成車型，點擊部位即可標註配件。前後端分離：前端呼叫 ASP.NET Core Web API，資料存在 Supabase Postgres。

第一階段範圍：Tesla Model Y 煥新版（Juniper）2026 年式，台灣市場三個版本（後輪驅動、Long Range 全輪驅動、Performance 全輪驅動）。

## 專案結構

```
db/
  migrations/20261104000001_init.sql          資料表、索引、RLS
  migrations/20261104000003_member_entitlements.sql 會員方案、訂閱、單一模型授權、權限判斷函式
  migrations/20261104000004_fix_touch_updated_at_search_path.sql
  migrations/20261104000005_split_admin_member_schemas.sql 後台搬到 admin、會員搬到 member schema
  migrations/20261105000006_trim_style_variants.sql 版本外觀（Standard／Premium／Performance）
  migrations/20261105000007_style_variant_tweaks.sql
  migrations/20261105000008_accessory_catalog.sql 車項清單重整、配件與品牌、內建／自訂產品、候選產品與選定
  seed/20261104000002_seed_model_y_juniper.sql 車型、規格、部位、參數化模型
docs/api.md                                    API 規格
backend/                                       .NET 8 Web API（EF Core + Npgsql）
  src/AccessoryViewer.Api/
    Controllers/   CatalogController（目錄、版本、模型、部位）、BuildsController（配置清單、配件）
    Contracts/     Request / Response DTO
    Data/          Entity、AppDbContext、jsonb 對應
frontend/                                      靜態前端（three.js r128）
  js/config.js     API 位址
  js/api.js        HttpClient 與離線示範用 MockClient
  js/generator.js  參數化模型產生器 modely-juniper@1
  js/app.js        介面與互動
  js/mock-data.js  從資料庫匯出的示範資料
tools/
  export-mock.sql      從資料庫匯出示範資料
  build-preview.mjs    打包成單一 HTML 預覽檔
```

## Schema 配置

| Schema | 內容 |
|---|---|
| `viewer` | 檢視器產品：車型、規格、模型、部位、配置清單，以及會員在本產品的方案與權限 |
| `member` | 會員身分（跨產品共用）：`member_profiles`、`member_oauth_providers`、`member_login_logs` |
| `admin` | 後台：帳號、角色、權限、選單、登入與操作紀錄 |
| `public` | 只放共用型別（`login_result`），不放資料表 |

三個 schema 都不開放給 Supabase Data API，全部經由 .NET API 存取。`member`、`admin` 的資料表不是由本 repo 建立，migration 0003 之後依賴它們已存在。

## 資料模型重點

- **車型目錄**：`makes → vehicle_models → generations（改款世代）→ trims（年式 × 市場 × 版本）`。新增 2027 年式或下一代改款，只要新增 `generations` / `trims` 列。
- **規格**：`trim_specs`（1:1）與 `tire_specs`（前後軸）。`sources` 欄位記錄每個欄位的資料來源與是否已核對；`verified_at` 有值才代表全部與官網核對完成。
- **模型資源**：`model_assets.asset_type` 分 `parametric`（前端依規格生成）與 `gltf`（Supabase Storage 的 .glb）；`tier` 分 `free` / `premium`。第一階段 premium 只回傳中繼資料（`locked: true`）。
- **配件目錄（車項 → 配件 → 產品）**：`parts`（車項，47 項）→ `part_accessory_types`（車項可裝的內建配件）→ `accessory_types`（配件，例如隔熱紙；另有分類 `accessory_categories`：外觀、內裝、安全、操控）。產品 `products` 關聯品牌 `brands` 與配件，欄位有名稱、型號、建議售價、推薦指數（1–5），並以 `part_accessory_products` 掛在「車項 × 配件」底下。
- **品牌**：`brands` 記錄序號、品牌（英文，唯一、不分大小寫）、名稱、Logo、推廣碼、品牌介紹、網址。
- **內建與自訂**：配件與產品都以 `source` 區分 `builtin`（內建）與 `custom`（使用者自訂）。自訂配件與自訂產品屬於某份配置清單（`owner_build_id`），接上會員後可改歸屬會員（`owner_member_id`）。自訂產品可選既有品牌，或直接輸入品牌文字。
- **配置清單**：`build_accessories` 是某車項下的一個配件（同一車項同一配件一筆）；`build_accessory_products` 是它的候選產品，可多筆、最多選定一筆（唯一索引保證）。`status` 只有選定產品後才能設為 `purchased`（已購買）或 `installed`（已安裝），取消或更換選定產品時由 trigger 自動清空。
- **部位辨識**：`asset_part_mappings` 用座標範圍（zone）或物件名稱（mesh）對應到 `parts`，一個車項可以有多個對應（例如車身玻璃 = 左右側窗、後照鏡 = 左右兩面）。沒有對應的車項（底盤、門檻、車頂）只能從清單選。日後換成 .glb 模型時改用 mesh 對應，前端互動不變。
- **開啟件**：`asset_openings` 記錄鉸鏈、旋轉軸、角度與帶動的零件。
- **版本外觀**：`trims.style_variant` 指定版本使用哪一組外觀（台灣 2026 年式：後輪驅動 = standard、Long Range = premium、Performance = performance），前端從 `model_assets.params.variants` 取出燈具、前保桿、擾流板與輪框參數。燈具與飾條以射線貼合車身表面生成，參數只需要高度與左右範圍。外觀參數是參考 Tesla 公開的外觀渲染圖目視估計，網站本身不使用 Tesla 的圖片。
- **參考座標系**：部位範圍、鉸鏈與配件標註位置都存在模型的參考座標系，前端依版本規格映射成實際尺寸，所以切換版本後標註仍在同一部位。
- **使用者資料**：`builds`（配置清單）與 `build_accessories`（配件、狀態、價格、備註、位置）。`builds.owner_id` 連到 `member.member_profiles(id)`，未登入時為 null。
- **會員與付費**：`plans`（免費／付費方案）→ `plan_tiers`（方案可用的模型等級）；`member_subscriptions`（會員訂閱，來源 admin／payment／promo，後台開通記錄 `admin_accounts`）；`member_asset_grants`（單一模型授權）。以 `viewer.member_can_access_asset(member_id, asset_id)` 判斷權限：免費模型人人可用，付費模型需會員狀態為 active 且有有效訂閱或授權。

## 1. 建立 Supabase 資料庫

1. 在 Supabase 建立專案。
2. 到 **SQL Editor** 依序執行 `db/migrations/20261104000001_init.sql` 與 `db/seed/20261104000002_seed_model_y_juniper.sql`。
   使用 Supabase CLI 的話，把兩個檔案放進 `supabase/migrations/` 後執行 `supabase db push`。
3. 資料表建在 `viewer` schema，**不要**把它加進 Settings → API 的 Exposed schemas。所有存取都透過 .NET API；表格也都啟用了 RLS 且沒有 policy，anon key 讀不到。

## 2. 啟動後端

需要 .NET 8 SDK。

```bash
cd backend/src/AccessoryViewer.Api
dotnet user-secrets set "ConnectionStrings:Viewer" "Host=aws-0-<region>.pooler.supabase.com;Port=5432;Database=postgres;Username=postgres.<project-ref>;Password=<密碼>;SSL Mode=Require"
dotnet run
```

- 連線字串在 Supabase 的 **Connect** → **Session pooler**（支援 IPv4）。不要用 Transaction pooler（6543），它不支援 Npgsql 的 prepared statements。
- API：<http://localhost:5080/api/v1>，Swagger：<http://localhost:5080/swagger>，健康檢查：<http://localhost:5080/health>
- `AccessoryViewer.Api.http` 可在 Visual Studio / Rider / VS Code REST Client 直接測試。
- 前端網址要加進 `appsettings.Development.json` 的 `Cors:AllowedOrigins`（預設已含 5173 與 5500 埠）。

## 3. 啟動前端

前端是純靜態檔案，任何靜態伺服器都可以：

```bash
npx serve frontend -l 5173
# 或 VS Code Live Server（5500 埠）
```

`frontend/js/config.js` 的 `apiBase` 指向後端：在 localhost 開啟時連 `http://localhost:5080/api/v1`，其他網域預設不連 API。連不上 API 時會自動改用 `mock-data.js` 的示範資料，右上角顯示「離線示範資料」，配置清單存在瀏覽器 localStorage。

## 部署前端到 GitHub Pages

`.github/workflows/deploy-frontend.yml` 會在 `main` 分支的 `frontend/` 有變更時，自動把 `frontend/` 發佈到 GitHub Pages。

1. 把專案推到 GitHub（免費帳號需為 public repo）。
2. repo 的 **Settings → Pages → Build and deployment → Source** 選 **GitHub Actions**。
3. 推送到 `main`，或在 **Actions** 頁手動執行一次 workflow。網址為 `https://<帳號>.github.io/<repo>/`。

後端部署後：把正式 API 網址填入 `config.js` 的 `apiBase`，並把 `https://<帳號>.github.io` 加進後端的 `Cors:AllowedOrigins`。

## 部署後端（容器）

`backend/Dockerfile` 會把 API 包成容器映像，可放到任何能跑容器的雲端服務。`.github/workflows/backend-image.yml` 在 `main` 的 `backend/` 或 `db/` 有變更時自動執行：

1. 編譯 → 在 PostgreSQL 16 上套用全部 migration（`tools/apply-migrations.sh --with-stubs`）
2. 建置映像、啟動容器、跑 API 冒煙測試（`tools/smoke-test.sh`）
3. 通過後推到 `ghcr.io/<帳號>/teslaselector-api`，標籤為 `latest` 與 `sha-<commit>`

> GHCR 套件預設是 private。雲端平台若要直接拉映像，請到 GitHub 的 **Packages → teslaselector-api → Package settings** 改成 public，或在平台設定 GHCR 的存取權杖。

容器需要的環境變數：

| 變數 | 範例 | 說明 |
|---|---|---|
| `ConnectionStrings__Viewer` | `Host=aws-0-<region>.pooler.supabase.com;Port=5432;Database=postgres;Username=postgres.<project-ref>;Password=…;SSL Mode=Require;Trust Server Certificate=true` | Supabase **Session pooler**（IPv4 可用）。請放在平台的 secret，不要寫進 repo |
| `Cors__AllowedOrigins__0` | `https://wayne19921106-ctrl.github.io` | 前端網址，可再加 `__1`、`__2` |
| `PORT` | `8080` | 平台有指定時會自動帶入；未設時容器聽 8080 |

本機試跑：

```bash
docker build -t teslaselector-api backend
docker run --rm -p 8080:8080 -e "ConnectionStrings__Viewer=…" teslaselector-api
curl http://localhost:8080/health
```

可選的平台：Google Cloud Run、Azure Container Apps、Render、Fly.io，或自己的 VPS（Docker + Caddy／Nginx 反向代理與 HTTPS）。部署後把 API 網址填入前端 `config.js` 的 `apiBase`。

## 更新示範資料與預覽檔

```bash
psql "<連線字串>" -At -q -f tools/export-mock.sql > /tmp/mock.json
# 包成 window.MOCK_DATA = …; 寫入 frontend/js/mock-data.js
node tools/build-preview.mjs        # 輸出 dist/preview.html
```

## 規格核對

seed 中的規格來自 U-CAR 與 EVSpecifications（歐規），`verified = false`。上線前請對照 [Tesla 台灣官網](https://www.tesla.com/zh_TW/modely) 逐項核對，更新 `trim_specs.sources` 並寫入 `verified_at`。另外：

- Performance 車高：U-CAR 為 1,611 mm、EVSpecifications 為 1,610 mm，暫採 1,611。
- 輪距、離地高、不含後照鏡車寬取自歐規資料，台灣規格可能不同。
- 前後懸比例（`params.front_overhang_ratio = 0.49`）是估計值，官方未公布。
- 車漆中文名稱待核對。

## 驗證狀態

- ✅ migration 與 seed 已在 PostgreSQL 16 實際執行。
- ✅ 前端在無頭 Chromium 測過：載入、三個版本切換、點擊辨識部位、新增配件、開關車門。
- ✅ 後端由 GitHub Actions（`backend-image.yml`）實際編譯、以容器連 PostgreSQL 跑 API 冒煙測試。

## 下一步

- 接 Supabase Auth：API 驗證 JWT，`builds.owner_id` 對應 `auth.users(id)`。
- 付費模型：`tier = premium` 的 .glb 放在私有 bucket，API 驗證權限後回傳簽名網址；前端加入 `GLTFLoader` 產生器。
- 後台：規格與部位資料的維護介面。
