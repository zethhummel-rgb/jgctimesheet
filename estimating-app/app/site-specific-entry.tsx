import { useLayoutEffect, useRef, type TextareaHTMLAttributes } from 'react';
import type { SafetyField } from '../lib/site-specific';

export function DocumentText(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => { el.style.height = 'auto'; el.style.height = `${el.scrollHeight + 2}px`; };
    fit();
    let width = el.clientWidth;
    const observer = new ResizeObserver(() => { if (el.clientWidth !== width) { width = el.clientWidth; fit(); } });
    observer.observe(el);
    return () => observer.disconnect();
  }, [props.value]);
  return <textarea {...props} ref={ref} rows={1} className={`ss-document-text ${props.className || ''}`} />;
}

export function DocumentFields({fields, onChange}: {fields: SafetyField[]; onChange: (fields: SafetyField[]) => void}) {
  return <div className="ss-document-fields">{fields.map((field, index) => <section className="ss-document-field" key={field.id}>
    <div className="ss-document-label"><input aria-label={`Field ${index + 1} heading`} value={field.label} maxLength={200} onChange={e => onChange(fields.map(f => f.id === field.id ? {...f, label:e.target.value} : f))} /></div>
    <DocumentText aria-label={field.label} placeholder={`Enter ${field.label.toLowerCase()}…`} maxLength={20000} value={field.value} onChange={e => onChange(fields.map(f => f.id === field.id ? {...f, value:e.target.value} : f))} />
  </section>)}</div>;
}
