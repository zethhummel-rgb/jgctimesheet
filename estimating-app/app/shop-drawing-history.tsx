import type { ShopDrawing } from "../lib/estimator-data";
import { approvedDrawingFile, drawingRecord } from "../lib/shop-drawing-workflow";

const safeLink = (value?: string) => { try { return new URL(value || "").protocol === "https:" ? value : ""; } catch { return ""; } };
const date = (value?: string) => value ? new Date(value.length === 10 ? value + "T12:00:00" : value).toLocaleDateString("en-CA", { year: "numeric", month: "short", day: "numeric" }) : "Not recorded";

export function ShopDrawingHistory({ drawing }: { drawing: ShopDrawing }) {
  return <section className="shop-review-history" aria-label="Drawing revision and review history">
    <details className="shop-drawing-history">
      <summary>Revision history ({drawing.revisions.length})</summary>
      <p>Current: Rev {drawing.revision} · {drawing.revision} revision {drawing.revision === 1 ? "cycle" : "cycles"}. Earlier revisions are retained for reference and are superseded.</p>
      {drawing.revisions.slice().sort((a, b) => a.revision - b.revision).map(revision => {
        const item = drawingRecord(revision.snapshot), original = safeLink(item.oneDriveUrl), approved = safeLink(approvedDrawingFile(item));
        return <article className="shop-revision-record" key={revision.id}>
          <header><strong>{drawing.number} · Rev {revision.revision}</strong><span>Superseded · {item.status || "Saved revision"}</span></header>
          <dl className="shop-review-dates">{[["Requested", item.requestedDate], ["Received", item.receivedDate], ["Submitted", item.submittedDate], ["Reviewed", item.returnedDate]].map(([label,value]) => <div key={label}><dt>{label}</dt><dd>{date(value)}</dd></div>)}</dl>
          <p><strong>Reviewer:</strong> {item.consultant || "Not recorded"}</p>
          {item.reviewComments && <p className="shop-history-comment"><strong>Review comments:</strong> {item.reviewComments}</p>}
          {item.notes && <p className="shop-history-comment"><strong>Internal notes:</strong> {item.notes}</p>}
          <div className="shop-history-links">{original && <a className="button secondary compact" href={original} target="_blank" rel="noreferrer">Open Rev {revision.revision} submission ↗</a>}{approved && <a className="button secondary compact" href={approved} target="_blank" rel="noreferrer">Open archived review file ↗</a>}</div>
        </article>;
      })}
      {!drawing.revisions.length && <p>This is the original submission. No revision cycles yet.</p>}
    </details>
    <details className="shop-review-timeline" open>
      <summary>Chronological review history</summary>
      <ol>{(drawing.history ?? []).slice().sort((a,b) => a.recordedAt.localeCompare(b.recordedAt)).map(event => {
        const item = drawingRecord(event.snapshot), file = safeLink(item.oneDriveUrl), approved = safeLink(approvedDrawingFile(item));
        return <li key={event.id}><div><strong>Rev {event.revision} · {event.action}</strong><small>{new Date(event.recordedAt).toLocaleString("en-CA")}{event.actor ? ` · ${event.actor}` : ""}</small></div>
          <details><summary>View recorded details</summary>
            <dl className="shop-review-dates">{[["Requested",item.requestedDate],["Received",item.receivedDate],["Submitted",item.submittedDate],["Reviewed",item.returnedDate]].map(([label,value]) => <div key={label}><dt>{label}</dt><dd>{date(value)}</dd></div>)}</dl>
            <p>Reviewer: {item.consultant || "Not recorded"} · Status: {item.status}</p>
            {item.reviewComments && <p className="shop-history-comment">{item.reviewComments}</p>}
            {item.notes && <p className="shop-history-comment">Internal notes: {item.notes}</p>}
            <div className="shop-history-links">{file && <a href={file} target="_blank" rel="noreferrer">Recorded submission ↗</a>}{approved && <a href={approved} target="_blank" rel="noreferrer">Recorded approved file ↗</a>}</div>
          </details>
        </li>;
      })}</ol>
      {!drawing.history?.length && <p>Detailed tracking begins with the next saved update. Existing revision records remain above.</p>}
    </details>
  </section>;
}
