-- =============================================================================
-- 後台與會員分別獨立成 admin / member schema
--   admin  ：後台帳號、角色、權限、選單、登入與操作紀錄
--   member ：會員身分（跨產品共用）
--   public ：只保留共用型別（login_result）
-- 兩個 schema 都不加入 Data API 的 Exposed schemas，一律經由 .NET API 存取。
--
-- 注意：搬移的 12 張後台／會員資料表原本是在這個 repo 之外建立的。
-- 舊版 public."Member" 不在此 migration 刪除，見 README。
-- =============================================================================

create schema if not exists admin;
create schema if not exists member;
comment on schema admin  is '後台：帳號、角色、權限、選單、登入與操作紀錄';
comment on schema member is '會員身分（跨產品共用），產品權限放在各產品 schema';

-- 會員 ---------------------------------------------------------------------------
alter type  public.member_gender          set schema member;
alter type  public.member_status          set schema member;
alter table public.member_profiles        set schema member;
alter table public.member_oauth_providers set schema member;
alter table public.member_login_logs      set schema member;

-- 後台 ---------------------------------------------------------------------------
alter table public.admin_accounts         set schema admin;
alter table public.admin_roles            set schema admin;
alter table public.admin_permissions      set schema admin;
alter table public.admin_account_roles    set schema admin;
alter table public.admin_role_permissions set schema admin;
alter table public.menus                  set schema admin;
alter table public.menu_permissions       set schema admin;
alter table public.admin_login_logs       set schema admin;
alter table public.audit_logs             set schema admin;

-- 安全設定：全面啟用 RLS、收回前端角色的存取權 -----------------------------------
do $$
declare t record;
begin
  for t in select schemaname, tablename from pg_tables where schemaname in ('admin', 'member') loop
    execute format('alter table %I.%I enable row level security', t.schemaname, t.tablename);
  end loop;
end $$;

revoke all on all tables    in schema admin, member from anon, authenticated;
revoke all on all sequences in schema admin, member from anon, authenticated;
revoke all on schema admin, member from public, anon, authenticated;

-- viewer 權限判斷函式改參照 member.member_profiles -------------------------------
create or replace function viewer.member_tiers(p_member_id uuid)
returns setof text
language sql stable
set search_path = ''
as $$
  select 'free'
  union
  select pt.tier
  from viewer.member_subscriptions s
  join viewer.plans p       on p.id = s.plan_id and p.is_active
  join viewer.plan_tiers pt on pt.plan_id = p.id
  join member.member_profiles m on m.id = s.member_id and m.status = 'active'
  where s.member_id = p_member_id
    and s.status = 'active'
    and s.starts_at <= now()
    and (s.ends_at is null or s.ends_at > now());
$$;

create or replace function viewer.member_can_access_asset(p_member_id uuid, p_asset_id integer)
returns boolean
language sql stable
set search_path = ''
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
              join member.member_profiles m on m.id = g.member_id and m.status = 'active'
              where g.member_id = p_member_id and g.asset_id = a.id
                and g.revoked_at is null
                and g.starts_at <= now()
                and (g.ends_at is null or g.ends_at > now())))
      )
  );
$$;

revoke all on function viewer.member_tiers(uuid) from public;
revoke all on function viewer.member_can_access_asset(uuid, integer) from public;
