-- Supabase 安全檢查：函式需固定 search_path
alter function viewer.touch_updated_at() set search_path = '';
