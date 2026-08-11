-- Shop is a valid internal work destination. Keep its hours payable, but do not
-- require a numbered job match before Accounting can approve/export the period.

create or replace function private.jgc_approve_shop_accounting_entry()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.entry_type = 'work'
    and new.job_id is null
    and new.job_match_status = 'unmatched'
    and (
      lower(trim(coalesce(new.source_job_number, ''))) ~ '^shop([[:space:]]|$)'
      or lower(trim(coalesce(new.source_job_name, ''))) ~ '^shop([[:space:]]|$)'
    )
  then
    new.job_match_status := 'not_applicable';
    new.job_match_note := 'Automatically approved: Shop';
    new.job_matched_by := null;
    new.job_matched_at := null;
  end if;

  return new;
end;
$$;

revoke all on function private.jgc_approve_shop_accounting_entry()
  from public, anon, authenticated;

drop trigger if exists accounting_time_entries_approve_shop
  on public.accounting_time_entries;
create trigger accounting_time_entries_approve_shop
before insert or update of entry_type, source_job_number, source_job_name, job_id, job_match_status
on public.accounting_time_entries
for each row
execute function private.jgc_approve_shop_accounting_entry();

update public.accounting_time_entries
set
  job_match_status = 'not_applicable',
  job_match_note = 'Automatically approved: Shop',
  job_matched_by = null,
  job_matched_at = null,
  updated_at = now()
where is_current = true
  and entry_type = 'work'
  and job_id is null
  and job_match_status = 'unmatched'
  and (
    lower(trim(coalesce(source_job_number, ''))) ~ '^shop([[:space:]]|$)'
    or lower(trim(coalesce(source_job_name, ''))) ~ '^shop([[:space:]]|$)'
  );
