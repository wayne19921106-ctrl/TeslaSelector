-- =============================================================================
-- 測試用替身：在一般 PostgreSQL 上模擬 Supabase 專案中「不在本 repo」的物件，
-- 讓 db/migrations 可以從頭套用（CI 整合測試、本機測試用，不要在 Supabase 執行）。
--   * Supabase 內建角色 anon / authenticated
--   * 會員與後台資料表（原本建在 public，migration 0005 會搬到 member / admin）
-- =============================================================================
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
end $$;

create type public.member_gender as enum ('male', 'female', 'other', 'undisclosed');
create type public.member_status as enum ('active', 'inactive', 'suspended', 'pending');
create type public.login_result  as enum ('success', 'failed', 'blocked');

create table public.member_profiles (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  status public.member_status not null default 'pending',
  gender public.member_gender not null default 'undisclosed'
);
create table public.member_oauth_providers (id uuid primary key default gen_random_uuid(), member_id uuid references public.member_profiles(id));
create table public.member_login_logs (id uuid primary key default gen_random_uuid(), member_id uuid references public.member_profiles(id), result public.login_result);
create table public.admin_accounts (id uuid primary key default gen_random_uuid(), username text unique);
create table public.admin_roles (id uuid primary key default gen_random_uuid());
create table public.admin_permissions (id uuid primary key default gen_random_uuid());
create table public.admin_account_roles (account_id uuid, role_id uuid, primary key (account_id, role_id));
create table public.admin_role_permissions (role_id uuid, permission_id uuid, primary key (role_id, permission_id));
create table public.menus (id uuid primary key default gen_random_uuid());
create table public.menu_permissions (menu_id uuid, permission_id uuid, primary key (menu_id, permission_id));
create table public.admin_login_logs (id uuid primary key default gen_random_uuid(), result public.login_result);
create table public.audit_logs (id uuid primary key default gen_random_uuid());
