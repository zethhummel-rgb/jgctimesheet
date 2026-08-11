alter function public.accounting_autofill_leave_timesheet(uuid, date, text[], text, text, text)
  security invoker;

comment on function public.accounting_autofill_leave_timesheet(uuid, date, text[], text, text, text)
  is 'Approved Accounting administrators can fill missing weekdays and submit a completed employee timesheet atomically, with every table operation enforced by existing RLS policies.';
