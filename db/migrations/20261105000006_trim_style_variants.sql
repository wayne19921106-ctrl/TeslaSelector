-- =============================================================================
-- 版本外觀：同一世代不同版本的外觀差異（燈具、前保桿、擾流板、輪框）
--   trims.style_variant     版本使用哪一組外觀，對應 Tesla 的 Standard / Premium / Performance
--   model_assets.params     lights（共用燈具位置）與 variants（各外觀的差異參數）
--
-- 對應（台灣 2026 年式）：後輪驅動 = standard、Long Range = premium、Performance = performance
-- 造型參數依 Tesla 公開的外觀渲染圖目視估計，座標為參考座標系（見 seed 說明）。
-- =============================================================================

alter table viewer.trims
  add column style_variant text not null default 'premium'
  check (style_variant in ('standard', 'premium', 'performance'));

comment on column viewer.trims.style_variant is
  '外觀版本：standard / premium / performance，對應 model_assets.params.variants 的 key';

update viewer.trims t
set style_variant = v.variant
from (values ('rwd', 'standard'), ('long-range-awd', 'premium'), ('performance', 'performance')) as v(code, variant)
where t.code = v.code
  and t.generation_id = (select g.id from viewer.generations g
                         join viewer.vehicle_models m on m.id = g.model_id
                         where m.code = 'model-y' and g.code = 'juniper');

-- 燈具與外觀參數。y 為高度、z 為左右範圍（只寫右側的會自動左右對稱），
-- 前端以射線貼合車身表面放置，所以不需要 x 座標。r 為管狀截面半徑（公尺）。
update viewer.model_assets
set params = params || $json${
  "lights": {
    "front_bar": { "y": 0.735, "z": [-0.70, 0.70], "r": 0.011 },
    "rear_bar":  { "y": 0.80,  "z": [-0.78, 0.78], "r": 0.016 }
  },
  "variants": {
    "standard": {
      "front_light_bar": false,
      "headlights":   { "y": 0.745, "z": [0.50, 0.76], "r": 0.016 },
      "lower_intake": { "y": 0.33,  "z": [-0.68, 0.68], "r": 0.055 },
      "bumper_vents": null,
      "rear_spoiler": null,
      "wheel": { "spokes": 10, "rim_color": "#2b2e33" }
    },
    "premium": {
      "front_light_bar": true,
      "headlights":   { "y": 0.50, "z": [0.50, 0.76], "r": 0.026 },
      "lower_intake": { "y": 0.31, "z": [-0.45, 0.45], "r": 0.04 },
      "bumper_vents": null,
      "rear_spoiler": null,
      "wheel": { "spokes": 10, "rim_color": "#2b2e33" }
    },
    "performance": {
      "front_light_bar": true,
      "headlights":   { "y": 0.50,  "z": [0.50, 0.76], "r": 0.026 },
      "lower_intake": { "y": 0.31,  "z": [-0.45, 0.45], "r": 0.04 },
      "bumper_vents": { "y": 0.395, "z": [0.50, 0.74], "r": 0.045 },
      "rear_spoiler": { "x": -2.20, "z": [-0.62, 0.62], "chord": 0.14 },
      "wheel": { "spokes": 12, "rim_color": "#1d2024" }
    }
  }
}$json$::jsonb,
    version = version + 1
where code = 'modely-juniper-parametric';
