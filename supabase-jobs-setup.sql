alter table public.jobs
  add column if not exists document_link text,
  add column if not exists document_link_label text;

comment on column public.jobs.document_link is 'Optional OneDrive or document URL for drawings/job documents shown on Job Dashboard and employee Jobs page.';
comment on column public.jobs.document_link_label is 'Optional display label for the job document link.';
