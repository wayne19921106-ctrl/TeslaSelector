-- =============================================================================
-- Seed：Tesla Model Y 煥新版（Juniper）2026 年式，台灣市場三個版本
--
-- 規格來源（2026-11-04 擷取，尚未與 Tesla 官網逐項核對，verified=false）：
--   U-CAR       車長、收折後照鏡車寬、車高、軸距、輪胎、車重
--   EVSpecifications（歐規）不含後照鏡車寬、展開後照鏡車寬、輪距、離地高、輪框寬度與偏距
-- 核對官網後請更新 trim_specs.sources 的 verified 與 verified_at。
-- =============================================================================
set search_path = viewer, public;

begin;

-- 品牌／車系／世代 ------------------------------------------------------------
insert into makes (code, name) values ('tesla', 'Tesla');

insert into vehicle_models (make_id, code, name, body_type, sort_order)
select id, 'model-y', 'Model Y', 'suv', 20 from makes where code = 'tesla';

insert into generations (model_id, code, name, start_year, sort_order)
select id, 'juniper', '煥新版', 2025, 20 from vehicle_models where code = 'model-y';

-- 版本 ------------------------------------------------------------------------
insert into trims (generation_id, model_year, market, code, name, drivetrain, sort_order)
select g.id, 2026, 'TW', v.code, v.name, v.drivetrain, v.sort_order
from generations g
join vehicle_models m on m.id = g.model_id and m.code = 'model-y'
cross join (values
  ('rwd',            '後輪驅動',            'RWD', 10),
  ('long-range-awd', 'Long Range 全輪驅動', 'AWD', 20),
  ('performance',    'Performance 全輪驅動', 'AWD', 30)
) as v(code, name, drivetrain, sort_order)
where g.code = 'juniper';

-- 規格 ------------------------------------------------------------------------
with src as (
  select
    jsonb_build_object(
      'fields', jsonb_build_array('length_mm','width_mirrors_folded_mm','height_mm','wheelbase_mm','curb_weight_kg','tires'),
      'title', 'U-CAR Tesla Model Y 規格', 'url', 'https://news.u-car.com.tw/Tesla/Model%20Y/7089/spec',
      'retrieved_at', '2026-11-04', 'verified', false) as ucar,
    jsonb_build_object(
      'fields', jsonb_build_array('width_mm','width_mirrors_unfolded_mm','front_track_mm','rear_track_mm','ground_clearance_mm','rim_width_in','rim_offset_mm'),
      'title', 'EVSpecifications 2026 Model Y（歐規）', 'url', 'https://www.evspecifications.com/en/model/16f5412',
      'retrieved_at', '2026-11-04', 'verified', false) as evs_std,
    jsonb_build_object(
      'fields', jsonb_build_array('width_mm','width_mirrors_unfolded_mm','front_track_mm','rear_track_mm','ground_clearance_mm','rim_width_in','rim_offset_mm'),
      'title', 'EVSpecifications 2026 Model Y Performance（歐規）', 'url', 'https://www.evspecifications.com/en/model/e77e402',
      'retrieved_at', '2026-11-04', 'verified', false,
      'note', 'EVSpecifications 車高為 1610 mm，U-CAR 為 1611 mm，暫採 U-CAR') as evs_perf
)
insert into trim_specs (trim_id, length_mm, width_mm, width_mirrors_folded_mm, width_mirrors_unfolded_mm,
                        height_mm, wheelbase_mm, front_track_mm, rear_track_mm, ground_clearance_mm,
                        curb_weight_kg, sources)
select t.id, v.length_mm, v.width_mm, v.folded, v.unfolded, v.height_mm, v.wheelbase_mm,
       v.ftrack, v.rtrack, v.gc, v.weight,
       case when t.code = 'performance' then jsonb_build_array(src.ucar, src.evs_perf)
            else jsonb_build_array(src.ucar, src.evs_std) end
from trims t
cross join src
join (values
  ('rwd',            4790, 1920, 1982, 2129, 1624, 2890, 1636, 1636, 167, 1928),
  ('long-range-awd', 4790, 1920, 1982, 2129, 1624, 2890, 1636, 1636, 167, 1997),
  ('performance',    4796, 1921, 1982, 2128, 1611, 2890, 1646, 1630, 152, 2033)
) as v(code, length_mm, width_mm, folded, unfolded, height_mm, wheelbase_mm, ftrack, rtrack, gc, weight)
  on v.code = t.code
