-- Release 1043: SDS Sheets category; preserve existing upload, review and visibility permissions.
alter table public.job_board_documents drop constraint job_board_documents_category_check;
alter table public.job_board_documents add constraint job_board_documents_category_check check (category = any (array[
  'hs-documents','site-specific','jgc-policy','jsa','toolbox-talk','accident-incident','daily-report','permit','inspection','notice-of-project','sds','other']));

-- The upload and edit functions each validate the same category list; add the new category to both.
do $$
declare
  fn text;
  d text;
  old_list constant text := $q$('hs-documents','site-specific','jgc-policy','jsa','toolbox-talk','accident-incident','daily-report','permit','inspection','notice-of-project','other')$q$;
  new_list constant text := $q$('hs-documents','site-specific','jgc-policy','jsa','toolbox-talk','accident-incident','daily-report','permit','inspection','notice-of-project','sds','other')$q$;
begin
  foreach fn in array array['private.jgc_begin_job_board_upload(uuid,text,text,date,text,text,bigint,text)','private.jgc_update_job_board_document(uuid,text,date,text,text)'] loop
    d := pg_get_functiondef(fn::regprocedure);
    if (length(d) - length(replace(d, old_list, ''))) / length(old_list) <> 1 then
      raise exception '% does not contain the category list exactly once', fn;
    end if;
    execute replace(d, old_list, new_list);
  end loop;
end $$;
