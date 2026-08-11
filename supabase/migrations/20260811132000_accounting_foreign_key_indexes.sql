create index if not exists accounting_employee_rates_created_by_idx
  on public.accounting_employee_rates (created_by);

create index if not exists accounting_employee_settings_created_by_idx
  on public.accounting_employee_settings (created_by);

create index if not exists accounting_employee_settings_updated_by_idx
  on public.accounting_employee_settings (updated_by);

create index if not exists accounting_exports_exported_by_idx
  on public.accounting_exports (exported_by);

create index if not exists accounting_pay_periods_created_by_idx
  on public.accounting_pay_periods (created_by);

create index if not exists accounting_pay_periods_locked_by_idx
  on public.accounting_pay_periods (locked_by)
  where locked_by is not null;

create index if not exists accounting_pay_periods_updated_by_idx
  on public.accounting_pay_periods (updated_by)
  where updated_by is not null;

create index if not exists accounting_period_inputs_updated_by_idx
  on public.accounting_period_employee_inputs (updated_by);

create index if not exists accounting_entries_job_matched_by_idx
  on public.accounting_time_entries (job_matched_by)
  where job_matched_by is not null;

create index if not exists accounting_entries_profile_id_idx
  on public.accounting_time_entries (profile_id);

create index if not exists accounting_submissions_profile_id_idx
  on public.accounting_timesheet_submissions (profile_id);

create index if not exists accounting_workbook_templates_uploaded_by_idx
  on public.accounting_workbook_templates (uploaded_by);