where t.model_year = 2026 and t.market = 'TW';

insert into tire_specs (trim_id, axle, width_mm, aspect_ratio, rim_diameter_in, rim_width_in, rim_offset_mm)
select t.id, v.axle, v.w, v.ar, v.rim, v.rw, v.et
from trims t
join (values
  ('rwd',            'front', 255, 45, 19,  9.5, 45),
  ('rwd',            'rear',  255, 45, 19,  9.5, 45),
  ('long-range-awd', 'front', 255, 45, 19,  9.5, 45),
  ('long-range-awd', 'rear',  255, 45, 19,  9.5, 45),
  ('performance',    'front', 255, 35, 21,  9.5, 40),
  ('performance',    'rear',  275, 35, 21, 10.5, 48)
) as v(code, axle, w, ar, rim, rw, et) on v.code = t.code
where t.model_year = 2026 and t.market = 'TW';

-- 車漆（中文名稱待與官網核對）------------------------------------------------
insert into paint_colors (generation_id, code, name, hex, metalness, roughness, sort_order)
select g.id, v.code, v.name, v.hex, v.metal, v.rough, v.sort_order
from generations g
cross join (values
  ('stealth-grey',  '星空灰', '#4a4f55', 0.55, 0.30, 10),
  ('pearl-white',   '珍珠白', '#e9eae7', 0.15, 0.32, 20),
  ('diamond-black', '鑽石黑', '#0c0d0f', 0.45, 0.25, 30),
  ('glacier-blue',  '冰川藍', '#7f9bb3', 0.55, 0.30, 40),
  ('quicksilver',   '量子銀', '#9aa0a5', 0.75, 0.28, 50),
  ('ultra-red',     '焰紅',   '#8f1218', 0.45, 0.30, 60)
) as v(code, name, hex, metal, rough, sort_order)
where g.code = 'juniper';

-- 部位目錄 --------------------------------------------------------------------
insert into parts (code, name, category, kind, sort_order) values
  ('front-bumper', '前保桿',       '車身鈑件',   'front-bumper', 10),
  ('rear-bumper',  '後保桿',       '車身鈑件',   'rear-bumper',  20),
  ('frunk',        '前廂蓋',       '車身鈑件',   'frunk',        30),
  ('tailgate',     '尾門',         '車身鈑件',   'tailgate',     40),
  ('skirt-L',      '左側裙',       '車身鈑件',   'skirt',        50),
  ('skirt-R',      '右側裙',       '車身鈑件',   'skirt',        51),
  ('ffender-L',    '左前葉子板',   '車身鈑件',   'fender',       60),
  ('ffender-R',    '右前葉子板',   '車身鈑件',   'fender',       61),
  ('fdoor-L',      '左前車門',     '車身鈑件',   'door',         70),
  ('fdoor-R',      '右前車門',     '車身鈑件',   'door',         71),
  ('rdoor-L',      '左後車門',     '車身鈑件',   'door',         72),
  ('rdoor-R',      '右後車門',     '車身鈑件',   'door',         73),
  ('rfender-L',    '左後葉子板',   '車身鈑件',   'fender',       80),
  ('rfender-R',    '右後葉子板',   '車身鈑件',   'fender',       81),
  ('body',         '車身',         '車身鈑件',   'body',         90),
  ('windshield',   '前擋風玻璃',   '玻璃與車頂', 'windshield',  100),
  ('rearglass',    '後擋玻璃',     '玻璃與車頂', 'rearglass',   110),
  ('roof',         '全景天窗',     '玻璃與車頂', 'roof',        120),
  ('sidewin-L',    '左側車窗',     '玻璃與車頂', 'sidewin',     130),
  ('sidewin-R',    '右側車窗',     '玻璃與車頂', 'sidewin',     131),
  ('wheel-FL',     '左前輪',       '輪胎與輪框', 'wheel',       200),
  ('wheel-FR',     '右前輪',       '輪胎與輪框', 'wheel',       201),
  ('wheel-RL',     '左後輪',       '輪胎與輪框', 'wheel',       202),
  ('wheel-RR',     '右後輪',       '輪胎與輪框', 'wheel',       203),
  ('mirror-L',     '左後照鏡',     '外觀配件',   'mirror',      300),
  ('mirror-R',     '右後照鏡',     '外觀配件',   'mirror',      301),
  ('lights-front', '前燈條／頭燈', '燈具',       'lightF',      400),
  ('lights-rear',  '尾燈條',       '燈具',       'lightR',      410),
  ('seat-front',   '前座椅',       '車內',       'seat',        500),
  ('seat-rear',    '後座椅',       '車內',       'seatR',       510),
  ('screen',       '中控螢幕',     '車內',       'screen',      520),
  ('steer',        '方向盤',       '車內',       'steer',       530),
  ('dash',         '儀表台',       '車內',       'dash',        540),
  ('console',      '中央扶手',     '車內',       'console',     550),
  ('floor',        '車內地板',     '車內',       'floor',       560),
  ('frunk-tub',    '前廂空間',     '車內',       'frunkTub',    570),
  ('trunk',        '後車廂',       '車內',       'trunk',       580);

