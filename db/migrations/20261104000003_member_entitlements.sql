-- =============================================================================
-- 會員方案與模型權限
--
-- 對應既有資料表：
--   public.member_profiles  會員（auth_user_id → auth.users）
--   public.admin_accounts   後台管理員（開通方案、授權模型時記錄是誰操作）
--
-- 規則：
--   * 所有會員都能使用 tier = 'free' 的模型，不需要任何資料列。
--   * tier = 'premium' 需要「有效訂閱的方案包含 premium」或「該模型的單一授權」，
--     且會員狀態必須是 active（pending / suspended / inactive 只能用免費模型）。
-- =============================================================================
set search_path = viewer, public;

-- 方案 -------------------------------------------------------------------------
create table viewer.plans (
  id              smallint generated always as identity primary key,
  code            text not null unique,                 -- 'free' / 'premium'
  name            text not null,
  description     text,
  price_twd       integer check (price_twd >= 0),       -- null = 尚未定價
  billing_period  text not null default 'none'
                    check (billing_period in ('none', 'monthly', 'yearly', 'lifetime')),
  is_default      boolean not null default false,       -- 新會員的預設方案
  is_active       boolean not null default true,
  sort_order      integer not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create unique index plans_single_default on viewer.plans (is_default) where is_default;
create trigger plans_touch before update on viewer.plans
  for each row execute function viewer.touch_updated_at();

-- 方案可使用的模型等級（對應 model_assets.tier）
create table viewer.plan_tiers (
  plan_id  smallint not null references viewer.plans(id) on delete cascade,
  tier     text not null check (tier in ('free', 'premium')),
  primary key (plan_id, tier)
);

-- 會員訂閱 ---------------------------------------------------------------------
create table viewer.member_subscriptions (
  id            uuid primary key default gen_random_uuid(),
  member_id     uuid not null references public.member_profiles(id) on delete cascade,
  plan_id       smallint not null references viewer.plans(id),
  status        text not null default 'active' check (status in ('active', 'canceled', 'expired')),
  starts_at     timestamptz not null default now(),
  ends_at       timestamptz,                            -- null = 不會到期
  source        text not null check (source in ('admin', 'payment', 'promo', 'system')),
  granted_by    uuid references public.admin_accounts(id) on delete set null,
  external_ref  text,                                   -- 金流訂單編號等
  note          text check (char_length(note) <= 500),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check (ends_at is null or ends_at > starts_at),
  check (source <> 'admin' or granted_by is not null)
);
create index member_subscriptions_member_idx on viewer.member_subscriptions (member_id, status);
create unique index member_subscriptions_external_ref_uq on viewer.member_subscriptions (source, external_ref)
  where external_ref is not null;
create trigger member_subscriptions_touch before update on viewer.member_subscriptions
  for each row execute function viewer.touch_updated_at();

-- 單一模型授權（單次購買、贈送、活動）----------------------------------------
create table viewer.member_asset_grants (
  id            uuid primary key default gen_random_uuid(),
  member_id     uuid not null references public.member_profiles(id) on delete cascade,
  asset_id      integer not null references viewer.model_assets(id) on delete cascade,
  source        text not null check (source in ('admin', 'payment', 'promo', 'system')),
  granted_by    uuid references public.admin_accounts(id) on delete set null,
  starts_at     timestamptz not null default now(),
  ends_at       timestamptz,
  revoked_at    timestamptz,
  external_ref  text,
  note          text check (char_length(note) <= 500),
  created_at    timestamptz not null default now(),
  check (ends_at is null or ends_at > starts_at),
  check (source <> 'admin' or granted_by is not null)
);
create index member_asset_grants_member_idx on viewer.member_asset_grants (member_id, asset_id);

-- 配置清單歸屬會員 -------------------------------------------------------------
alter table viewer.builds
  add constraint builds_owner_id_fkey
  foreign key (owner_id) references public.member_profiles(id) on delete cascade;

-- 權限判斷 ---------------------------------------------------------------------
-- 會員目前可使用的模型等級（free 永遠包含在內）
create or replace function viewer.member_tiers(p_member_id uuid)
returns setof text
language sql stable
set search_path = viewer, public
as $$
  select 'free'
  union
  select pt.tier
  from viewer.member_subscriptions s
  join viewer.plans p       on p.id = s.plan_id and p.is_active
  join viewer.plan_tiers pt on pt.plan_id = p.id
  join public.member_profiles m on m.id = s.member_id and m.status = 'active'
  where s.member_id = p_member_id
    and s.status = 'active'
    and s.starts_at <= now()
    and (s.ends_at is null or s.ends_at > now());
$$;

-- 會員能否使用某個模型資源；p_member_id 為 null（未登入）時只能用免費模型
create or replace function viewer.member_can_access_asset(p_member_id uuid, p_asset_id integer)
returns boolean
language sql stable
set search_path = viewer, public
as $$
  select exists (
    select 1 from viewer.model_assets a
    where a.id = p_asset_id and a.is_active
      and (
        a.tier = 'free'
        or (p_member_id is not null and a.tier in (select viewer.member_tiers(p_member_id)))
        or (p_member_id is not null and exists (
              select 1
              from viewer.member_asset_grants g
              join public.member_profiles m on m.id = g.member_id and m.status = 'active'
              where g.member_id = p_member_id and g.asset_id = a.id
                and g.revoked_at is null
                and g.starts_at <= now()
                and (g.ends_at is null or g.ends_at > now())))
      )
  );
$$;

-- 預設方案 ---------------------------------------------------------------------
insert into viewer.plans (code, name, description, price_twd, billing_period, is_default, sort_order) values
  ('free',    '免費會員', '可使用所有免費的參數化模型與配件標註', 0,    'none',    true,  10),
  ('premium', '付費會員', '另可使用付費的精細 3D 模型',          null, 'monthly', false, 20);

insert into viewer.plan_tiers (plan_id, tier)
select p.id, t.tier
from viewer.plans p
join (values ('free', 'free'), ('premium', 'free'), ('premium', 'premium')) as t(plan, tier) on t.plan = p.code;

-- 安全設定：與 viewer 其他資料表一致 -------------------------------------------
alter table viewer.plans                enable row level security;
alter table viewer.plan_tiers           enable row level security;
alter table viewer.member_subscriptions enable row level security;
alter table viewer.member_asset_grants  enable row level security;

revoke all on function viewer.member_tiers(uuid) from public;
revoke all on function viewer.member_can_access_asset(uuid, integer) from public;
