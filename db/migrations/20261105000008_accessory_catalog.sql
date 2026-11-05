-- =============================================================================
-- 配件三層結構：車項 → 配件 → 產品，配件另有分類（外觀／內裝／安全／操控）
--
--   parts                    車項（依使用者定義的清單重整，共 47 項）
--   accessory_categories     配件分類
--   accessory_types          配件名稱，例如隔熱紙、玻璃鍍膜；分類待對應前為 null
--   part_accessory_types     車項可裝哪些配件（多對多）
--   products                 產品，例如舒熱佳 LX
--   part_accessory_products  某車項的某配件有哪些適用產品（同一產品可用於多個車項）
--   build_accessories        配置清單的每筆配件加記配件與產品
--
-- 舊的 part_suggestions（依部位類型的建議配件）與 parts.kind 移除。
-- =============================================================================
set search_path = viewer, public;

-- 配件分類 ---------------------------------------------------------------------
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

-- 配件 -------------------------------------------------------------------------
create table viewer.accessory_types (
  id           integer generated always as identity primary key,
  name         text not null unique check (char_length(name) between 1 and 40),
  category_id  smallint references viewer.accessory_categories(id),
  sort_order   integer not null default 0,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index accessory_types_category_idx on viewer.accessory_types (category_id);
create trigger accessory_types_touch before update on viewer.accessory_types
  for each row execute function viewer.touch_updated_at();

-- 車項可裝配件 -----------------------------------------------------------------
create table viewer.part_accessory_types (
  id                 integer generated always as identity primary key,
  part_id            integer not null references viewer.parts(id) on delete cascade,
  accessory_type_id  integer not null references viewer.accessory_types(id) on delete cascade,
  sort_order         integer not null default 0,
  unique (part_id, accessory_type_id)
);
create index part_accessory_types_type_idx on viewer.part_accessory_types (accessory_type_id);

-- 產品 -------------------------------------------------------------------------
create table viewer.products (
  id           integer generated always as identity primary key,
  brand        text not null check (char_length(brand) between 1 and 40),
  name         text not null check (char_length(name) between 1 and 60),
  description  text check (char_length(description) <= 500),
  price_twd    integer check (price_twd >= 0),
  url          text check (url ~ '^https?://'),
  sort_order   integer not null default 0,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (brand, name)
);
create trigger products_touch before update on viewer.products
  for each row execute function viewer.touch_updated_at();

-- 車項 × 配件 的適用產品 --------------------------------------------------------
create table viewer.part_accessory_products (
  part_accessory_type_id  integer not null references viewer.part_accessory_types(id) on delete cascade,
  product_id              integer not null references viewer.products(id) on delete cascade,
  sort_order              integer not null default 0,
  primary key (part_accessory_type_id, product_id)
);
create index part_accessory_products_product_idx on viewer.part_accessory_products (product_id);

-- 配置清單加記配件與產品（name 保留：自訂名稱，或由產品／配件名稱帶入）---------
alter table viewer.build_accessories
  add column accessory_type_id integer references viewer.accessory_types(id) on delete set null,
  add column product_id        integer references viewer.products(id) on delete set null;

-- =============================================================================
-- 車項重整
-- =============================================================================
drop table viewer.part_suggestions;
alter table viewer.parts drop column kind;

-- 同一車項可對應多個座標範圍（例如車身玻璃 = 左右側窗）
drop index viewer.asset_part_mappings_zone_uq;

-- 新車項
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

-- 範例資料（使用者提供）：前擋 > 隔熱紙 > 舒熱佳 LX／XE、前擋 > 玻璃鍍膜 > K-WAX GC-300 --
insert into viewer.accessory_types (name, sort_order) values ('隔熱紙', 10), ('玻璃鍍膜', 20);

insert into viewer.products (brand, name, sort_order) values
  ('舒熱佳', 'LX', 10),
  ('舒熱佳', 'XE', 20),
  ('K-WAX',  'GC-300 氟素玻璃鍍膜', 30);

insert into viewer.part_accessory_types (part_id, accessory_type_id, sort_order)
select p.id, t.id, t.sort_order
from viewer.parts p
join viewer.accessory_types t on t.name in ('隔熱紙', '玻璃鍍膜')
where p.code = 'windshield';

insert into viewer.part_accessory_products (part_accessory_type_id, product_id, sort_order)
select pat.id, pr.id, pr.sort_order
from viewer.part_accessory_types pat
join viewer.parts p on p.id = pat.part_id and p.code = 'windshield'
join viewer.accessory_types t on t.id = pat.accessory_type_id
join (values ('隔熱紙', '舒熱佳', 'LX'), ('隔熱紙', '舒熱佳', 'XE'),
             ('玻璃鍍膜', 'K-WAX', 'GC-300 氟素玻璃鍍膜')) as v(type_name, brand, name)
  on v.type_name = t.name
join viewer.products pr on pr.brand = v.brand and pr.name = v.name;

-- 安全設定：與 viewer 其他資料表一致 -------------------------------------------
alter table viewer.accessory_categories     enable row level security;
alter table viewer.accessory_types          enable row level security;
alter table viewer.part_accessory_types     enable row level security;
alter table viewer.products                 enable row level security;
alter table viewer.part_accessory_products  enable row level security;