insert into part_suggestions (part_kind, name, sort_order)
select kind, name, ord from (values
  ('front-bumper', '犀牛皮 PPF', 1), ('front-bumper', '前下巴擾流', 2), ('front-bumper', '前保桿防撞條', 3),
  ('rear-bumper', '後保桿防刮護片', 1), ('rear-bumper', '後擴散器', 2), ('rear-bumper', '拖車勾', 3),
  ('frunk', '引擎蓋 PPF', 1), ('frunk', '前廂蓋電動撐桿', 2),
  ('tailgate', '碳纖維尾翼', 1), ('tailgate', '尾門 PPF', 2), ('tailgate', '尾門電吸', 3),
  ('door', '門檻防踢墊', 1), ('door', '車門防撞條', 2), ('door', '電吸門', 3),
  ('fender', '葉子板 PPF', 1), ('fender', '葉子板側標', 2),
  ('skirt', '側裙改色膜', 1), ('skirt', '側踏板', 2),
  ('wheel', '輪框保護圈', 1), ('wheel', '輪框蓋', 2), ('wheel', '冬季胎', 3), ('wheel', '鍛造輪框', 4),
  ('mirror', '後照鏡蓋（碳纖維）', 1), ('mirror', '後照鏡防雨膜', 2),
  ('windshield', '前擋隔熱紙', 1), ('windshield', '前擋玻璃鍍膜', 2), ('windshield', '行車記錄器', 3),
  ('roof', '天窗遮陽簾', 1), ('roof', '天窗隔熱紙', 2), ('roof', '車頂架', 3),
  ('sidewin', '側窗隔熱紙', 1), ('sidewin', '側窗磁吸遮陽簾', 2),
  ('rearglass', '後擋隔熱紙', 1), ('rearglass', '後擋遮陽簾', 2),
  ('lightF', '燈條燻黑膜', 1), ('lightF', '頭燈 PPF', 2),
  ('lightR', '尾燈燻黑膜', 1),
  ('body', '全車鍍膜', 1), ('body', '全車改色膜', 2),
  ('seat', '座椅套', 1), ('seat', '頸枕', 2), ('seat', '腰靠', 3),
  ('seatR', '後座椅套', 1), ('seatR', '後座防踢墊', 2), ('seatR', '兒童安全座椅', 3),
  ('screen', '螢幕保護貼', 1), ('screen', '螢幕旋轉支架', 2),
  ('steer', '方向盤套', 1),
  ('dash', '儀表台面板貼', 1), ('dash', '手機架', 2), ('dash', '抬頭顯示器 HUD', 3),
  ('console', '扶手箱收納盒', 1), ('console', '無線充電板保護貼', 2),
  ('floor', '3D 腳踏墊', 1), ('floor', '後座地墊', 2),
  ('frunkTub', '前廂收納盒', 1), ('frunkTub', '前廂防水墊', 2),
  ('trunk', '後車廂防水墊', 1), ('trunk', '後車廂收納箱', 2), ('trunk', '後車廂分隔板', 3)
) as v(kind, name, ord);

