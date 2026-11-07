-- =============================================================================
-- 配件目錄與配置清單：車項 → 配件 → 產品
--
-- 目錄（內建）
--   parts                    車項（依使用者定義的清單重整，共 47 項）
--   accessory_categories     配件分類：外觀、內裝、安全、操控
--   accessory_types          配件，例如隔熱紙；source = builtin（內建）或 custom（使用者自訂）
--   part_accessory_types     車項可裝哪些內建配件
--   brands                   品牌：序號、品牌（英文，唯一）、名稱、Logo、推廣碼、介紹、網址
--   products                 產品：品牌、配件、名稱、型號、建議售價、推薦指數；source = builtin / custom
--   part_accessory_products  某車項的某配件有哪些內建產品可選
--
-- 配置清單（使用者資料）
--   build_accessories          某車項下加了哪個配件（內建或自訂），每個車項 × 配件一筆
--   build_accessory_products   配件底下的候選產品（可多筆），最多一筆 is_selected
--   build_accessories.status   只在有選定產品時可設：purchased（已購買）／installed（已安裝）；
--                              null 表示尚未購買。取消選定時自動清空。
--
-- 自訂配件與自訂產品屬於某一份配置清單（owner_build_id），接上會員登入後可改歸屬會員（owner_member_id）。
-- 舊的 part_suggestions（依部位類型的建議配件）與 parts.kind 移除。
-- =============================================================================
set search_path = viewer, public;

-- =============================================================================
-- 車項重整
-- =============================================================================
drop table viewer.part_suggestions;
alter table viewer.parts drop column kind;

-- 同一車項可對應多個座標範圍（例如車身玻璃 = 左右側窗）
drop index viewer.asset_part_mappings_zone_uq;

insert into viewer.parts (code, name, category, sort_order) values
  ('tire',           '輪胎',             '輪胎與輪框', 0),
  ('rim',            '輪框',             '輪胎與輪框', 0),
  ('aero-cover',     '節能蓋',           '輪胎與輪框', 0),
  ('side-glass',     '車身玻璃',         '玻璃與車頂', 0),
  ('roof-top',       '車頂',             '玻璃與車頂', 0),
  ('mirror',         '後照鏡',           '車門與後照鏡', 0),
  ('handle-FL',      '前左門把',         '車門與後照鏡', 0),
  ('handle-FR',      '前右門把',         '車門與後照鏡', 0),
  ('handle-RL',      '後左門把',         '車門與後照鏡', 0),
  ('handle-RR',      '後右門把',         '車門與後照鏡', 0),
  ('charge-port',    '充電口',           '外觀鈑件', 0),
  ('front-seatback', '前排椅背墊',       '車內', 0),
  ('rear-seatback',  '後排椅背墊',       '車內', 0),
  ('rear-screen',    '後螢幕',           '車內', 0),
  ('sill',           '門檻',             '車內', 0),
  ('trunk-pocket-L', '後行李箱左邊兜',   '行李箱', 0),
  ('trunk-pocket-R', '後行李箱右邊兜',   '行李箱', 0),
  ('underbody',      '底盤',             '其他', 0);

-- 左右側窗合併為車身玻璃
update viewer.asset_part_mappings
set part_id = (select id from viewer.parts where code = 'side-glass')
where part_id in (select id from viewer.parts where code in ('sidewin-L', 'sidewin-R'));

-- 舊車項上的配置清單資料改掛到新車項
update viewer.build_accessories a
set part_id = (select id from viewer.parts where code = v.new_code)
from (values ('wheel-FL', 'rim'), ('wheel-FR', 'rim'), ('wheel-RL', 'rim'), ('wheel-RR', 'rim'),
             ('mirror-L', 'mirror'), ('mirror-R', 'mirror'),
             ('sidewin-L', 'side-glass'), ('sidewin-R', 'side-glass')) as v(old_code, new_code)
where a.part_id = (select id from viewer.parts where code = v.old_code);

-- 獨立零件對應全部重建（輪胎／輪框／節能蓋拆分、後照鏡不分左右、新增門把等）
delete from viewer.asset_part_mappings
where mapping_type = 'mesh'
  and asset_id = (select id from viewer.model_assets where code = 'modely-juniper-parametric');

delete from viewer.parts
where code in ('wheel-FL', 'wheel-FR', 'wheel-RL', 'wheel-RR', 'mirror-L', 'mirror-R', 'sidewin-L', 'sidewin-R');

