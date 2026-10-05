import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { AppState, Job } from '../lib/estimator-data';
import { SiteSpecificBuilder } from './site-specific-builder';
import { JobBoard } from './job-board';
import './job-safety.css';

const sections = [
  { key: 'job-board', label: 'Job Board' },
  { key: 'create-site-specific', label: 'Create Site Specific' },
] as const;
type SafetySection = typeof sections[number]['key'];

export function JobSafety({ job, active, state, setState, actor, workspaceSaved }: { job: Job; active: boolean; state: AppState; setState: React.Dispatch<React.SetStateAction<AppState>>; actor: string; workspaceSaved: boolean }) {
  const [section, setSection] = useState<SafetySection>('job-board');
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const baseId = `safety-${job.id.replace(/[^a-zA-Z0-9_-]/g, '-') || 'selected'}`;
  useEffect(() => {
    const refresh = (event: Event) => {
      if ((event as CustomEvent).detail?.jobId !== job.id) return;
      document.querySelectorAll<HTMLIFrameElement>('.job-safety iframe').forEach(frame => {
        const src = new URL(frame.src, document.baseURI);
        if (src.origin === location.origin && src.searchParams.get('job') === job.id) frame.contentWindow?.postMessage({ type: 'jgc-job-board-refresh', jobId: job.id }, location.origin);
      });
    };
    window.addEventListener('jgc-site-plan-published', refresh);
    return () => window.removeEventListener('jgc-site-plan-published', refresh);
  }, [job.id]);

  function navigate(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next: number;
    if (event.key === 'ArrowRight') next = (index + 1) % sections.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + sections.length) % sections.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = sections.length - 1;
    else return;
    event.preventDefault();
    setSection(sections[next].key);
    tabs.current[next]?.focus();
  }

  return <section className="job-safety" hidden={!active} aria-label={`Safety for job ${job.jobNumber}`}>
    <nav className="quote-tabs job-safety-tabs" role="tablist" aria-label="Safety sections" aria-orientation="horizontal">
      {sections.map(({ key, label }, index) => <button
        key={key}
        ref={(element) => { tabs.current[index] = element; }}
        id={`${baseId}-tab-${key}`}
        type="button"
        role="tab"
        aria-selected={section === key}
        aria-controls={`${baseId}-panel-${key}`}
        tabIndex={section === key ? 0 : -1}
        className={section === key ? 'active' : ''}
        onClick={() => setSection(key)}
        onKeyDown={(event) => navigate(event, index)}
      >{label}</button>)}
    </nav>
    <div id={`${baseId}-panel-job-board`} role="tabpanel" aria-labelledby={`${baseId}-tab-job-board`} hidden={section !== 'job-board'}>
      <JobBoard job={job} active={active && section === 'job-board'} />
    </div>
    <section id={`${baseId}-panel-create-site-specific`} role="tabpanel" aria-labelledby={`${baseId}-tab-create-site-specific`} hidden={section !== 'create-site-specific'}>
      <SiteSpecificBuilder job={job} state={state} setState={setState} actor={actor} workspaceSaved={workspaceSaved} />
    </section>
  </section>;
}
