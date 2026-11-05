# 3D 配件檢視器 API 規格（v1）

- Base URL：`/api/v1`
- 格式：JSON，屬性名稱 camelCase；長度單位 mm、重量 kg、角度為度（°）
- 錯誤：`application/problem+json`（RFC 7807 ProblemDetails），驗證錯誤附 `errors` 欄位
- 驗證：第一階段無登入。配置清單以 UUID 存取，持有 ID 即可讀寫；之後接 Supabase Auth 時改為驗證 JWT 並比對 `owner_id`。

## 端點一覽

| 方法 | 路徑 | 說明 |
|---|---|---|
| GET | `/catalog?market=TW` | 品牌 → 車系 → 世代 → 版本 目錄，用於版本下拉選單 |
| GET | `/trims/{trimId}` | 版本完整規格、輪胎、可選車漆、可用模型資源 |
| GET | `/assets/{assetId}` | 模型資源：產生器參數、部位對應、可開啟件 |
| GET | `/parts` | 車項目錄，含可裝配件與適用產品 |
| GET | `/accessory-categories` | 配件分類（外觀、內裝、安全、操控） |
| POST | `/builds` | 建立配置清單 |
| GET | `/builds/{buildId}` | 取得配置清單與其配件 |
| PATCH | `/builds/{buildId}` | 修改名稱、版本或車漆 |
| DELETE | `/builds/{buildId}` | 刪除配置清單（連同配件） |
| POST | `/builds/{buildId}/accessories` | 新增配件標註 |
| PATCH | `/builds/{buildId}/accessories/{accessoryId}` | 修改配件 |
| DELETE | `/builds/{buildId}/accessories/{accessoryId}` | 刪除配件 |
| GET | `/health` | 健康檢查（含資料庫連線），位於根路徑 `/health` |

---

## GET /catalog

Query：`market`（選填，預設 `TW`）。只回傳 `is_active` 的版本。

```json
{
  "makes": [{
    "code": "tesla", "name": "Tesla",
    "models": [{
      "code": "model-y", "name": "Model Y",
      "generations": [{
        "id": 1, "code": "juniper", "name": "煥新版", "startYear": 2025, "endYear": null,
        "trims": [
          { "id": 1, "code": "rwd", "name": "後輪驅動", "modelYear": 2026, "market": "TW", "drivetrain": "RWD", "styleVariant": "standard" },
          { "id": 2, "code": "long-range-awd", "name": "Long Range 全輪驅動", "modelYear": 2026, "market": "TW", "drivetrain": "AWD", "styleVariant": "premium" },
          { "id": 3, "code": "performance", "name": "Performance 全輪驅動", "modelYear": 2026, "market": "TW", "drivetrain": "AWD", "styleVariant": "performance" }
        ]
      }]
    }]
  }]
}
```

## GET /trims/{trimId}

```json
{
  "id": 3, "code": "performance", "name": "Performance 全輪驅動",
  "modelYear": 2026, "market": "TW", "drivetrain": "AWD", "styleVariant": "performance",
  "generation": { "id": 1, "code": "juniper", "name": "煥新版", "modelName": "Model Y", "makeName": "Tesla" },
  "specs": {
    "lengthMm": 4796, "widthMm": 1921, "widthMirrorsFoldedMm": 1982, "widthMirrorsUnfoldedMm": 2128,
    "heightMm": 1611, "wheelbaseMm": 2890, "frontTrackMm": 1646, "rearTrackMm": 1630,
    "groundClearanceMm": 152, "curbWeightKg": 2033,
    "verified": false, "verifiedAt": null,
    "sources": [{ "fields": ["length_mm"], "title": "U-CAR …", "url": "https://…", "retrievedAt": "2026-11-04", "verified": false, "note": null }]
  },
  "tires": [
    { "axle": "front", "designation": "255/35 R21", "widthMm": 255, "aspectRatio": 35, "rimDiameterIn": 21,
      "rimWidthIn": 9.5, "rimOffsetMm": 40, "overallDiameterMm": 712 },
    { "axle": "rear",  "designation": "275/35 R21", "widthMm": 275, "aspectRatio": 35, "rimDiameterIn": 21,
      "rimWidthIn": 10.5, "rimOffsetMm": 48, "overallDiameterMm": 726 }
  ],
  "paintColors": [{ "id": 1, "code": "stealth-grey", "name": "星空灰", "hex": "#4a4f55", "metalness": 0.55, "roughness": 0.30 }],
  "assets": [{ "id": 1, "code": "modely-juniper-parametric", "name": "…", "assetType": "parametric", "tier": "free", "version": 1 }]
}
```

