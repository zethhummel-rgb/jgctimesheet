import { useEffect, useId, useRef, useState } from 'react';
import { duration, type ScheduleTask } from '../lib/job-schedule';

export function ScheduleActivityDialog({ task, dates, phaseColor, predecessor, hasFollowers, canEdit, onProgress, onEdit, onDelete, onClose }: {
  task: ScheduleTask;
  dates: string;
  phaseColor: string;
  predecessor?: string;
  hasFollowers: boolean;
  canEdit: boolean;
  onProgress: (progress: number | null) => void;
  onEdit: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const progressId = useId();
  const ref = useRef<HTMLDialogElement>(null);
  const deleteButton = useRef<HTMLButtonElement>(null);
  const keepButton = useRef<HTMLButtonElement>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [progress, setProgress] = useState(task.progress?.toString() ?? '');
  const days = duration(task);
  const nextProgress = progress === '' ? null : Number(progress);
  const invalidProgress = nextProgress !== null && (!Number.isFinite(nextProgress) || nextProgress < 0 || nextProgress > 100);
  const previewProgress = invalidProgress ? task.progress : nextProgress;

  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);

  useEffect(() => {
    if (confirmDelete) keepButton.current?.focus();
  }, [confirmDelete]);

  function close() {
    ref.current?.close();
    onClose();
  }

  function keepActivity() {
    setConfirmDelete(false);
    requestAnimationFrame(() => deleteButton.current?.focus({ preventScroll: true }));
  }

  function saveProgress(value: number | null) {
    close();
    onProgress(value);
  }

  return (
    <dialog ref={ref} className="schedule-modal schedule-dialog schedule-activity-dialog" aria-label="Activity details" onClick={event => {
      if (event.target !== event.currentTarget) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) close();
    }} onCancel={event => {
      event.preventDefault();
      if (confirmDelete) keepActivity();
      else close();
    }}>
      <header>
        <div>
          <p className="schedule-activity-phase"><i aria-hidden="true" style={{ backgroundColor: phaseColor }} />{task.phase}</p>
          <h3>{task.name}</h3>
        </div>
        <button type="button" className="schedule-activity-close" aria-label="Close details" onClick={close}>×</button>
      </header>
      <div className="schedule-activity-body">
        {confirmDelete ? (
          <div className="schedule-activity-confirm">
            <h4>Delete this activity?</h4>
            <p>The activity will be removed from the working revision. Use Undo to restore it.</p>
            {hasFollowers && <p>Activities that start after this one will keep their dates and become independent.</p>}
            <footer>
              <button type="button" className="button secondary" ref={keepButton} onClick={keepActivity}>Keep activity</button>
              <button type="button" className="button schedule-activity-danger" disabled={!canEdit} onClick={() => { close(); onDelete(); }}>Delete activity</button>
            </footer>
          </div>
        ) : (
          <>
            <form className="schedule-activity-progress" onSubmit={event => {
              event.preventDefault();
              if (canEdit && !invalidProgress && nextProgress !== task.progress) saveProgress(nextProgress);
            }}>
              <div className="schedule-activity-progress-heading">
                <label htmlFor={progressId}>Progress <span className="schedule-sr-only">(%)</span></label>
                <button type="button" className="schedule-activity-mark" disabled={!canEdit || task.progress === 100} onClick={() => saveProgress(100)}>Mark 100%</button>
              </div>
              <div className="schedule-activity-progress-controls">
                <div className="schedule-activity-percent">
                  <input id={progressId} type="number" min="0" max="100" step="any" inputMode="decimal" value={progress} placeholder="Not entered"
                    disabled={!canEdit} aria-invalid={invalidProgress || undefined} onChange={event => setProgress(event.target.value)} />
                  <span aria-hidden="true">%</span>
                </div>
                <button type="submit" className="button primary" disabled={!canEdit || invalidProgress || nextProgress === task.progress}>Save progress</button>
              </div>
              <div className="schedule-activity-meter" aria-hidden="true"><span style={{ width: (previewProgress ?? 0) + '%' }} /></div>
              {invalidProgress && <p className="schedule-error" role="alert">Enter a percentage from 0 to 100.</p>}
            </form>
            {!canEdit && <p className="schedule-hint">Wait for All changes saved to make changes.</p>}
            <dl className="schedule-activity-facts">
              <div><dt>Dates</dt><dd>{dates}</dd></div>
              <div><dt>Duration</dt><dd>{days} {task.calendar === 'weekdays' ? 'working' : 'calendar'} {days === 1 ? 'day' : 'days'}</dd></div>
              {task.owner && <div><dt>Responsibility / trade</dt><dd>{task.owner}</dd></div>}
              {predecessor && <div><dt>Starts after</dt><dd>{predecessor}</dd></div>}
            </dl>
            {task.notes && <section className="schedule-activity-notes"><h4>Notes</h4><p>{task.notes}</p></section>}
            <footer className="schedule-activity-actions">
              <button type="button" className="button secondary" disabled={!canEdit} onClick={() => { close(); onEdit(); }}>Edit activity</button>
              <button type="button" className="button secondary schedule-activity-delete" disabled={!canEdit} ref={deleteButton} onClick={() => setConfirmDelete(true)}>Delete activity</button>
            </footer>
          </>
        )}
      </div>
    </dialog>
  );
}
