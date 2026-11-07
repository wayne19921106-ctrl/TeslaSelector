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
| GET | `/parts` | 車項目錄，含可裝的內建配件與內建產品 |
| GET | `/accessory-categories` | 配件分類（外觀、內裝、安全、操控） |
| GET | `/brands` | 品牌清單 |
| POST | `/builds` | 建立配置清單 |
| GET | `/builds/{buildId}` | 取得配置清單與其配件 |
| PATCH | `/builds/{buildId}` | 修改名稱、版本或車漆 |
| DELETE | `/builds/{buildId}` | 刪除配置清單（連同配件） |
| POST | `/builds/{buildId}/accessories` | 在車項下加入配件（內建或自訂） |
| PATCH | `/builds/{buildId}/accessories/{accessoryId}` | 修改狀態、備註、位置 |
| DELETE | `/builds/{buildId}/accessories/{accessoryId}` | 刪除配件 |
| POST | `/builds/{buildId}/accessories/{accessoryId}/products` | 加入候選產品（內建或自訂） |
| PATCH | `/builds/{buildId}/accessories/{accessoryId}/products/{candidateId}` | 選定／取消選定候選產品 |
| DELETE | `/builds/{buildId}/accessories/{accessoryId}/products/{candidateId}` | 移除候選產品 |
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

車項 → 內建配件 → 內建產品。`category` 是車項在介面上的分組（外觀鈑件、車內…）；配件的 `category` 是配件分類（外觀、內裝、安全、操控），尚未對應時為 null。

```json
[
  {
    "code": "windshield", "name": "前擋玻璃", "category": "玻璃與車頂",
    "accessoryTypes": [
      { "id": 1, "name": "隔熱紙", "category": null,
        "products": [
          { "id": 1, "source": "builtin",
            "brand": { "id": 1, "code": "Solar Gard", "name": "舒熱佳", "logoUrl": null },
            "brandName": "舒熱佳", "name": "LX", "model": null,
            "suggestedPriceTwd": null, "rating": null, "url": null, "displayName": "舒熱佳 LX" }
        ] }
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

## GET /brands

```json
[ { "id": 1, "code": "Solar Gard", "name": "舒熱佳", "logoUrl": null, "promoCode": null, "description": null, "url": null } ]
```

`code` 為品牌英文名稱，唯一（不分大小寫）。

## 配置清單（builds）

結構：配置清單 → 車項下的配件（內建或自訂，同一車項同一配件一筆）→ 候選產品（內建或自訂，可多筆，最多選定一筆）。

### BuildDto

```json
{
  "id": "6f1c…", "name": "我的 Model Y", "trimId": 1, "paintColorId": 2,
  "createdAt": "2026-11-07T03:21:00Z", "updatedAt": "2026-11-07T03:21:00Z",
  "accessories": [AccessoryDto]
}
```

### AccessoryDto

```json
{
  "id": "a2b3…", "partCode": "windshield", "partName": "前擋玻璃", "assetId": 1,
  "accessoryType": { "id": 1, "name": "隔熱紙", "isCustom": false, "category": null },
  "status": "purchased", "note": null,
  "position": { "p": [0.82, 1.21, 0.2], "n": [0.55, 0.83, 0] }, "isExample": false,
  "products": [
    { "id": "c1…", "isSelected": true,  "product": { "id": 1, "source": "builtin", "displayName": "舒熱佳 LX", "…": "…" } },
    { "id": "c2…", "isSelected": false, "product": { "id": 9, "source": "custom", "brand": null, "brandName": "3M",
        "name": "極黑系列", "model": null, "suggestedPriceTwd": 15000, "rating": 4, "url": null, "displayName": "3M 極黑系列" } }
  ],
  "createdAt": "…", "updatedAt": "…"
}
```

- `status`：`purchased`（已購買）／`installed`（已安裝）／`null`（尚未購買）。只有選定產品後才能設定；取消選定或換選定產品時自動清空。
- `position`：參考座標系中的點與法向量，可為 null（只記錄車項、不標在模型上）。

### POST /builds

```json
{ "name": "我的 Model Y", "trimId": 1, "paintColorId": 2 }
```
`name` 選填（1–60 字），`paintColorId` 選填但必須屬於該版本的世代。回傳 201 與 BuildDto，`Location` 指向新資源。

### PATCH /builds/{buildId}

任一欄位選填：`name`、`trimId`、`paintColorId`。換版本時，若原車漆不屬於新版本的世代會回 400。

### POST /builds/{buildId}/accessories

```json
{ "partCode": "windshield", "accessoryTypeId": 1, "assetId": 1,
  "position": { "p": [0.82, 1.21, 0.2], "n": [0.55, 0.83, 0] } }
```
```json
{ "partCode": "windshield", "customAccessoryName": "雨刷", "assetId": 1 }
```
- `accessoryTypeId`（內建配件，必須是這個車項可裝的配件）與 `customAccessoryName`（自訂配件，1–40 字）二擇一。
- 同一份配置清單內同名的自訂配件共用一筆。
- 同一車項已加過同一配件時回 409。回傳 201 與 AccessoryDto。

### PATCH /builds/{buildId}/accessories/{accessoryId}

任一欄位選填：`status`（`purchased`／`installed`，需先選定產品，否則回 400）、`note`、`position`、`assetId`。清除欄位傳 `"clear": ["status", "note", "position"]` 中的任意幾項。

### POST /builds/{buildId}/accessories/{accessoryId}/products

```json
{ "productId": 1, "select": true }
```
```json
{ "custom": { "brandName": "3M", "name": "極黑系列", "model": "BK-35", "suggestedPriceTwd": 15000, "rating": 4 }, "select": false }
```
- `productId`（內建產品，必須是這個「車項 × 配件」的適用產品）與 `custom`（自訂產品）二擇一。自訂配件只能加自訂產品。
- `custom`：`name` 必填（1–60 字）；品牌可用 `brandId` 選既有品牌，或用 `brandName` 直接輸入，二擇一或都不填；`rating` 1–5；`suggestedPriceTwd` ≥ 0。
- `select: true` 加入後直接選定。同一產品重複加入回 409。回傳 200 與更新後的 AccessoryDto。

### PATCH /builds/{buildId}/accessories/{accessoryId}/products/{candidateId}

```json
{ "isSelected": true }
```
- `true`：選定這筆，同配件的其他候選自動取消選定，狀態清空。
- `false`：取消選定，狀態清空。
- 回傳更新後的 AccessoryDto。

### DELETE /builds/{buildId}/accessories/{accessoryId}/products/{candidateId}

移除候選產品；若為自訂產品則一併刪除。移除的是選定產品時，狀態清空。回傳更新後的 AccessoryDto。

## 狀態碼

| 狀態碼 | 情境 |
|---|---|
| 200 | 讀取、修改成功 |
| 201 | 建立成功 |
| 204 | 刪除成功 |
| 400 | 驗證失敗（ProblemDetails + `errors`） |
| 404 | 版本、資源、配置清單、配件或候選產品不存在 |
| 409 | 同一車項重複加入同一配件，或同一配件重複加入同一產品 |
