alter table public.lg3s_editorial_posts drop constraint lg3s_editorial_posts_status_check;
alter table public.lg3s_editorial_posts add constraint lg3s_editorial_posts_status_check check (status in ('pending_review','needs_review','approved','published','rejected','superseded'));
alter table public.lg3s_editorial_posts add column if not exists superseded_by bigint references public.lg3s_editorial_posts(id);