-- 參數化模型（免費）-----------------------------------------------------------
-- 參考座標系：公尺；x 向前、軸距中點為原點、參考前後軸在 ±1.445；y 向上、地面 0；z 向右。
-- 前端依版本規格把參考幾何映射到實際尺寸（車長、車寬、車高、軸距、輪距、離地高、輪胎）。
insert into model_assets (generation_id, code, name, asset_type, tier, version, generator, params)
select g.id, 'modely-juniper-parametric', 'Model Y 煥新版 參數化模型', 'parametric', 'free', 1, 'modely-juniper@1',
$json${
  "reference": { "units": "m", "axle_x": 1.445 },
  "front_overhang_ratio": 0.49,
  "body": {
    "profile": [
      ["M", 2.20, 0.23],
      ["Q", 2.40, 0.27, 2.40, 0.48],
      ["Q", 2.40, 0.70, 2.10, 0.78],
      ["Q", 1.55, 0.92, 0.95, 0.97],
      ["L", -1.70, 1.00],
      ["Q", -2.25, 1.00, -2.32, 0.86],
      ["Q", -2.40, 0.62, -2.36, 0.40],
      ["Q", -2.33, 0.25, -2.12, 0.22],
      ["L", -1.89042, 0.22],
      ["A", -1.445, 0.37, 0.47, 3.46642, -0.32483, true],
      ["L", 0.99958, 0.22],
      ["A", 1.445, 0.37, 0.47, 3.46642, -0.32483, true],
      ["L", 2.20, 0.23]
    ],
    "extrude": { "depth": 1.68, "bevel_thickness": 0.14, "bevel_size": 0.06, "bevel_segments": 8, "curve_segments": 40 },
    "taper": [
      { "axis": "x", "from": 1.6,  "to": 2.45,  "amount": 0.12 },
      { "axis": "x", "from": -1.7, "to": -2.45, "amount": 0.08 }
    ]
  },
  "greenhouse": {
    "profile": [
      ["M", 1.10, 0.90],
      ["Q", 0.62, 1.22, 0.20, 1.50],
      ["Q", -0.25, 1.64, -0.90, 1.58],
      ["Q", -1.70, 1.45, -2.18, 0.98],
      ["L", -2.18, 0.90],
      ["L", 1.10, 0.90]
    ],
    "extrude": { "depth": 1.16, "bevel_thickness": 0.18, "bevel_size": 0.04, "bevel_segments": 8, "curve_segments": 40 },
    "taper": [
      { "axis": "y", "from": 0.95, "to": 1.62, "amount": 0.18 },
      { "axis": "x", "from": 0.3,  "to": 1.1,  "amount": 0.08 },
      { "axis": "x", "from": -1.4, "to": -2.2, "amount": 0.06 }
    ]
  },
  "cabin_cuts": {
    "body":  { "min": [-2.0, 0.93, -0.70], "max": [0.85, 3, 0.70] },
    "glass": { "min": [-2.3, -1, -0.70],   "max": [1.2, 0.98, 0.70] }
  },
  "seams": { "door_x": [0.98, 0.05, -1.0], "hood_x": 0.95, "gate_x": -2.0, "side_z": 0.82, "y_range": [0.42, 0.96] }
}$json$::jsonb
from generations g where g.code = 'juniper';

