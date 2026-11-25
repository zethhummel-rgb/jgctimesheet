import { useEffect, useId, useRef, useState } from 'react';
import {
  dateNumber, dateString, formatScheduleDates, fullSchedulePdfRange, schedulePdfPeriod, scheduleRange, scheduleToday,
  type PdfPeriod, type SchedulePdfRange, type ScheduleTask
} from '../lib/job-schedule';

const choices = [
  { value: 'Full schedule', label: 'Full schedule' },
  { value: 'Daily', label: 'Day' },
  { value: 'Weekly', label: 'Week' },
  { value: 'Monthly', label: 'Month' },
  { value: 'Yearly', label: 'Year' },
  { value: 'Custom', label: 'Custom dates' }
] as const;

const periodNavigation = {
  Daily: { unit: 'day', current: 'Today' },
  Weekly: { unit: 'week', current: 'This week' },
  Monthly: { unit: 'month', current: 'This month' },
  Yearly: { unit: 'year', current: 'This year' }
} as const;
const monthFormat = new Intl.DateTimeFormat('en-CA', { month: 'long', timeZone: 'UTC' });
const months = Array.from({ length: 12 }, (_, i) => ({
  value: String(i + 1).padStart(2, '0'),
  label: monthFormat.format(new Date(Date.UTC(2026, i, 1)))
}));

export function SchedulePdfDialog({ tasks, draft, locksRevision, busy, onDownload, onClose }: {
  tasks: ScheduleTask[];
  draft: boolean;
  locksRevision: boolean;
  busy: boolean;
  onDownload: (range: SchedulePdfRange | undefined) => Promise<void>;
  onClose: () => void;
}) {
  const id = useId();
  const ref = useRef<HTMLDialogElement>(null);
  const [period, setPeriod] = useState<PdfPeriod>('Full schedule');
  const today = scheduleToday();
  const [day, setDay] = useState(today);
  const [month, setMonth] = useState(today.slice(5, 7));
  const [year, setYear] = useState(today.slice(0, 4));
  const [start, setStart] = useState(today);
  const [end, setEnd] = useState(today);
  const [downloadError, setDownloadError] = useState('');

  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);

  const monthOrYear = period === 'Monthly' || period === 'Yearly';
  const custom = period === 'Custom';
  const nav = period === 'Full schedule' || custom ? undefined : periodNavigation[period];
  let selected: SchedulePdfRange | undefined;
  let preview: SchedulePdfRange | undefined;
  let dateError = '';
  try {
    if (monthOrYear && (!/^\d{1,4}$/.test(year) || Number(year) < 1)) {
      throw new Error('Enter a year from 1 to 9999.');
    }
    const anchor = monthOrYear ? year.padStart(4, '0') + '-' + month + '-01' : custom ? start : day;
    selected = schedulePdfPeriod(period, anchor, end);
    preview = selected ?? fullSchedulePdfRange(scheduleRange(tasks));
  } catch (error) {
    dateError = error instanceof Error ? error.message : 'Choose a valid date range.';
  }
  const count = preview ? tasks.filter(t => dateNumber(t.start) <= preview.finish && dateNumber(t.finish) >= preview.start).length : 0;

  function browse(value: string) {
    if (monthOrYear) {
      setMonth(value.slice(5, 7));
      setYear(value.slice(0, 4));
    } else {
      setDay(value);
    }
  }

  function close() {
    ref.current?.close();
    onClose();
  }

  async function download() {
    if (!preview || busy) return;
    setDownloadError('');
    try {
      await onDownload(selected);
      close();
    } catch (error) {
      setDownloadError(error instanceof Error ? error.message : 'The PDF could not be created.');
    }
  }

  return (
    <dialog ref={ref} className="schedule-modal schedule-dialog schedule-pdf-dialog" aria-labelledby={id + '-title'} onCancel={event => {
      event.preventDefault();
      if (!busy) close();
    }}>
      <header>
        <h2 id={id + '-title'}>{draft ? 'Download draft PDF' : 'Download schedule PDF'}</h2>
      </header>
      <fieldset className="schedule-pdf-choices" disabled={busy}>
        <legend>Choose a date range</legend>
        <div className="schedule-pdf-options">
          {choices.map(({ value, label }) => (
            <label key={value}>
              <input type="radio" name={id + '-range'} value={value} checked={period === value} onChange={() => { setPeriod(value); setDownloadError(''); }} />
              <span>{label}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="schedule-pdf-preview">
        {nav && (
          <button type="button" className="button secondary schedule-pdf-arrow" aria-label={'Previous ' + nav.unit}
            disabled={busy || !selected || selected.start <= dateNumber('0001-01-01')}
            onClick={() => browse(dateString(selected!.start - 1))}>‹</button>
        )}
        <div className="schedule-pdf-includes" aria-live="polite" aria-atomic="true">
          <span>Dates in this PDF</span>
          {preview ? <>
            <strong>{formatScheduleDates(preview)}</strong>
            <small>{count === 0 ? 'No activities scheduled in this range' : count + (count === 1 ? ' activity' : ' activities')}</small>
          </> : <strong className="schedule-error">{dateError}</strong>}
        </div>
        {nav && (
          <button type="button" className="button secondary schedule-pdf-arrow" aria-label={'Next ' + nav.unit}
            disabled={busy || !selected || selected.finish >= dateNumber('9999-12-31')}
            onClick={() => browse(dateString(selected!.finish + 1))}>›</button>
        )}
      </div>

      {(nav || custom) && (
        <div className="schedule-pdf-fields">
          {(period === 'Daily' || period === 'Weekly') && (
            <label className="field">
              <span>{period === 'Weekly' ? 'Jump to a week' : 'Date'}</span>
              <input type="date" value={day} disabled={busy}
                aria-describedby={period === 'Weekly' ? id + '-week' : undefined}
                onChange={event => setDay(event.target.value)} />
            </label>
          )}
          {period === 'Monthly' && (
            <label className="field">
              <span>Month</span>
              <select value={month} disabled={busy} onChange={event => setMonth(event.target.value)}>
                {months.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
          )}
          {monthOrYear && (
            <label className="field">
              <span>Year</span>
              <input type="number" inputMode="numeric" min="1" max="9999" value={year} disabled={busy} onChange={event => setYear(event.target.value)} />
            </label>
          )}
          {custom && <>
            <label className="field">
              <span>Start date</span>
              <input type="date" disabled={busy} value={start} onChange={event => {
                const value = event.target.value;
                setStart(value);
                if (value && value > end) setEnd(value);
              }} />
            </label>
            <label className="field">
              <span>End date</span>
              <input type="date" disabled={busy} value={end} min={start || undefined} onChange={event => setEnd(event.target.value)} />
            </label>
          </>}
          {nav && <button type="button" className="button secondary schedule-pdf-current" disabled={busy} onClick={() => browse(today)}>{nav.current}</button>}
        </div>
      )}
      {period === 'Weekly' && <p id={id + '-week'} className="schedule-hint">Pick any date in the week. Weeks run Sunday to Saturday.</p>}
      {downloadError && <p className="schedule-error" role="alert">{downloadError}</p>}
      {locksRevision && <p className="schedule-hint">Downloading locks this revision. Your next edit starts a new one.</p>}
      <footer>
        <button type="button" className="button secondary" onClick={close} disabled={busy}>Cancel</button>
        <button type="button" className="button primary" onClick={() => void download()} disabled={busy || !preview}>
          {busy ? 'Creating PDF…' : 'Download PDF'}
        </button>
      </footer>
    </dialog>
  );
}
