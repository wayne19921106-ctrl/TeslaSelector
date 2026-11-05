-- 版本外觀微調（依渲染結果）：
--   前燈條加粗；Standard 頭燈下移，避免落在前廂蓋開啟範圍；Performance 擾流板移到尾門上緣
update viewer.model_assets
set params = jsonb_set(jsonb_set(jsonb_set(jsonb_set(params,
      '{lights,front_bar,r}', '0.014'),
      '{variants,standard,headlights}', '{"y": 0.735, "z": [0.50, 0.76], "r": 0.018}'),
      '{variants,performance,rear_spoiler,x}', '-2.30'),
      '{variants,performance,rear_spoiler,chord}', '0.12'),
    version = version + 1
where code = 'modely-juniper-parametric';