insert into viewer.asset_part_mappings (asset_id, part_id, mapping_type, mesh_key)
select a.id, p.id, 'mesh', v.mesh_key
from viewer.model_assets a
cross join (values
  ('tire', 'tire'), ('rim', 'rim'), ('aero-cover', 'aero-cover'),
  ('mirror-L', 'mirror'), ('mirror-R', 'mirror'),
  ('handle-FL', 'handle-FL'), ('handle-FR', 'handle-FR'), ('handle-RL', 'handle-RL'), ('handle-RR', 'handle-RR'),
  ('charge-port', 'charge-port'),
  ('lights-front', 'lights-front'), ('lights-rear', 'lights-rear'),
  ('seat-front', 'seat-front'), ('front-seatback', 'front-seatback'),
  ('seat-rear', 'seat-rear'), ('rear-seatback', 'rear-seatback'),
  ('screen', 'screen'), ('rear-screen', 'rear-screen'),
  ('steer', 'steer'), ('dash', 'dash'), ('console', 'console'), ('floor', 'floor'),
  ('frunk-tub', 'frunk-tub'), ('trunk', 'trunk'),
  ('trunk-pocket-L', 'trunk-pocket-L'), ('trunk-pocket-R', 'trunk-pocket-R')
) as v(mesh_key, part_code)
join viewer.parts p on p.code = v.part_code
where a.code = 'modely-juniper-parametric';

-- 門把隨車門開啟
update viewer.asset_openings o
set mesh_keys = v.keys::text[]
from (values ('fdL', '{mirror-L,handle-FL}'), ('fdR', '{mirror-R,handle-FR}'),
             ('rdL', '{handle-RL}'),          ('rdR', '{handle-RR}')) as v(code, keys)
where o.code = v.code
  and o.asset_id = (select id from viewer.model_assets where code = 'modely-juniper-parametric');

-- 門把與充電口的位置參數（參考座標系；前端以射線貼合車身側面）
update viewer.model_assets
set params = params || $json${
  "fixtures": {
    "door_handles": { "front_x": 0.22, "rear_x": -0.80, "y": 0.90, "length": 0.17 },
    "charge_port":  { "x": -1.98, "y": 0.80, "side": -1, "size": [0.13, 0.10] }
  }
}$json$::jsonb,
    version = version + 1
where code = 'modely-juniper-parametric';

-- 全部車項的名稱、群組與排序（依使用者清單的命名方式：前／後 + 左／右）
update viewer.parts p
set name = v.name, category = v.category, sort_order = v.sort_order
from (values
  ('front-bumper',   '前保桿',           '外觀鈑件',     10),
  ('rear-bumper',    '後保桿',           '外觀鈑件',     20),
  ('frunk',          '前廂蓋',           '外觀鈑件',     30),
  ('tailgate',       '尾門',             '外觀鈑件',     40),
  ('ffender-L',      '前左葉子板',       '外觀鈑件',     50),
  ('ffender-R',      '前右葉子板',       '外觀鈑件',     51),
  ('rfender-L',      '後左葉子板',       '外觀鈑件',     52),
  ('rfender-R',      '後右葉子板',       '外觀鈑件',     53),
  ('skirt-L',        '左側裙',           '外觀鈑件',     60),
  ('skirt-R',        '右側裙',           '外觀鈑件',     61),
  ('charge-port',    '充電口',           '外觀鈑件',     70),
  ('body',           '車身（全車）',     '外觀鈑件',     90),
  ('fdoor-L',        '前左車門',         '車門與後照鏡', 100),
  ('handle-FL',      '前左門把',         '車門與後照鏡', 101),
  ('fdoor-R',        '前右車門',         '車門與後照鏡', 102),
  ('handle-FR',      '前右門把',         '車門與後照鏡', 103),
  ('rdoor-L',        '後左車門',         '車門與後照鏡', 104),
  ('handle-RL',      '後左門把',         '車門與後照鏡', 105),
  ('rdoor-R',        '後右車門',         '車門與後照鏡', 106),
  ('handle-RR',      '後右門把',         '車門與後照鏡', 107),
  ('mirror',         '後照鏡',           '車門與後照鏡', 110),
  ('windshield',     '前擋玻璃',         '玻璃與車頂',   200),
  ('side-glass',     '車身玻璃',         '玻璃與車頂',   210),
  ('rearglass',      '後檔玻璃',         '玻璃與車頂',   220),
  ('roof',           '全景天窗',         '玻璃與車頂',   230),
  ('roof-top',       '車頂',             '玻璃與車頂',   240),
  ('tire',           '輪胎',             '輪胎與輪框',   300),
  ('rim',            '輪框',             '輪胎與輪框',   310),
  ('aero-cover',     '節能蓋',           '輪胎與輪框',   320),
  ('lights-front',   '前燈條／頭燈',     '燈具',         400),
  ('lights-rear',    '尾燈',             '燈具',         410),
  ('screen',         '前螢幕',           '車內',         500),
  ('rear-screen',    '後螢幕',           '車內',         510),
  ('steer',          '方向盤',           '車內',         520),
  ('dash',           '儀表台',           '車內',         530),
  ('console',        '中控扶手箱',       '車內',         540),
  ('seat-front',     '前座椅',           '車內',         550),
  ('front-seatback', '前排椅背墊',       '車內',         560),
  ('seat-rear',      '後座椅',           '車內',         570),
  ('rear-seatback',  '後排椅背墊',       '車內',         580),
  ('floor',          '全車地板',         '車內',         590),
  ('sill',           '門檻',             '車內',         600),
  ('frunk-tub',      '前行李箱',         '行李箱',       700),
  ('trunk',          '後行李箱',         '行李箱',       710),
  ('trunk-pocket-L', '後行李箱左邊兜',   '行李箱',       720),
  ('trunk-pocket-R', '後行李箱右邊兜',   '行李箱',       730),
  ('underbody',      '底盤',             '其他',         800)
) as v(code, name, category, sort_order)
where p.code = v.code;

