import type { AppState, Job } from "./estimator-data";

export function nextSubcontractPurchaseOrderNumber(job: Job): string {
  const prefix = job.jobNumber.trim() + "-";
  const occupied = new Set((job.purchaseOrders ?? []).map(order => order.number.trim().toUpperCase()));
  let sequence = 1;
  for (const number of occupied) {
    if (!number.startsWith(prefix.toUpperCase())) continue;
    const suffix = number.slice(prefix.length);
    if (/^[0-9]+$/.test(suffix)) sequence = Math.max(sequence, Number(suffix) + 1);
  }
  return prefix + String(sequence).padStart(3, "0");
}

// A newly created order may be renumbered while its first save is pending.
export function resolveNewPurchaseOrderNumbers(saved: AppState, incoming: AppState): AppState {
  let changed = false;
  const renamed: Array<{ previous: string; number: string; vendor: string }> = [];
  const savedActivityIds = new Set(saved.activity.map(item => item.id));
  const jobs = incoming.jobs.map(job => {
    const existing = saved.jobs.find(item => item.id === job.id);
    const savedIds = new Set((existing?.purchaseOrders ?? []).map(order => order.id));
    const newOrders = (job.purchaseOrders ?? []).filter(order => !savedIds.has(order.id));
    const newIds = new Set(newOrders.map(order => order.id));
    const usedOrders = (job.purchaseOrders ?? []).filter(order => !newIds.has(order.id));
    const numbers = new Map<string, string>();
    for (const order of newOrders) {
      let number = order.number;
      if (usedOrders.some(item => item.number.trim().toUpperCase() === number.trim().toUpperCase())) {
        number = nextSubcontractPurchaseOrderNumber({ ...job, purchaseOrders: usedOrders });
        renamed.push({ previous: order.number, number, vendor: order.vendorName });
        changed = true;
      }
      numbers.set(order.id, number);
      usedOrders.push({ ...order, number });
    }
    if (!newOrders.some(order => numbers.get(order.id) !== order.number)) return job;
    return { ...job, purchaseOrders: (job.purchaseOrders ?? []).map(order => ({ ...order, number: numbers.get(order.id) ?? order.number })) };
  });
  if (!changed) return incoming;
  return {
    ...incoming,
    jobs,
    activity: incoming.activity.map(item => {
      if (savedActivityIds.has(item.id) || item.title !== "Final purchase order created") return item;
      const rename = renamed.find(order => item.detail.startsWith(order.previous + " Rev ") && item.detail.includes(" for " + order.vendor));
      return rename ? { ...item, detail: rename.number + item.detail.slice(rename.previous.length) } : item;
    }),
  };
}
