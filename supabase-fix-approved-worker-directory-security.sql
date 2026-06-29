-- Fix Supabase Security Advisor warning:
-- public.approved_worker_directory is a view using the default owner-permission behavior.
-- security_invoker makes the view respect the permissions/RLS of the user querying it.

alter view if exists public.approved_worker_directory
    set (security_invoker = true);

-- Verification: reloptions should include security_invoker=true.
select
    n.nspname as schema_name,
    c.relname as view_name,
    c.reloptions
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname = 'approved_worker_directory';
