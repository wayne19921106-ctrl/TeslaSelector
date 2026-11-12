#!/usr/bin/env bash
# 依序套用 db/ 的 migration 與 seed 到一個「空的」PostgreSQL 資料庫（測試用）。
# 用法：DATABASE_URL=postgres://user:pass@host:5432/db tools/apply-migrations.sh [--with-stubs]
#   --with-stubs  先建立 Supabase 物件替身（db/test/supabase-stubs.sql），一般 PostgreSQL 需要加
set -euo pipefail
cd "$(dirname "$0")/.."
: "${DATABASE_URL:?請設定 DATABASE_URL}"

run() { echo "== $1"; psql "$DATABASE_URL" -q -v ON_ERROR_STOP=1 -f "$1"; }

[[ "${1:-}" == "--with-stubs" ]] && run db/test/supabase-stubs.sql

# seed 0002 必須緊接在 0001 之後（0003 起的 migration 依賴它的資料）
for f in $(ls db/migrations/*.sql db/seed/*.sql | sort -t/ -k3); do
  run "$f"
done
echo "完成"
