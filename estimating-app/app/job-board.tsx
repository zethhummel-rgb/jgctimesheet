import { useEffect, useRef, useState } from 'react';
import type { Job } from '../lib/estimator-data';
import './job-board.css';

export function JobBoard({ job, active }: { job: Job; active: boolean }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [opened, setOpened] = useState(active);
  const [height, setHeight] = useState(1000);
  useEffect(() => { if (active) setOpened(true); }, [active]);
  useEffect(() => {
    function resize(event: MessageEvent) {
      if (event.origin !== window.location.origin || event.source !== frame.current?.contentWindow || event.data?.type !== 'jgc-job-board-height') return;
      const value = Number(event.data.height);
      if (Number.isFinite(value)) setHeight(Math.max(600, Math.min(16000, value)));
    }
    window.addEventListener('message', resize);
    return () => window.removeEventListener('message', resize);
  }, []);
  if (!opened) return null;
  const url = new URL('../job-board.html', window.location.href);
  url.search = new URLSearchParams({ job: job.id, manage: '1', embedded: '1' }).toString();
  return <section className="job-board-embed" hidden={!active} aria-label={`Job ${job.jobNumber} board`}>
    <iframe ref={frame} title={`Job ${job.jobNumber} Board`} src={url.href} style={{ height }} allow="clipboard-write" />
  </section>;
}
