-- The board session is bound to the authenticated user and this job. Office
-- managers also open boards directly from Estimate Desk without a QR check-in.
do $migration$
declare
  model text := pg_get_functiondef('private.jgc_job_board_model(uuid,uuid)'::regprocedure);
  previous text := $old$case when registered then private.jgc_job_board_document_link(b.portal_job_id) end$old$;
  staff_only text := $new$case when manage or (s.identity_type = 'staff' and private.jgc_job_board_staff())
    then private.jgc_job_board_document_link(b.portal_job_id) end$new$;
begin
  if cardinality(string_to_array(model, previous)) <> 2 then
    raise exception 'Unexpected Job Board drawings rule; check the current board model';
  end if;
  execute replace(model, previous, staff_only);
end;
$migration$;

-- The employee job list reads the same folder URL directly from jobs. Keep
-- retired subcontractor accounts outside this path as well as the QR board.
create policy "Only staff accounts can read employee job rows"
  on public.jobs as restrictive for select to authenticated
  using ((select p.role in ('worker','supervisor','admin') and p.account_status = 'approved'
          from public.profiles p where p.id = (select auth.uid())));
