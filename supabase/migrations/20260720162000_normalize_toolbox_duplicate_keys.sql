drop index if exists public.toolbox_talk_reports_unique_submission_idx;

with ranked_reports as (
    select
        id,
        row_number() over (
            partition by
                coalesce(talk_id, '00000000-0000-0000-0000-000000000000'::uuid),
                report_date,
                lower(regexp_replace(btrim(coalesce(project, '')), '[[:space:]]+', ' ', 'g')),
                lower(regexp_replace(btrim(coalesce(presenter_name, '')), '[[:space:]]+', ' ', 'g'))
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

create unique index toolbox_talk_reports_unique_submission_idx
    on public.toolbox_talk_reports (
        coalesce(talk_id, '00000000-0000-0000-0000-000000000000'::uuid),
        report_date,
        lower(regexp_replace(btrim(coalesce(project, '')), '[[:space:]]+', ' ', 'g')),
        lower(regexp_replace(btrim(coalesce(presenter_name, '')), '[[:space:]]+', ' ', 'g'))
    )
    where is_duplicate = false;
