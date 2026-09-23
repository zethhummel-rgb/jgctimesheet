import type { ShopDrawing, ShopDrawingEvent, ShopDrawingStatus } from "./estimator-data";

export const approvedShopDrawing = (status: ShopDrawingStatus) => status === "Approved" || status === "Approved as noted";
export function approvedDrawingFile(drawing: Partial<ShopDrawing>) {
  return drawing.status && approvedShopDrawing(drawing.status) ? drawing.approvedFileUrl || drawing.oneDriveUrl || "" : "";
}
export function drawingSnapshot(drawing: ShopDrawing) {
  const { revisions: _revisions, history: _history, sharedWithEmployees: _shared, ...snapshot } = drawing;
  return JSON.stringify(snapshot);
}
export function drawingRecord(snapshot: string): Partial<ShopDrawing> {
  try { const value = JSON.parse(snapshot); return value && typeof value === "object" && !Array.isArray(value) ? value as Partial<ShopDrawing> : {}; } catch { return {}; }
}

export function drawingHistory(previous: ShopDrawing | null | undefined, next: ShopDrawing, actor: string): ShopDrawingEvent[] {
  const history = [...(previous?.history ?? [])];
  if (previous && !history.length) history.push({
    id: `drawing-history-${crypto.randomUUID()}`, revision: previous.revision,
    recordedAt: previous.updatedAt || previous.createdAt, actor: "", action: "Existing record before tracking", snapshot: drawingSnapshot(previous),
  });
  history.push({
    id: `drawing-history-${crypto.randomUUID()}`, revision: next.revision, recordedAt: next.updatedAt, actor,
    action: !previous ? "Register item created" : previous.revision !== next.revision ? "New revision started" : previous.status !== next.status ? `${previous.status} → ${next.status}` : "Details updated",
    snapshot: drawingSnapshot(next),
  });
  return history;
}

export function validateDrawing(draft: Partial<ShopDrawing>, previous?: ShopDrawing | null, newRevision = false): string {
  const hasReview = ["Approved", "Approved as noted", "Revise and resubmit", "Rejected"].includes(draft.status || "");
  const sent = draft.status === "Submitted for review" || draft.status === "Under review";
  if (draft.status === "Requested from vendor" && !draft.requestedDate) return "Requested date is required.";
  if (draft.status === "Received from vendor" && !draft.receivedDate) return "Received date is required.";
  if (sent && !draft.submittedDate) return "Submitted date is required for a drawing sent for review.";
  if ((sent || hasReview) && !draft.consultant?.trim()) return "Recipient / reviewer is required.";
  if (hasReview && !draft.returnedDate) return "Reviewed date is required for a review decision.";
  if (["Approved as noted", "Revise and resubmit", "Rejected"].includes(draft.status || "") && !draft.reviewComments?.trim()) return "Reviewer comments are required for this decision.";
  const dates = [draft.requestedDate, draft.receivedDate, draft.submittedDate, draft.returnedDate].filter(Boolean) as string[];
  if (dates.some((date, i) => i > 0 && date < dates[i - 1])) return "Check the dates: requested, received, submitted and reviewed must follow that order.";
  if (draft.submittedDate && draft.dueDate && draft.dueDate < draft.submittedDate) return "The reviewer due date cannot be before submission.";
  if (previous && !newRevision && previous.oneDriveUrl && draft.oneDriveUrl !== previous.oneDriveUrl) return "This revision's file is preserved. Use Start next revision to replace it.";
  if (previous && !newRevision && previous.approvedFileUrl && draft.approvedFileUrl !== previous.approvedFileUrl) return "The approved-for-use file is preserved. Use Start next revision for a replacement.";
  if (previous && newRevision) {
    const oldFiles = [previous, ...previous.revisions.map(r => drawingRecord(r.snapshot))].flatMap(r => [r.oneDriveUrl, r.approvedFileUrl]).filter(Boolean);
    if ([draft.oneDriveUrl, draft.approvedFileUrl].some(link => link && oldFiles.includes(link))) return "Use a separate file link for the new revision. Earlier revision files must stay available.";
  }
  return "";
}