- `styleVariant`：外觀版本（`standard`／`premium`／`performance`），前端用它從模型資源的 `params.variants` 取出這個版本的燈具、保桿、擾流板與輪框參數。台灣 2026 年式：後輪驅動 = standard、Long Range = premium、Performance = performance。
- `overallDiameterMm` = 輪圈直徑 × 25.4 + 2 × 胎寬 × 扁平比，四捨五入。
- `assets` 包含套用到整個世代（`trim_id is null`）與只套用此版本的資源，依 `tier`（free 在前）排序。
- 找不到或未啟用：404。

## GET /assets/{assetId}

```json
{
  "id": 1, "code": "modely-juniper-parametric", "assetType": "parametric", "tier": "free", "version": 1,
  "generator": "modely-juniper@1",
  "params": { "reference": { "units": "m", "axle_x": 1.445 }, "body": { "profile": [["M", 2.2, 0.23], "…"] } },
  "locked": false,
  "download": null,
  "partMappings": [
    { "partCode": "front-bumper", "mappingType": "zone", "priority": 10,
      "zone": { "surface": "body", "min": [2.12, -1, -3], "max": [3, 0.74, 3] }, "meshKey": null },
    { "partCode": "wheel-FL", "mappingType": "mesh", "priority": 0, "zone": null, "meshKey": "wheel-FL" }
  ],
  "openings": [
    { "code": "fdL", "name": "左前門", "hinge": [0.98, 0.7, -0.92], "axis": "y", "openAngleDeg": -65,
      "bodyRegion": { "min": [0.05, 0.4, -3], "max": [0.98, 3, -0.84] },
      "glassRegion": { "min": [0.05, -1, -3], "max": [0.98, 1.45, -0.55] },
      "meshKeys": ["mirror-L"] }
  ]
}
```

- 座標皆為資源的**參考座標系**（公尺；x 向前、軸距中點為原點；y 向上、地面為 0；z 向右）。前端依 `/trims/{id}` 的規格映射成實際尺寸。
- `tier = premium` 的資源第一階段 `locked = true`、`download = null`。之後付費開通時回傳 Supabase Storage 的簽名網址：`{ "url": "…", "expiresAt": "…" }`。

## GET /parts

車項 → 配件 → 產品 三層目錄。`category` 是車項在介面上的分組（外觀鈑件、車內…），配件的 `category` 是配件分類（外觀、內裝、安全、操控），尚未對應時為 null。

```json
[
  {
    "code": "windshield", "name": "前擋玻璃", "category": "玻璃與車頂",
    "accessoryTypes": [
      { "id": 1, "name": "隔熱紙", "category": null,
        "products": [
          { "id": 1, "brand": "舒熱佳", "name": "LX", "displayName": "舒熱佳 LX", "priceTwd": null, "url": null },
          { "id": 2, "brand": "舒熱佳", "name": "XE", "displayName": "舒熱佳 XE", "priceTwd": null, "url": null }
        ] },
      { "id": 2, "name": "玻璃鍍膜", "category": null,
        "products": [ { "id": 3, "brand": "K-WAX", "name": "GC-300 氟素玻璃鍍膜", "displayName": "K-WAX GC-300 氟素玻璃鍍膜", "priceTwd": null, "url": null } ] }
    ]
  }
]
```

