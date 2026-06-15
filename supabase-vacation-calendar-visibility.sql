-- Let approved employees see approved vacation days on shared calendars.
-- This is read-only and does not allow workers to edit another employee's vacation request.

drop policy if exists "Approved users can read approved vacation calendar" on public.vacation_requests;

create policy "Approved users can read approved vacation calendar"
on public.vacation_requests
for select
to authenticated
using (
  status = 'approved'
  and exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.account_status = 'approved'
  )
);