-- 部位對應：座標範圍（依 priority 由小到大比對，第一個命中者為準）
insert into asset_part_mappings (asset_id, part_id, mapping_type, zone, priority)
select a.id, p.id, 'zone', jsonb_build_object('surface', v.surface, 'min', v.min::jsonb, 'max', v.max::jsonb), v.priority
from model_assets a
cross join (values
  ('front-bumper', 'body',  '[2.12,-1,-3]',     '[3,0.74,3]',       10),
  ('rear-bumper',  'body',  '[-3,-1,-3]',       '[-2.12,0.70,3]',   20),
  ('frunk',        'body',  '[0.95,0.74,-0.84]','[3,3,0.84]',       30),
  ('tailgate',     'body',  '[-3,0.70,-3]',     '[-2.0,3,3]',       40),
  ('skirt-L',      'body',  '[-1.0,-1,-3]',     '[0.98,0.40,-0.84]',50),
  ('ffender-L',    'body',  '[0.98,-1,-3]',     '[2.12,3,-0.84]',   51),
  ('fdoor-L',      'body',  '[0.05,0.40,-3]',   '[0.98,3,-0.84]',   52),
  ('rdoor-L',      'body',  '[-1.0,0.40,-3]',   '[0.05,3,-0.84]',   53),
  ('rfender-L',    'body',  '[-2.12,-1,-3]',    '[-1.0,3,-0.84]',   54),
  ('skirt-R',      'body',  '[-1.0,-1,0.84]',   '[0.98,0.40,3]',    60),
  ('ffender-R',    'body',  '[0.98,-1,0.84]',   '[2.12,3,3]',       61),
  ('fdoor-R',      'body',  '[0.05,0.40,0.84]', '[0.98,3,3]',       62),
  ('rdoor-R',      'body',  '[-1.0,0.40,0.84]', '[0.05,3,3]',       63),
  ('rfender-R',    'body',  '[-2.12,-1,0.84]',  '[-1.0,3,3]',       64),
  ('body',         'body',  '[-9,-9,-9]',       '[9,9,9]',          99),
  ('windshield',   'glass', '[0.30,-1,-3]',     '[3,3,3]',          10),
  ('rearglass',    'glass', '[-3,-1,-3]',       '[-1.35,3,3]',      20),
  ('roof',         'glass', '[-1.35,1.36,-0.45]','[0.30,3,0.45]',   30),
  ('sidewin-L',    'glass', '[-1.35,-1,-3]',    '[0.30,3,0]',       40),
  ('sidewin-R',    'glass', '[-1.35,-1,0]',     '[0.30,3,3]',       41)
) as v(code, surface, min, max, priority)
join parts p on p.code = v.code
where a.code = 'modely-juniper-parametric';

-- 部位對應：獨立零件（mesh_key 由參數化產生器建立）
insert into asset_part_mappings (asset_id, part_id, mapping_type, mesh_key)
select a.id, p.id, 'mesh', p.code
from model_assets a
join parts p on p.code in ('wheel-FL','wheel-FR','wheel-RL','wheel-RR','mirror-L','mirror-R',
                           'lights-front','lights-rear','seat-front','seat-rear','screen','steer',
                           'dash','console','floor','frunk-tub','trunk')
where a.code = 'modely-juniper-parametric';

-- 可開啟件
insert into asset_openings (asset_id, code, name, hinge, axis, open_angle_deg, body_region, glass_region, mesh_keys, sort_order)
select a.id, v.code, v.name, v.hinge::jsonb, v.axis, v.angle, v.body::jsonb, v.glass::jsonb, v.meshes::text[], v.ord
from model_assets a
cross join (values
  ('fdL',   '左前門', '[0.98,0.7,-0.92]', 'y', -65.0,
    '{"min":[0.05,0.40,-3],"max":[0.98,3,-0.84]}', '{"min":[0.05,-1,-3],"max":[0.98,1.45,-0.55]}', '{mirror-L}', 10),
  ('fdR',   '右前門', '[0.98,0.7,0.92]',  'y',  65.0,
    '{"min":[0.05,0.40,0.84],"max":[0.98,3,3]}',  '{"min":[0.05,-1,0.55],"max":[0.98,1.45,3]}',  '{mirror-R}', 20),
  ('rdL',   '左後門', '[0.05,0.7,-0.92]', 'y', -65.0,
    '{"min":[-1.0,0.40,-3],"max":[0.05,3,-0.84]}','{"min":[-1.0,-1,-3],"max":[0.05,1.45,-0.55]}', '{}', 30),
  ('rdR',   '右後門', '[0.05,0.7,0.92]',  'y',  65.0,
    '{"min":[-1.0,0.40,0.84],"max":[0.05,3,3]}',  '{"min":[-1.0,-1,0.55],"max":[0.05,1.45,3]}',  '{}', 40),
  ('frunk', '前廂',   '[0.95,0.97,0]',    'z',  49.0,
    '{"min":[0.95,0.74,-0.84],"max":[3,3,0.84]}', null, '{}', 50),
  ('tail',  '尾門',   '[-1.3,1.52,0]',    'z', -72.0,
    '{"min":[-3,0.70,-3],"max":[-2.0,3,3]}',      '{"min":[-3,-1,-3],"max":[-1.35,3,3]}', '{lights-rear}', 60)
) as v(code, name, hinge, axis, angle, body, glass, meshes, ord)
where a.code = 'modely-juniper-parametric';

commit;
