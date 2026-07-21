alter table public.toolbox_talk_reports
    add column if not exists is_duplicate boolean not null default false;

with ranked_reports as (
    select
        id,
        row_number() over (
            partition by
                coalesce(talk_id, '00000000-0000-0000-0000-000000000000'::uuid),
                report_date,
                lower(btrim(coalesce(project, ''))),
                lower(btrim(coalesce(presenter_name, '')))
            order by created_at, id
        ) as duplicate_rank
    from public.toolbox_talk_reports
    where is_duplicate = false
)
update public.toolbox_talk_reports as report
set is_duplicate = true
from ranked_reports
where report.id = ranked_reports.id
  and ranked_reports.duplicate_rank > 1;

create unique index if not exists toolbox_talk_reports_unique_submission_idx
    on public.toolbox_talk_reports (
        coalesce(talk_id, '00000000-0000-0000-0000-000000000000'::uuid),
        report_date,
        lower(btrim(coalesce(project, ''))),
        lower(btrim(coalesce(presenter_name, '')))
    )
    where is_duplicate = false;

create or replace function private.preserve_toolbox_report_duplicate_flag()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    if tg_op = 'INSERT' then
        new.is_duplicate := false;
    elsif new.is_duplicate is distinct from old.is_duplicate then
        new.is_duplicate := old.is_duplicate;
    end if;

    return new;
end;
$$;

drop trigger if exists preserve_toolbox_report_duplicate_flag
    on public.toolbox_talk_reports;

create trigger preserve_toolbox_report_duplicate_flag
before insert or update of is_duplicate
on public.toolbox_talk_reports
for each row
execute function private.preserve_toolbox_report_duplicate_flag();

comment on column public.toolbox_talk_reports.is_duplicate is
    'Marks preserved duplicate submissions that are hidden from normal report lists.';
