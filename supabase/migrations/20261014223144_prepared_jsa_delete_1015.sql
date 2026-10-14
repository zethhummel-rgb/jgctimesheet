-- Only unused preparations can be removed. Published reports and signatures stay intact.
create function private.jgc_delete_prepared_jsa(p_id uuid, p_revision integer)
returns boolean language plpgsql security definer set search_path = '' as $$
declare item public.jsa_preparations;
begin
  if auth.uid() is null or public.is_admin() is distinct from true then
    raise exception 'Approved admin access required' using errcode='42501';
  end if;
  if p_id is null or p_revision is null or p_revision < 1 then
    raise exception 'Invalid prepared JSA' using errcode='22023';
  end if;
  -- Use the same lock as preparation save/activation to prevent a concurrent activation.
  perform pg_advisory_xact_lock(hashtextextended(p_id::text, 0));
  select * into item from public.jsa_preparations where id=p_id for update;
  if not found then return true; end if; -- Safe retry after an uncertain successful delete.
  if item.activated_at is not null or item.record_id is not null
    or exists(select 1 from public.inspection_records r where r.id=p_id)
    or exists(select 1 from public.safety_acknowledgements a where a.record_id=p_id) then
    raise exception 'This JSA has been activated or has report history and cannot be deleted here.' using errcode='22023';
  end if;
  if item.revision is distinct from p_revision then
    raise exception 'This prepared JSA changed elsewhere. Refresh the list before deleting.' using errcode='40001';
  end if;
  delete from public.jsa_preparations where id=p_id;
  return true;
end $$;
revoke all on function private.jgc_delete_prepared_jsa(uuid,integer) from public,anon;
grant execute on function private.jgc_delete_prepared_jsa(uuid,integer) to authenticated;
create function public.delete_prepared_jsa(p_id uuid,p_revision integer)
returns boolean language sql security invoker set search_path='' as $$
  select private.jgc_delete_prepared_jsa(p_id,p_revision);
$$;
revoke all on function public.delete_prepared_jsa(uuid,integer) from public,anon;
grant execute on function public.delete_prepared_jsa(uuid,integer) to authenticated;