-- =============================================================================
-- 配件目錄
-- =============================================================================
create table viewer.accessory_categories (
  id          smallint generated always as identity primary key,
  code        text not null unique,
  name        text not null,
  sort_order  integer not null default 0
);
insert into viewer.accessory_categories (code, name, sort_order) values
  ('exterior', '外觀', 10),
  ('interior', '內裝', 20),
  ('safety',   '安全', 30),
  ('handling', '操控', 40);

-- 配件：內建配件由後台維護；自訂配件屬於某份配置清單（之後可改歸屬會員）
create table viewer.accessory_types (
  id               integer generated always as identity primary key,
  name             text not null check (char_length(name) between 1 and 40),
  category_id      smallint references viewer.accessory_categories(id),
  source           text not null default 'builtin' check (source in ('builtin', 'custom')),
  owner_build_id   uuid references viewer.builds(id) on delete cascade,
  owner_member_id  uuid references member.member_profiles(id) on delete cascade,
  sort_order       integer not null default 0,
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check ((source = 'builtin' and owner_build_id is null and owner_member_id is null)
      or (source = 'custom' and (owner_build_id is not null or owner_member_id is not null)))
);
create unique index accessory_types_builtin_name_uq on viewer.accessory_types (name) where source = 'builtin';
create index accessory_types_owner_build_idx on viewer.accessory_types (owner_build_id) where owner_build_id is not null;
create index accessory_types_category_idx on viewer.accessory_types (category_id);
create trigger accessory_types_touch before update on viewer.accessory_types
  for each row execute function viewer.touch_updated_at();

-- 車項可裝的內建配件
create table viewer.part_accessory_types (
  id                 integer generated always as identity primary key,
  part_id            integer not null references viewer.parts(id) on delete cascade,
  accessory_type_id  integer not null references viewer.accessory_types(id) on delete cascade,
  sort_order         integer not null default 0,
  unique (part_id, accessory_type_id)
);
create index part_accessory_types_type_idx on viewer.part_accessory_types (accessory_type_id);

