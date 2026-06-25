-- Adds optional audit fields for timesheet entries created by admins.
-- Run this once in the Supabase SQL editor.

alter table public.timesheet_entries
  add column if not exists admin_entered_by text,
  add column if not exists admin_entered_at timestamptz,
  add column if not exists admin_entry_note text;

