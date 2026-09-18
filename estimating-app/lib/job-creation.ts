import { quoteTotals, type AppState, type Client, type Job } from "./estimator-data";

export interface JobCreationDraft {
  quoteId: string; jobName: string; clientId: string; site: string; address: string; attention: string;
  clientReference: string; jobType: "Contract" | "T&M"; value: string; subcontractors: "Yes" | "No";
  jobDate: string; startDate: string; targetEndDate: string; manager: string; documents: string; notes: string;
}

/** Number/date/identity are assigned by the database, never by this draft. */
export function prepareJobCreation(state: AppState, draft: JobCreationDraft, client: Client): Partial<Job> {
  const quote = state.quotes.find((item) => item.id === draft.quoteId);
  if (draft.quoteId && (!quote || quote.status !== "Finished" || quote.documentKind === "Change Notice" || state.jobs.some((job) => job.quoteId === quote.id))) {
    throw new Error("This quote is no longer available to make into a job. Refresh the job list.");
  }
  if (!draft.jobName.trim() || !client?.name?.trim() || !draft.manager.trim() || !["Contract", "T&M"].includes(draft.jobType)) throw new Error("This information is required.");
  if (quote && quote.clientId !== client.id) throw new Error("The selected quote belongs to another client.");
  const totals = quote ? quoteTotals(quote) : null;
  const value = totals?.subtotal ?? (draft.value.trim() ? Number(draft.value) : null);
  if ((draft.jobType === "Contract" && value === null) || (value !== null && (!Number.isFinite(value) || value < 0))) throw new Error("Enter the customer quoted price before tax.");
  return {
    quoteId: quote?.id || "", clientId: client.id, project: draft.jobName.trim(), jobType: draft.jobType,
    projectManager: draft.manager.trim(), portalCustomer: client.name.trim(), portalAddress: draft.address.trim(),
    portalSiteName: draft.site.trim(), startDate: draft.startDate, targetEndDate: draft.targetEndDate,
    documentLink: draft.documents.trim(), documentLinkLabel: "Open Project Documents",
    acceptedRevenue: value ?? 0, hasQuotedValue: value !== null, originalCostBudget: totals?.directCost ?? 0,
    acceptedQuoteRevision: quote?.revision, acceptedQuoteSnapshot: quote ? JSON.stringify({ ...quote, revisions: [] }) : "",
    approvedRevenueChanges: 0, approvedCostChanges: 0, estimateToComplete: totals?.directCost ?? 0,
    clientReference: draft.clientReference.trim(), attention: draft.attention.trim(), subcontractors: draft.subcontractors,
    costs: [], purchaseOrders: [], shopDrawings: [], documentLinks: [], notes: draft.notes.trim(),
  };
}
