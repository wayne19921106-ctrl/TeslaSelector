-- =============================================================================
-- 3D 配件檢視器：初始 schema
-- 目標資料庫：Supabase Postgres 15+
--
-- 所有資料表放在獨立的 `viewer` schema。Supabase 的 Data API 預設只開放
-- `public` schema，放在這裡可以避免資料表被 anon key 直接存取；
-- 前端一律透過 .NET Web API 讀寫。
-- 另外仍對每張表啟用 RLS 且不建立 policy，就算之後誤把 schema 加進
-- Data API 的 exposed schemas，anon / authenticated 角色也讀不到資料。
-- =============================================================================

create extension if not exists pgcrypto;

create schema if not exists viewer;
set search_path = viewer, public;

-- 共用：自動更新 updated_at -------------------------------------------------
create or replace function viewer.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- =============================================================================
-- 車型目錄：品牌 → 車系 → 世代（改款） → 版本
-- =============================================================================

create table viewer.makes (
  id          smallint generated always as identity primary key,
  code        text not null unique,              -- 'tesla'
  name        text not null,                     -- 'Tesla'
  created_at  timestamptz not null default now()
);

create table viewer.vehicle_models (
  id          integer generated always as identity primary key,
  make_id     smallint not null references viewer.makes(id),
  code        text not null,                     -- 'model-y'
  name        text not null,                     -- 'Model Y'
  body_type   text not null,                     -- 'suv'
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  unique (make_id, code)
);

-- 世代 = 一次大改款，例如 Model Y 煥新版（Juniper，2025–）
create table viewer.generations (
  id           integer generated always as identity primary key,
  model_id     integer not null references viewer.vehicle_models(id),
  code         text not null,                    -- 'juniper'
  name         text not null,                    -- '煥新版'
  start_year   smallint not null,
  end_year     smallint,                         -- null = 仍在販售
  sort_order   integer not null default 0,
  created_at   timestamptz not null default now(),
  unique (model_id, code),
  check (end_year is null or end_year >= start_year)
);

-- 版本 = 某世代、某年式、某市場販售的車型等級
create table viewer.trims (
  id            integer generated always as identity primary key,
  generation_id integer not null references viewer.generations(id),
  model_year    smallint not null,               -- 2026
  market        text not null default 'TW',      -- ISO 3166-1 alpha-2
  code          text not null,                   -- 'rwd' / 'long-range-awd' / 'performance'
  name          text not null,                   -- '後輪驅動'
  drivetrain    text not null check (drivetrain in ('RWD', 'AWD')),
  sort_order    integer not null default 0,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  unique (generation_id, model_year, market, code)
);

-- 版本規格（1:1）。所有長度單位為 mm、重量 kg。
-- width_mm 為不含後照鏡車寬，建模用這個值。
create table viewer.trim_specs (
  trim_id                    integer primary key references viewer.trims(id) on delete cascade,
  length_mm                  integer not null check (length_mm > 0),
  width_mm                   integer not null check (width_mm > 0),
  width_mirrors_folded_mm    integer,
  width_mirrors_unfolded_mm  integer,
  height_mm                  integer not null check (height_mm > 0),
  wheelbase_mm               integer not null check (wheelbase_mm > 0),
  front_track_mm             integer not null check (front_track_mm > 0),
  rear_track_mm              integer not null check (rear_track_mm > 0),
  ground_clearance_mm        integer not null check (ground_clearance_mm > 0),
  curb_weight_kg             integer,
  -- 每個欄位的資料來源與查核狀態：
  -- [{ "fields": ["length_mm", ...], "title": "...", "url": "...",
  --    "retrieved_at": "2026-11-04", "verified": false }]
  sources                    jsonb not null default '[]'::jsonb,
  verified_at                timestamptz,      -- 全部欄位與官網核對完成的時間
  updated_at                 timestamptz not null default now(),
  check (wheelbase_mm < length_mm),
  check (ground_clearance_mm < height_mm),
  check (jsonb_typeof(sources) = 'array')
);
create trigger trim_specs_touch before update on viewer.trim_specs
  for each row execute function viewer.touch_updated_at();

-- 輪胎與輪框規格，前後軸各一筆
create table viewer.tire_specs (
  trim_id          integer not null references viewer.trims(id) on delete cascade,
  axle             text not null check (axle in ('front', 'rear')),
  width_mm         smallint not null check (width_mm between 135 and 395),
  aspect_ratio     smallint not null check (aspect_ratio between 20 and 90),
  rim_diameter_in  smallint not null check (rim_diameter_in between 13 and 24),
  rim_width_in     numeric(3,1),
  rim_offset_mm    smallint,
  primary key (trim_id, axle)
);

-- 世代可選車漆
create table viewer.paint_colors (
  id             integer generated always as identity primary key,
  generation_id  integer not null references viewer.generations(id),
  code           text not null,                  -- 'pearl-white'
  name           text not null,                  -- '珍珠白'
  hex            char(7) not null check (hex ~ '^#[0-9a-fA-F]{6}$'),
  metalness      numeric(3,2) not null default 0.3 check (metalness between 0 and 1),
  roughness      numeric(3,2) not null default 0.3 check (roughness between 0 and 1),
  sort_order     integer not null default 0,
  is_active      boolean not null default true,
  unique (generation_id, code)
);

-- =============================================================================
-- 3D 模型資源
--   parametric：前端依 generator + params + 版本規格即時生成（免費）
--   gltf      ：精細 .glb 檔，放在 Supabase Storage（未來付費）
-- =============================================================================

