#!/usr/bin/env bash
# API 冒煙測試：對執行中的後端走一遍主要流程（目錄 → 建立配置清單 → 配件 → 候選產品 → 選定 → 狀態）。
# 用法：API=http://localhost:8080 tools/smoke-test.sh
set -euo pipefail
API="${API:-http://localhost:8080}"
V="$API/api/v1"
pass=0

req() {   # req METHOD PATH [JSON]  → 回應內容存在 $j、狀態碼存在 $code（不可在 $(...) 子 shell 中呼叫）
  local m=$1 p=$2 body=${3:-}
  local out; out=$(mktemp)
  if [[ -n "$body" ]]; then
    code=$(curl -sS -o "$out" -w '%{http_code}' -X "$m" -H 'Content-Type: application/json' -d "$body" "$p")
  else
    code=$(curl -sS -o "$out" -w '%{http_code}' -X "$m" "$p")
  fi
  j=$(cat "$out"); rm -f "$out"
}
expect() {   # expect 描述 預期狀態碼 實際狀態碼 [jq 條件 JSON]
  local name=$1 want=$2 got=$3 cond=${4:-} json=${5:-}
  if [[ "$got" != "$want" ]]; then echo "✗ $name：預期 $want，實際 $got"; echo "$json" | head -c 2000; echo; exit 1; fi
  if [[ -n "$cond" ]] && ! echo "$json" | jq -e "$cond" >/dev/null; then
    echo "✗ $name：回應不符合 $cond"; echo "$json" | head -c 2000; echo; exit 1
  fi
  echo "✓ $name"; pass=$((pass + 1))
}

req GET "$API/health";                expect "健康檢查" 200 "$code" '.status == "ok"' "$j"
req GET "$V/catalog?market=TW";       expect "目錄有三個版本" 200 "$code" '[.makes[].models[].generations[].trims[]] | length == 3' "$j"
req GET "$V/trims/3";                 expect "Performance 規格與外觀" 200 "$code" '.styleVariant == "performance" and .specs.lengthMm == 4796 and (.tires | length == 2)' "$j"
req GET "$V/assets/1";                expect "模型資源" 200 "$code" '(.partMappings | length) > 30 and (.openings | length == 6) and .params.variants.standard != null' "$j"
req GET "$V/parts";                   expect "車項目錄 47 項" 200 "$code" 'length == 47' "$j"
parts=$j
type_id=$(echo "$parts" | jq '.[] | select(.code == "windshield") | .accessoryTypes[] | select(.name == "隔熱紙") | .id')
lx_id=$(echo "$parts"  | jq '.[] | select(.code == "windshield") | .accessoryTypes[] | select(.name == "隔熱紙") | .products[] | select(.name == "LX") | .id')
req GET "$V/brands";                  expect "品牌" 200 "$code" 'any(.[]; .code == "Solar Gard")' "$j"
req GET "$V/accessory-categories";    expect "配件分類" 200 "$code" 'length == 4' "$j"

req POST "$V/builds" '{"trimId":1}';  expect "建立配置清單" 201 "$code" '.trimId == 1' "$j"
build=$(echo "$j" | jq -r .id)
req POST "$V/builds/$build/accessories" "{\"partCode\":\"windshield\",\"accessoryTypeId\":$type_id,\"assetId\":1,\"position\":{\"p\":[0.8,1.2,0.2],\"n\":[0.5,0.8,0]}}"
expect "加入內建配件" 201 "$code" '.accessoryType.name == "隔熱紙" and .status == null' "$j"
acc=$(echo "$j" | jq -r .id)
req POST "$V/builds/$build/accessories" "{\"partCode\":\"windshield\",\"accessoryTypeId\":$type_id}"
expect "重複配件被拒絕" 409 "$code" '' "$j"
req POST "$V/builds/$build/accessories" '{"partCode":"underbody","customAccessoryName":"底盤裝甲"}'
expect "加入自訂配件" 201 "$code" '.accessoryType.isCustom == true' "$j"
custom_acc=$(echo "$j" | jq -r .id)

req POST "$V/builds/$build/accessories/$acc/products" "{\"productId\":$lx_id}"
expect "加入內建產品" 200 "$code" '(.products | length) == 1 and (.products[0].isSelected | not)' "$j"
lx_cand=$(echo "$j" | jq -r '.products[0].id')
req PATCH "$V/builds/$build/accessories/$acc" '{"status":"purchased"}'
expect "未選定不能設狀態" 400 "$code" '' "$j"
req POST "$V/builds/$build/accessories/$acc/products" '{"custom":{"brandName":"3M","name":"極黑系列","suggestedPriceTwd":15000,"rating":4},"select":true}'
expect "加入並選定自訂產品" 200 "$code" '(.products | length) == 2 and ([.products[] | select(.isSelected)] | length) == 1 and (.products[] | select(.isSelected) | .product.source) == "custom"' "$j"
req PATCH "$V/builds/$build/accessories/$acc" '{"status":"installed"}'
expect "選定後設為已安裝" 200 "$code" '.status == "installed"' "$j"
req PATCH "$V/builds/$build/accessories/$acc/products/$lx_cand" '{"isSelected":true}'
expect "改選 LX，狀態清空" 200 "$code" '.status == null and (.products[] | select(.isSelected) | .product.name) == "LX"' "$j"
req PATCH "$V/builds/$build/accessories/$acc/products/$lx_cand" '{"isSelected":false}'
expect "取消選定" 200 "$code" '[.products[] | select(.isSelected)] | length == 0' "$j"
req POST "$V/builds/$build/accessories/$custom_acc/products" "{\"productId\":$lx_id}"
expect "自訂配件不能加內建產品" 400 "$code" '' "$j"

req GET "$V/builds/$build";           expect "讀取配置清單" 200 "$code" '(.accessories | length) == 2' "$j"
req PATCH "$V/builds/$build" '{"trimId":3}'; expect "切換版本" 200 "$code" '.trimId == 3' "$j"
req DELETE "$V/builds/$build/accessories/$custom_acc"; expect "刪除配件" 204 "$code" '' "$j"
req DELETE "$V/builds/$build";        expect "刪除配置清單" 204 "$code" '' "$j"

echo "全部通過（$pass 項）"