- 車項是否能在 3D 模型上點選，由模型資源的 `partMappings` 決定；沒有對應的車項（例如底盤、門檻、車頂）只能從清單選擇。

## GET /accessory-categories

```json
[ { "code": "exterior", "name": "外觀" }, { "code": "interior", "name": "內裝" },
  { "code": "safety", "name": "安全" }, { "code": "handling", "name": "操控" } ]
```

## 配置清單（builds）

### BuildDto

```json
{
  "id": "6f1c…", "name": "我的 Model Y", "trimId": 1, "paintColorId": 2,
  "createdAt": "2026-11-04T05:51:00Z", "updatedAt": "2026-11-04T05:51:00Z",
  "accessories": [AccessoryDto]
}
```

### AccessoryDto

```json
{
  "id": "a2b3…", "partCode": "windshield", "partName": "前擋玻璃", "assetId": 1,
  "accessoryTypeId": 1, "accessoryTypeName": "隔熱紙", "category": null,
  "productId": 1, "productName": "舒熱佳 LX",
  "name": "舒熱佳 LX", "status": "considering", "priceTwd": 12000, "note": null,
  "position": { "p": [0.82, 1.21, 0.2], "n": [0.55, 0.83, 0] },
  "isExample": false, "createdAt": "…", "updatedAt": "…"
}
```

- `status`：`considering`（評估中）／`planned`（準備購買）／`purchased`（已購買）／`installed`（已安裝）
- `position`：參考座標系中的點與法向量，可為 null（只記錄車項、不標在模型上）
- `name`：顯示名稱。選了產品時預設為產品名稱，只選配件時為配件名稱，也可以自訂。
- `category`：配件分類 `{ code, name }`，配件尚未對應分類或沒有選配件時為 null。

### POST /builds

```json
{ "name": "我的 Model Y", "trimId": 1, "paintColorId": 2 }
```
`name` 選填（1–60 字），`paintColorId` 選填但必須屬於該版本的世代。回傳 201 與 BuildDto，`Location` 指向新資源。

### PATCH /builds/{buildId}

任一欄位選填：`name`、`trimId`、`paintColorId`。換版本時，若原車漆不屬於新版本的世代會回 400。

### POST /builds/{buildId}/accessories

```json
{
  "partCode": "windshield", "accessoryTypeId": 1, "productId": 1, "assetId": 1,
  "status": "considering", "priceTwd": 12000, "note": "含施工",
  "position": { "p": [0.82, 1.21, 0.2], "n": [0.55, 0.83, 0] }, "isExample": false
}
```
- 必填：`partCode`。另外至少要有 `accessoryTypeId` 或 `name` 其中之一。
- `accessoryTypeId` 必須是這個車項可裝的配件；`productId` 必須同時指定配件，且是該「車項 × 配件」的適用產品，否則回 400。
- `name` 選填（1–40 字），未填時帶入產品或配件名稱；目錄裡沒有的配件就只填 `name`。
- `priceTwd` ≥ 0，`note` ≤ 500 字，`position.p`／`position.n` 必須是 3 個有限數值。回傳 201 與 AccessoryDto。

### PATCH /builds/{buildId}/accessories/{accessoryId}

任一欄位選填：`partCode`、`accessoryTypeId`、`productId`、`name`、`status`、`priceTwd`、`note`、`position`。換配件時會清掉原本的產品；改配件或產品且沒有同時傳 `name` 時，名稱會跟著更新。要清除欄位，傳 `"clear": ["accessoryType", "product", "priceTwd", "note", "position"]` 中的任意幾項（清除配件會一併清除產品）。

## 狀態碼

| 狀態碼 | 情境 |
|---|---|
| 200 | 讀取、修改成功 |
| 201 | 建立成功 |
| 204 | 刪除成功 |
| 400 | 驗證失敗（ProblemDetails + `errors`） |
| 404 | 版本、資源、配置清單或配件不存在 |
