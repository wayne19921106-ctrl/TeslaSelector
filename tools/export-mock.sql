-- 從資料庫匯出與 API 回應相同結構的 JSON，給前端離線示範模式使用。
-- 用法：psql -At -d <db> -f tools/export-mock.sql > frontend/js/mock-data.json
set search_path = viewer, public;
\pset footer off

with
trim_rows as (
  select t.*, g.code g_code, g.name g_name, g.start_year, g.end_year, g.sort_order g_sort,
         m.code m_code, m.name m_name, m.sort_order m_sort, mk.code mk_code, mk.name mk_name
  from trims t
  join generations g on g.id = t.generation_id
  join vehicle_models m on m.id = g.model_id
  join makes mk on mk.id = m.make_id
  where t.is_active and t.market = 'TW'
),
catalog as (
  select jsonb_build_object('makes', jsonb_agg(mk order by mk->>'name')) as j
  from (
    select jsonb_build_object('code', mk_code, 'name', mk_name, 'models', jsonb_agg(md order by m_sort)) mk, mk_name
    from (
      select mk_code, mk_name, m_sort,
             jsonb_build_object('code', m_code, 'name', m_name, 'generations', jsonb_agg(gn order by g_sort)) md
      from (
        select mk_code, mk_name, m_code, m_name, m_sort, g_sort,
               jsonb_build_object('id', generation_id, 'code', g_code, 'name', g_name,
                 'startYear', start_year, 'endYear', end_year,
                 'trims', jsonb_agg(jsonb_build_object('id', id, 'code', code, 'name', name,
                   'modelYear', model_year, 'market', market, 'drivetrain', drivetrain, 'styleVariant', style_variant)
                   order by model_year desc, sort_order)) gn
        from trim_rows
        group by mk_code, mk_name, m_code, m_name, m_sort, g_sort, generation_id, g_code, g_name, start_year, end_year
      ) x group by mk_code, mk_name, m_code, m_name, m_sort
    ) y group by mk_code, mk_name
  ) z
),
trim_detail as (
  select jsonb_object_agg(t.id::text, jsonb_build_object(
    'id', t.id, 'code', t.code, 'name', t.name, 'modelYear', t.model_year, 'market', t.market, 'drivetrain', t.drivetrain, 'styleVariant', t.style_variant,
    'generation', jsonb_build_object('id', t.generation_id, 'code', t.g_code, 'name', t.g_name, 'modelName', t.m_name, 'makeName', t.mk_name),
    'specs', jsonb_build_object(
      'lengthMm', s.length_mm, 'widthMm', s.width_mm, 'widthMirrorsFoldedMm', s.width_mirrors_folded_mm,
      'widthMirrorsUnfoldedMm', s.width_mirrors_unfolded_mm, 'heightMm', s.height_mm, 'wheelbaseMm', s.wheelbase_mm,
      'frontTrackMm', s.front_track_mm, 'rearTrackMm', s.rear_track_mm, 'groundClearanceMm', s.ground_clearance_mm,
      'curbWeightKg', s.curb_weight_kg, 'verified', s.verified_at is not null, 'verifiedAt', s.verified_at,
      'sources', (select coalesce(jsonb_agg(jsonb_build_object(
          'fields', e->'fields', 'title', e->>'title', 'url', e->>'url', 'retrievedAt', e->>'retrieved_at',
          'verified', coalesce((e->>'verified')::boolean, false), 'note', e->>'note')), '[]'::jsonb)
        from jsonb_array_elements(s.sources) e)),
    'tires', (select jsonb_agg(jsonb_build_object(
        'axle', ts.axle, 'designation', ts.width_mm || '/' || ts.aspect_ratio || ' R' || ts.rim_diameter_in,
        'widthMm', ts.width_mm, 'aspectRatio', ts.aspect_ratio, 'rimDiameterIn', ts.rim_diameter_in,
        'rimWidthIn', ts.rim_width_in, 'rimOffsetMm', ts.rim_offset_mm,
        'overallDiameterMm', round(ts.rim_diameter_in * 25.4 + 2.0 * ts.width_mm * ts.aspect_ratio / 100.0)::int)
        order by case ts.axle when 'front' then 0 else 1 end)
      from tire_specs ts where ts.trim_id = t.id),
    'paintColors', (select jsonb_agg(jsonb_build_object('id', c.id, 'code', c.code, 'name', c.name, 'hex', c.hex,
        'metalness', c.metalness, 'roughness', c.roughness) order by c.sort_order)
      from paint_colors c where c.generation_id = t.generation_id and c.is_active),
    'assets', (select jsonb_agg(jsonb_build_object('id', a.id, 'code', a.code, 'name', a.name,
        'assetType', a.asset_type, 'tier', a.tier, 'version', a.version)
        order by case a.tier when 'free' then 0 else 1 end, a.id)
      from model_assets a where a.is_active and a.generation_id = t.generation_id and (a.trim_id is null or a.trim_id = t.id))
  )) as j
  from trim_rows t join trim_specs s on s.trim_id = t.id
),
asset_detail as (
  select jsonb_object_agg(a.id::text, jsonb_build_object(
    'id', a.id, 'code', a.code, 'name', a.name, 'assetType', a.asset_type, 'tier', a.tier, 'version', a.version,
    'generator', a.generator, 'params', a.params, 'locked', a.tier = 'premium', 'download', null,
    'partMappings', (select jsonb_agg(jsonb_build_object(
        'partCode', p.code, 'mappingType', m.mapping_type, 'priority', m.priority,
        'zone', case when m.zone is null then null else jsonb_build_object('surface', m.zone->>'surface', 'min', m.zone->'min', 'max', m.zone->'max') end,
        'meshKey', m.mesh_key)
        order by case m.mapping_type when 'zone' then 0 else 1 end, m.priority, m.id)
      from asset_part_mappings m join parts p on p.id = m.part_id where m.asset_id = a.id),
    'openings', (select jsonb_agg(jsonb_build_object(
        'code', o.code, 'name', o.name, 'hinge', o.hinge, 'axis', o.axis, 'openAngleDeg', o.open_angle_deg,
        'bodyRegion', o.body_region, 'glassRegion', o.glass_region, 'meshKeys', to_jsonb(o.mesh_keys)) order by o.sort_order)
      from asset_openings o where o.asset_id = a.id)
  )) as j
  from model_assets a where a.is_active
),
parts_json as (
  select jsonb_agg(jsonb_build_object('code', p.code, 'name', p.name, 'category', p.category,
    'accessoryTypes', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', t.id, 'name', t.name,
          'category', case when c.id is null then null else jsonb_build_object('code', c.code, 'name', c.name) end,
          'products', coalesce((
            select jsonb_agg(jsonb_build_object('id', pr.id, 'source', pr.source,
                     'brand', jsonb_build_object('id', b.id, 'code', b.code, 'name', b.name, 'logoUrl', b.logo_url),
                     'brandName', b.name, 'name', pr.name, 'model', pr.model,
                     'suggestedPriceTwd', pr.suggested_price_twd, 'rating', pr.rating, 'url', pr.url,
                     'displayName', concat_ws(' ', b.name, pr.name, pr.model))
                     order by pap.sort_order, pr.sort_order)
            from part_accessory_products pap
            join products pr on pr.id = pap.product_id and pr.is_active and pr.source = 'builtin'
            join brands b on b.id = pr.brand_id
            where pap.part_accessory_type_id = pat.id), '[]'::jsonb))
        order by pat.sort_order, t.sort_order)
      from part_accessory_types pat
      join accessory_types t on t.id = pat.accessory_type_id and t.is_active and t.source = 'builtin'
      left join accessory_categories c on c.id = t.category_id
      where pat.part_id = p.id), '[]'::jsonb))
    order by p.sort_order) as j
  from parts p
),
brands_json as (
  select jsonb_agg(jsonb_build_object('id', id, 'code', code, 'name', name, 'logoUrl', logo_url,
           'promoCode', promo_code, 'description', description, 'url', url) order by sort_order, code) as j
  from brands where is_active
),
categories_json as (
  select jsonb_agg(jsonb_build_object('code', code, 'name', name) order by sort_order) as j from accessory_categories
)
select jsonb_pretty(jsonb_build_object(
  'catalog', (select j from catalog),
  'trims', (select j from trim_detail),
  'assets', (select j from asset_detail),
  'parts', (select j from parts_json),
  'accessoryCategories', (select j from categories_json),
  'brands', (select j from brands_json)));