-- 品牌 -------------------------------------------------------------------------
create table viewer.brands (
  id           integer generated always as identity primary key,              -- 序號
  code         text not null check (char_length(code) between 1 and 60
                                    and code ~ '^[A-Za-z0-9]'),              -- 品牌（英文），唯一
  name         text not null check (char_length(name) between 1 and 60),     -- 名稱
  logo_url     text,                                                         -- Logo（網址或 Storage 路徑）
  promo_code   text check (char_length(promo_code) <= 60),                   -- 推廣碼
  description  text check (char_length(description) <= 2000),               -- 品牌介紹
  url          text check (url ~ '^https?://'),                              -- 網址
  sort_order   integer not null default 0,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create unique index brands_code_uq on viewer.brands (lower(code));
create trigger brands_touch before update on viewer.brands
  for each row execute function viewer.touch_updated_at();

-- 產品 -------------------------------------------------------------------------
-- 內建產品必須有品牌；自訂產品可選既有品牌（brand_id）或直接輸入品牌文字（brand_name）
create table viewer.products (
  id                   integer generated always as identity primary key,
  accessory_type_id    integer not null references viewer.accessory_types(id) on delete cascade,
  brand_id             integer references viewer.brands(id),
  brand_name           text check (char_length(brand_name) <= 60),
  name                 text not null check (char_length(name) between 1 and 60),   -- 名稱
  model                text check (char_length(model) <= 60),                      -- 型號
  suggested_price_twd  integer check (suggested_price_twd >= 0),                   -- 建議售價
  rating               smallint check (rating between 1 and 5),                    -- 推薦指數
  description          text check (char_length(description) <= 1000),
  url                  text check (url ~ '^https?://'),
  source               text not null default 'builtin' check (source in ('builtin', 'custom')),
  owner_build_id       uuid references viewer.builds(id) on delete cascade,
  owner_member_id      uuid references member.member_profiles(id) on delete cascade,
  sort_order           integer not null default 0,
  is_active            boolean not null default true,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  check ((source = 'builtin' and brand_id is not null and brand_name is null
          and owner_build_id is null and owner_member_id is null)
      or (source = 'custom' and (owner_build_id is not null or owner_member_id is not null)))
);
create unique index products_builtin_uq on viewer.products (brand_id, accessory_type_id, name, coalesce(model, ''))
  where source = 'builtin';
create index products_type_idx on viewer.products (accessory_type_id);
create index products_brand_idx on viewer.products (brand_id);
create index products_owner_build_idx on viewer.products (owner_build_id) where owner_build_id is not null;
create trigger products_touch before update on viewer.products
  for each row execute function viewer.touch_updated_at();

-- 某車項的某配件可選的內建產品
create table viewer.part_accessory_products (
  part_accessory_type_id  integer not null references viewer.part_accessory_types(id) on delete cascade,
  product_id              integer not null references viewer.products(id) on delete cascade,
  sort_order              integer not null default 0,
  primary key (part_accessory_type_id, product_id)
);
create index part_accessory_products_product_idx on viewer.part_accessory_products (product_id);

-- 產品的配件必須與「車項 × 配件」一致，且只能是內建產品
create or replace function viewer.check_part_accessory_product()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not exists (
    select 1 from viewer.part_accessory_types pat
    join viewer.products p on p.id = new.product_id
    where pat.id = new.part_accessory_type_id
      and p.accessory_type_id = pat.accessory_type_id
      and p.source = 'builtin') then
    raise exception '產品的配件與車項配件不一致，或不是內建產品';
  end if;
  return new;
end $$;
create trigger part_accessory_products_check before insert or update on viewer.part_accessory_products
  for each row execute function viewer.check_part_accessory_product();

-- =============================================================================
-- 配置清單
-- =============================================================================
-- 既有配件改為「車項 × 配件」：名稱轉為自訂配件，價格移到產品，狀態只保留已購買／已安裝
alter table viewer.build_accessories
  add column accessory_type_id integer references viewer.accessory_types(id);

insert into viewer.accessory_types (name, source, owner_build_id)
select distinct left(a.name, 40), 'custom', a.build_id from viewer.build_accessories a;

update viewer.build_accessories a
set accessory_type_id = t.id
from viewer.accessory_types t
where t.source = 'custom' and t.owner_build_id = a.build_id and t.name = left(a.name, 40);

-- 同一車項同一配件只保留最早的一筆
delete from viewer.build_accessories a
using viewer.build_accessories b
where a.build_id = b.build_id and a.part_id = b.part_id and a.accessory_type_id = b.accessory_type_id
  and (a.created_at, a.id) > (b.created_at, b.id);

alter table viewer.build_accessories
  alter column accessory_type_id set not null,
  drop constraint build_accessories_status_check,
  alter column status drop not null,
  alter column status drop default,
  drop column name,
  drop column price_twd,
  add constraint build_accessories_unique_part_type unique (build_id, part_id, accessory_type_id);
update viewer.build_accessories set status = null;   -- 尚無選定產品
alter table viewer.build_accessories
  add constraint build_accessories_status_check check (status in ('purchased', 'installed'));

comment on column viewer.build_accessories.status is
  '選定產品後的狀態：purchased（已購買）／installed（已安裝）；null = 尚未購買或尚未選定產品';

-- 候選產品：同一配件可放多筆，最多一筆選定
create table viewer.build_accessory_products (
  id                  uuid primary key default gen_random_uuid(),
  build_accessory_id  uuid not null references viewer.build_accessories(id) on delete cascade,
  product_id          integer not null references viewer.products(id),
  is_selected         boolean not null default false,
  created_at          timestamptz not null default now(),
  unique (build_accessory_id, product_id)
);
create unique index build_accessory_products_one_selected
  on viewer.build_accessory_products (build_accessory_id) where is_selected;
create index build_accessory_products_product_idx on viewer.build_accessory_products (product_id);

-- 候選產品的配件要與配置清單的配件相同；自訂產品只能用在自己的配置清單
create or replace function viewer.check_build_accessory_product()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_type integer; v_build uuid;
  p record;
begin
  select accessory_type_id, build_id into v_type, v_build
  from viewer.build_accessories where id = new.build_accessory_id;
  select accessory_type_id, source, owner_build_id into p from viewer.products where id = new.product_id;
  if p.accessory_type_id is distinct from v_type then
    raise exception '產品的配件與配置清單的配件不一致';
  end if;
  if p.source = 'custom' and p.owner_build_id is distinct from v_build then
    raise exception '自訂產品只能用在建立它的配置清單';
  end if;
  return new;
end $$;
create trigger build_accessory_products_check before insert or update of product_id, build_accessory_id
  on viewer.build_accessory_products
  for each row execute function viewer.check_build_accessory_product();

-- 沒有選定產品時清空狀態
create or replace function viewer.clear_status_without_selection()
returns trigger language plpgsql set search_path = '' as $$
begin
  update viewer.build_accessories a
  set status = null
  where a.id = old.build_accessory_id
    and a.status is not null
    and not exists (select 1 from viewer.build_accessory_products x
                    where x.build_accessory_id = a.id and x.is_selected);
  return null;
end $$;
create trigger build_accessory_products_clear_status after update or delete on viewer.build_accessory_products
  for each row execute function viewer.clear_status_without_selection();

-- 有選定產品才能設定狀態
create or replace function viewer.require_selection_for_status()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.status is not null and not exists (
       select 1 from viewer.build_accessory_products x
       where x.build_accessory_id = new.id and x.is_selected) then
    raise exception '選定產品後才能設定已購買或已安裝';
  end if;
  return new;
end $$;
create trigger build_accessories_require_selection before insert or update of status on viewer.build_accessories
  for each row execute function viewer.require_selection_for_status();

-- =============================================================================
-- 範例資料（使用者提供）
--   前擋玻璃 > 隔熱紙 > 舒熱佳 LX、XE；前擋玻璃 > 玻璃鍍膜 > K-WAX GC-300 氟素玻璃鍍膜
--   型號、建議售價、推薦指數待補；Solar Gard 為舒熱佳英文品牌名，待確認
-- =============================================================================
insert into viewer.brands (code, name, sort_order) values
  ('Solar Gard', '舒熱佳', 10),
  ('K-WAX',      'K-WAX',  20);

insert into viewer.accessory_types (name, sort_order) values ('隔熱紙', 10), ('玻璃鍍膜', 20);

insert into viewer.products (accessory_type_id, brand_id, name, model, sort_order)
select t.id, b.id, v.name, v.model, v.sort_order
from (values
  ('隔熱紙',   'Solar Gard', 'LX',           null,     10),
  ('隔熱紙',   'Solar Gard', 'XE',           null,     20),
  ('玻璃鍍膜', 'K-WAX',      '氟素玻璃鍍膜', 'GC-300', 30)
) as v(type_name, brand_code, name, model, sort_order)
join viewer.accessory_types t on t.name = v.type_name and t.source = 'builtin'
join viewer.brands b on lower(b.code) = lower(v.brand_code);

insert into viewer.part_accessory_types (part_id, accessory_type_id, sort_order)
select p.id, t.id, t.sort_order
from viewer.parts p
join viewer.accessory_types t on t.name in ('隔熱紙', '玻璃鍍膜') and t.source = 'builtin'
where p.code = 'windshield';

insert into viewer.part_accessory_products (part_accessory_type_id, product_id, sort_order)
select pat.id, pr.id, pr.sort_order
from viewer.part_accessory_types pat
join viewer.parts p on p.id = pat.part_id and p.code = 'windshield'
join viewer.products pr on pr.accessory_type_id = pat.accessory_type_id and pr.source = 'builtin';

-- 安全設定：與 viewer 其他資料表一致 -------------------------------------------
alter table viewer.accessory_categories     enable row level security;
alter table viewer.accessory_types          enable row level security;
alter table viewer.part_accessory_types     enable row level security;
alter table viewer.brands                   enable row level security;
alter table viewer.products                 enable row level security;
alter table viewer.part_accessory_products  enable row level security;
alter table viewer.build_accessory_products enable row level security;