create table viewer.model_assets (
  id             integer generated always as identity primary key,
  generation_id  integer not null references viewer.generations(id),
  trim_id        integer references viewer.trims(id),  -- null = 套用到整個世代
  code           text not null unique,
  name           text not null,
  asset_type     text not null check (asset_type in ('parametric', 'gltf')),
  tier           text not null default 'free' check (tier in ('free', 'premium')),
  version        integer not null default 1,
  generator      text,                           -- parametric：前端產生器識別碼
  params         jsonb not null default '{}'::jsonb,
  storage_bucket text,                           -- gltf：Supabase Storage bucket
  storage_path   text,                           -- gltf：物件路徑
  file_size_bytes bigint,
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  check (asset_type <> 'parametric' or generator is not null),
  check (asset_type <> 'gltf' or (storage_bucket is not null and storage_path is not null)),
  check (jsonb_typeof(params) = 'object')
);
create index model_assets_generation_idx on viewer.model_assets (generation_id) where is_active;
create trigger model_assets_touch before update on viewer.model_assets
  for each row execute function viewer.touch_updated_at();

-- 部位目錄（跨車型共用），例如 fdoor-L 左前車門
create table viewer.parts (
  id          integer generated always as identity primary key,
  code        text not null unique,
  name        text not null,
  category    text not null,                     -- '車身鈑件' / '玻璃與車頂' / '車內' ...
  kind        text not null,                     -- 建議配件分組：'door' / 'wheel' ...
  sort_order  integer not null default 0
);
create index parts_kind_idx on viewer.parts (kind);

-- 部位的建議配件
create table viewer.part_suggestions (
  id          integer generated always as identity primary key,
  part_kind   text not null,
  name        text not null,
  sort_order  integer not null default 0,
  unique (part_kind, name)
);

-- 模型資源中，部位如何被辨識：
--   zone：參數化模型用座標範圍（參考座標系）辨識，zone = {"surface":"body|glass","min":[x,y,z],"max":[x,y,z]}
--   mesh：以模型內的物件 key 辨識（參數化模型的獨立零件，或 .glb 的節點名稱）
create table viewer.asset_part_mappings (
  id            integer generated always as identity primary key,
  asset_id      integer not null references viewer.model_assets(id) on delete cascade,
  part_id       integer not null references viewer.parts(id),
  mapping_type  text not null check (mapping_type in ('zone', 'mesh')),
  zone          jsonb,
  mesh_key      text,
  priority      integer not null default 0,     -- zone 重疊時，數字小的先比對
  check ((mapping_type = 'zone' and zone is not null and mesh_key is null)
      or (mapping_type = 'mesh' and mesh_key is not null and zone is null))
);
create unique index asset_part_mappings_zone_uq on viewer.asset_part_mappings (asset_id, part_id) where mapping_type = 'zone';
create unique index asset_part_mappings_mesh_uq on viewer.asset_part_mappings (asset_id, mesh_key) where mapping_type = 'mesh';

-- 可開啟件（車門、前廂蓋、尾門）與鉸鏈，座標皆為參考座標系
create table viewer.asset_openings (
  id                 integer generated always as identity primary key,
  asset_id           integer not null references viewer.model_assets(id) on delete cascade,
  code               text not null,              -- 'fdL'
  name               text not null,              -- '左前門'
  hinge              jsonb not null,             -- [x,y,z]
  axis               char(1) not null check (axis in ('x', 'y', 'z')),
  open_angle_deg     numeric(5,1) not null check (open_angle_deg between -180 and 180),
  body_region        jsonb,                      -- {"min":[...],"max":[...]}；gltf 可為 null
  glass_region       jsonb,
  mesh_keys          text[] not null default '{}', -- 隨此開啟件移動的獨立零件，例如後照鏡
  sort_order         integer not null default 0,
  unique (asset_id, code)
);

-- =============================================================================
-- 使用者資料：配置清單與配件標註
-- 第一階段尚未接 Supabase Auth；owner_id 預留給 auth.users(id)。
-- =============================================================================

create table viewer.builds (
  id              uuid primary key default gen_random_uuid(),
  owner_id        uuid,                          -- 之後接 auth.users(id)
  name            text not null default '我的 Model Y' check (char_length(name) between 1 and 60),
  trim_id         integer not null references viewer.trims(id),
  paint_color_id  integer references viewer.paint_colors(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index builds_owner_idx on viewer.builds (owner_id);
create trigger builds_touch before update on viewer.builds
  for each row execute function viewer.touch_updated_at();

-- 標註位置存在模型資源的「參考座標系」，切換版本時同一部位的標註仍落在正確位置
create table viewer.build_accessories (
  id           uuid primary key default gen_random_uuid(),
  build_id     uuid not null references viewer.builds(id) on delete cascade,
  part_id      integer not null references viewer.parts(id),
  asset_id     integer references viewer.model_assets(id),  -- position 所屬座標系
  name         text not null check (char_length(name) between 1 and 40),
  status       text not null default 'considering'
                 check (status in ('considering', 'planned', 'purchased', 'installed')),
  price_twd    integer check (price_twd >= 0),
  note         text check (char_length(note) <= 500),
  position     jsonb,                            -- {"p":[x,y,z],"n":[x,y,z]}
  is_example   boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index build_accessories_build_idx on viewer.build_accessories (build_id, created_at);
create trigger build_accessories_touch before update on viewer.build_accessories
  for each row execute function viewer.touch_updated_at();

-- =============================================================================
-- RLS：全部啟用、不建立 policy（只有 .NET API 使用的 postgres 角色可存取）
-- =============================================================================
do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'viewer' loop
    execute format('alter table viewer.%I enable row level security', t.tablename);
  end loop;
end $$;

revoke all on schema viewer from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on schema viewer from anon, authenticated';
  end if;
end $$;
