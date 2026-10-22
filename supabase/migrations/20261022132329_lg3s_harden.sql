-- Hardening: pin search_path on the pure helper (advisor WARN).
alter function private.lg3s_week_of(date) set search_path = pg_catalog;
revoke all on function private.lg3s_week_of(date) from public, anon, authenticated;
