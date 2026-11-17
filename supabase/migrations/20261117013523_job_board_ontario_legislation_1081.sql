-- Release 1081: add a dedicated Ontario legislation section without changing access rules.
alter table public.job_board_documents drop constraint job_board_documents_category_check;
alter table public.job_board_documents add constraint job_board_documents_category_check check (category = any (array[
  'hs-documents','site-specific','jgc-policy','jsa','toolbox-talk','accident-incident','daily-report','permit','inspection','notice-of-project','sds','ontario-legislation','other']));

do $$
declare
  fn text;
  d text;
  old_list constant text := $q$('hs-documents','site-specific','jgc-policy','jsa','toolbox-talk','accident-incident','daily-report','permit','inspection','notice-of-project','sds','other')$q$;
  new_list constant text := $q$('hs-documents','site-specific','jgc-policy','jsa','toolbox-talk','accident-incident','daily-report','permit','inspection','notice-of-project','sds','ontario-legislation','other')$q$;
begin
  foreach fn in array array['private.jgc_begin_job_board_upload(uuid,text,text,date,text,text,bigint,text)','private.jgc_update_job_board_document(uuid,text,date,text,text)'] loop
    d := pg_get_functiondef(fn::regprocedure);
    if (length(d) - length(replace(d, old_list, ''))) / length(old_list) <> 1 then
      raise exception '% does not contain the expected category list exactly once', fn;
    end if;
    execute replace(d, old_list, new_list);
  end loop;
end $$;
