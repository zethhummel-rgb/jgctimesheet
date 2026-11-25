import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { duration, type ScheduleTask } from '../lib/job-schedule';
import { useIsPhone } from './desk-shell';

export type ScheduleActivityAnchor = { element: HTMLButtonElement; offsetX: number | null };

export function ScheduleActivityDialog({ anchor, task, dates, phaseColor, predecessor, hasFollowers, canEdit, onProgress, onEdit, onDelete, onClose }: {
  anchor: ScheduleActivityAnchor;
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
  const phone = useIsPhone();
  const anchored = !phone && typeof anchor.element.showPopover === 'function';
  const progressId = useId();
  const modal = useRef<HTMLDialogElement>(null);
  const popover = useRef<HTMLDivElement>(null);
  const deleteButton = useRef<HTMLButtonElement>(null);
  const keepButton = useRef<HTMLButtonElement>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [progress, setProgress] = useState(task.progress?.toString() ?? '');
  const days = duration(task);
  const nextProgress = progress === '' ? null : Number(progress);
  const invalidProgress = nextProgress !== null && (!Number.isFinite(nextProgress) || nextProgress < 0 || nextProgress > 100);
  const previewProgress = invalidProgress ? task.progress : nextProgress;

  useLayoutEffect(() => {
    if (!anchored) {
      const dialog = modal.current!;
      dialog.showModal();
      return () => dialog.close();
    }

    const panel = popover.current!;
    const viewport = window.visualViewport;
    const gap = 8;
    function position() {
      if (!anchor.element.isConnected) {
        onClose();
        return;
      }
      const viewLeft = (viewport?.offsetLeft ?? 0) + gap;
      const viewTop = (viewport?.offsetTop ?? 0) + gap;
      const viewWidth = (viewport?.width ?? document.documentElement.clientWidth) - 2 * gap;
      const viewHeight = (viewport?.height ?? document.documentElement.clientHeight) - 2 * gap;
      panel.style.maxHeight = Math.max(1, viewHeight) + 'px';
      const { width, height } = panel.getBoundingClientRect();
      const target = anchor.element.getBoundingClientRect();
      const center = target.left + Math.max(0, Math.min(target.width, anchor.offsetX ?? target.width / 2));
      const above = target.top - gap - height;
      const below = target.bottom + gap;
      const top = above >= viewTop || target.top - viewTop > viewTop + viewHeight - target.bottom ? above : below;
      panel.style.left = Math.max(viewLeft, Math.min(center - width / 2, viewLeft + viewWidth - width)) + 'px';
      panel.style.top = Math.max(viewTop, Math.min(top, viewTop + viewHeight - height)) + 'px';
    }
    function dismissOutside(event: Event) {
      const target = event.target;
      if (target instanceof Node && (panel.contains(target) || anchor.element.contains(target))) return;
      onClose();
    }
    function repositionOnScroll(event: Event) {
      if (event.target instanceof Node && panel.contains(event.target)) return;
      position();
    }

    panel.showPopover();
    position();
    panel.focus({ preventScroll: true });
    const observer = new ResizeObserver(position);
    observer.observe(panel);
    const visibility = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) onClose();
    });
    visibility.observe(anchor.element);
    document.addEventListener('pointerdown', dismissOutside, true);
    document.addEventListener('focusin', dismissOutside);
    window.addEventListener('scroll', repositionOnScroll, true);
    window.addEventListener('resize', position);
    viewport?.addEventListener('resize', position);
    viewport?.addEventListener('scroll', position);
    return () => {
      observer.disconnect();
      visibility.disconnect();
      document.removeEventListener('pointerdown', dismissOutside, true);
      document.removeEventListener('focusin', dismissOutside);
      window.removeEventListener('scroll', repositionOnScroll, true);
      window.removeEventListener('resize', position);
      viewport?.removeEventListener('resize', position);
      viewport?.removeEventListener('scroll', position);
      if (panel.matches(':popover-open')) panel.hidePopover();
    };
  }, [anchor, anchored, onClose]);

  useEffect(() => {
    if (confirmDelete) keepButton.current?.focus();
  }, [confirmDelete]);

  function close() {
    if (anchored) {
      popover.current?.hidePopover();
      anchor.element.focus({ preventScroll: true });
    } else {
      modal.current?.close();
    }
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

  const facts = <>
    <dl className="schedule-activity-facts">
      <div><dt>Dates</dt><dd>{dates}</dd></div>
      <div><dt>Duration</dt><dd>{days} {task.calendar === 'weekdays' ? 'working' : 'calendar'} {days === 1 ? 'day' : 'days'}</dd></div>
      {task.owner && <div><dt>Responsibility / trade</dt><dd>{task.owner}</dd></div>}
      {predecessor && <div><dt>Starts after</dt><dd>{predecessor}</dd></div>}
    </dl>
    {task.notes && <section className="schedule-activity-notes"><h4>Notes</h4><p>{task.notes}</p></section>}
  </>;

  const content = <>
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
            {anchored ? <details className="schedule-activity-more"><summary>Details</summary>{facts}</details> : facts}
            <footer className="schedule-activity-actions">
              <button type="button" className="button secondary" disabled={!canEdit} onClick={() => { close(); onEdit(); }}>Edit activity</button>
              <button type="button" className="button secondary schedule-activity-delete" disabled={!canEdit} ref={deleteButton} onClick={() => setConfirmDelete(true)}>Delete activity</button>
            </footer>
          </>
        )}
      </div>
  </>;

  const className = 'schedule-modal schedule-dialog schedule-activity-dialog';
  return anchored ? (
    <div ref={popover} className={className + ' schedule-activity-popover'} role="dialog" aria-label="Activity details"
      popover="manual" tabIndex={-1} onKeyDown={event => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        if (confirmDelete) keepActivity();
        else close();
      }}>
      {content}
    </div>
  ) : (
    <dialog ref={modal} className={className} aria-label="Activity details" onClick={event => {
      if (event.target !== event.currentTarget) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) close();
    }} onCancel={event => {
      event.preventDefault();
      if (confirmDelete) keepActivity();
      else close();
    }}>
      {content}
    </dialog>
  );
}
