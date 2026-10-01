import { addDays, dateNumber, scheduleToday, scheduleRange, weekend, type ScheduleTask } from './job-schedule';

export type DateGesture = 'move' | 'start' | 'finish';
export type RowDrop = { id?: string; phase: string; after: boolean };

// Screen-only planning room. Stored dates and issued PDFs retain their actual range.
export function scheduleViewport(tasks: ScheduleTask[], preview?: ScheduleTask | null) {
  const actual = tasks.length? scheduleRange(tasks) : {start:dateNumber(preview?.start||''),finish:dateNumber(preview?.finish||'')};
  const starts = [actual.start, dateNumber(preview?.start || '')].filter(Number.isFinite);
  const finishes = [actual.finish, dateNumber(preview?.finish || '')].filter(Number.isFinite);
  const start = (starts.length?Math.min(...starts):dateNumber(scheduleToday())) - 2;
  const finish = (finishes.length?Math.max(...finishes):start+2) + 42;
  return { start, finish, days: finish - start + 1 };
}
export function resizeTaskDate(task: ScheduleTask, edge: 'start' | 'finish', delta: number) {
  const boundary = edge === 'start' ? task.finish : task.start;
  let value = addDays(task[edge], delta);
  value = edge === 'start' ? (value > boundary ? boundary : value) : (value < boundary ? boundary : value);
  if (task.calendar === 'weekdays') {
    while (weekend(dateNumber(value))) value = addDays(value, delta < 0 ? -1 : 1);
    value = edge === 'start' ? (value > boundary ? boundary : value) : (value < boundary ? boundary : value);
  }
  return { ...task, [edge]: value };
}
export function reorderTask(tasks: ScheduleTask[], taskId: string, target: RowDrop) {
  const task = tasks.find(t => t.id === taskId);
  if (!task || target.id === taskId) return tasks;
  const next = tasks.filter(t => t.id !== taskId);
  let index = target.id ? next.findIndex(t => t.id === target.id) : next.findIndex(t => t.phase === target.phase);
  if (index < 0) index = next.length;
  else if (target.id && target.after) index++;
  next.splice(index, 0, { ...task, phase: target.phase });
  return next;
}
