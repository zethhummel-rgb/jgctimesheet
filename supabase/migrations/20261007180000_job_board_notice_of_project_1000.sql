-- Release 1000 (Zeth, 2026-10-07): "on the admin job board a spot that i can upload a notice of project ... one of
-- the drop down selectors to be Notice of Project. Also on the job board we would need a section like the existing
-- collapsed tabs to be marked Notice of Project".
--
-- Adds the 'notice-of-project' document category. Like other site postings it is public by default (the Notice of
-- Project is posted at the project). Nothing else about uploads, review or visibility changes.
alter table public.job_board_documents drop constraint job_board_documents_category_check;
alter table public.job_board_documents add constraint job_board_documents_category_check check (category = any (array[
  'hs-documents','site-specific','jgc-policy','jsa','toolbox-talk','accident-incident','daily-report','permit','inspection','notice-of-project','other']));

-- The upload and edit functions each validate the same category list; add the new category to both.
do $$
declare
  fn text;
  d text;
  old_list constant text := $q$('hs-documents','site-specific','jgc-policy','jsa','toolbox-talk','accident-incident','daily-report','permit','inspection','other')$q$;
  new_list constant text := $q$('hs-documents','site-specific','jgc-policy','jsa','toolbox-talk','accident-incident','daily-report','permit','inspection','notice-of-project','other')$q$;
begin
  foreach fn in array array['private.jgc_begin_job_board_upload(uuid,text,text,date,text,text,bigint,text)','private.jgc_update_job_board_document(uuid,text,date,text,text)'] loop
    d := pg_get_functiondef(fn::regprocedure);
    if (length(d) - length(replace(d, old_list, ''))) / length(old_list) <> 1 then
      raise exception '% does not contain the category list exactly once', fn;
    end if;
    execute replace(d, old_list, new_list);
  end loop;
end $$;
