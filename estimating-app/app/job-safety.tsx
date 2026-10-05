import { useRef, useState, type KeyboardEvent } from 'react';
import type { Job } from '../lib/estimator-data';
import { JobBoard } from './job-board';
import './job-safety.css';

const sections = [
  { key: 'job-board', label: 'Job Board' },
  { key: 'create-site-specific', label: 'Create Site Specific' },
] as const;
type SafetySection = typeof sections[number]['key'];

export function JobSafety({ job, active }: { job: Job; active: boolean }) {
  const [section, setSection] = useState<SafetySection>('job-board');
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const baseId = `safety-${job.id.replace(/[^a-zA-Z0-9_-]/g, '-') || 'selected'}`;

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
    <section className="panel job-site-specific" id={`${baseId}-panel-create-site-specific`} role="tabpanel" aria-labelledby={`${baseId}-tab-create-site-specific`} hidden={section !== 'create-site-specific'}>
      <div className="panel-heading">
        <div><span className="eyebrow">JOB {job.jobNumber} · SAFETY</span><h2>Create Site Specific</h2><p>Prepare a JGC-branded site-specific safety plan for {job.project}.</p></div>
      </div>
      <div className="site-specific-setup">
        <h3>Plan template setup</h3>
        <p>Your plan template will be defined here next, with these areas:</p>
        <dl>
          <div><dt>Plan pages</dt><dd>Job details, contacts, site risks and emergency information, with pages you can include or leave out.</dd></div>
          <div><dt>Task and procedure library</dt><dd>Saved pages for different tasks, procedures and risks that can be reused in a job's plan.</dd></div>
          <div><dt>Supporting documents</dt><dd>Portal certificates, standard JSAs, the full JGC policy and additional forms or pages, combined into one PDF when needed.</dd></div>
        </dl>
        <p className="site-specific-pending" role="status">Document creation will be available after the template is defined.</p>
      </div>
    </section>
  </section>;
}
