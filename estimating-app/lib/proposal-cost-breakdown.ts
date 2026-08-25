import {
  buildUpItemTotal,
  defaultProposalCostBreakdownCategories,
  lineDirectCost,
  lineSellPrice,
  quoteTotals,
  roundMoney,
  type AppState,
  type ProposalCostBreakdownCategory,
  type Quote,
  type QuoteLine,
} from "./estimator-data";

export interface ProposalCostBreakdownRow {
  key: string;
  category: ProposalCostBreakdownCategory | "john-gordon";
  label: string;
  amount: number;
}

export function selectedProposalCostBreakdownCategories(quote: Quote): ProposalCostBreakdownCategory[] {
  return Array.isArray(quote.proposalBreakdownCategories)
    ? quote.proposalBreakdownCategories
    : defaultProposalCostBreakdownCategories;
}

function subcontractorLabel(state: AppState, line: QuoteLine, fallback: string) {
  const typedName = line.vendorName?.trim() || "";
  const vendor = state.vendors.find((candidate) => candidate.id === line.vendorId)
    ?? state.vendors.find((candidate) => typedName && candidate.name.trim().toLocaleLowerCase() === typedName.toLocaleLowerCase());
  const name = typedName || vendor?.name.trim() || fallback.trim() || line.description.trim() || "Subcontractor";
  const trade = vendor?.trade?.trim() || "";
  return trade && trade.toLocaleLowerCase() !== name.toLocaleLowerCase() ? `${name} — ${trade}` : name;
}

export function proposalCostBreakdownRows(state: AppState, quote: Quote): ProposalCostBreakdownRow[] {
  const selected = new Set(selectedProposalCostBreakdownCategories(quote));
  const totals: Record<ProposalCostBreakdownCategory, number> = {
    labour: 0,
    materials: 0,
    subcontractors: 0,
    coordination: 0,
  };
  const individualSubcontractors = new Map<string, { label: string; amount: number }>();

  const addSubcontractor = (label: string, amount: number) => {
    if (amount <= 0) return;
    const normalized = label.trim().toLocaleLowerCase();
    const existing = individualSubcontractors.get(normalized) ?? { label, amount: 0 };
    existing.amount += amount;
    individualSubcontractors.set(normalized, existing);
  };

  quote.lines.filter((line) => line.included).forEach((line) => {
    const directTotal = lineDirectCost(line);
    const sellTotal = lineSellPrice(line, quote.defaultMarkup);
    if (sellTotal <= 0) return;
    if (directTotal <= 0) {
      totals.coordination += sellTotal;
      return;
    }

    const factor = sellTotal / directTotal;
    let allocatedSell = 0;
    const add = (category: ProposalCostBreakdownCategory, directAmount: number) => {
      const sellAmount = Math.max(0, directAmount) * factor;
      totals[category] += sellAmount;
      allocatedSell += sellAmount;
      return sellAmount;
    };

    if (line.costBuildUp) {
      line.costBuildUp.items.forEach((item) => {
        const directAmount = buildUpItemTotal(item) * Math.max(0, line.quantity || 0);
        if (item.kind === "Labour") add("labour", directAmount);
        else if (item.kind === "Material") add("materials", directAmount);
        else if (item.kind === "Subcontractor") {
          const sellAmount = add("subcontractors", directAmount);
          addSubcontractor(subcontractorLabel(state, line, item.description), sellAmount);
        } else add("coordination", directAmount);
      });
    } else if (line.costType === "Labour") add("labour", directTotal);
    else if (line.costType === "Material") add("materials", directTotal);
    else if (line.costType === "Sub / Vendor") {
      const sellAmount = add("subcontractors", directTotal);
      addSubcontractor(subcontractorLabel(state, line, line.description), sellAmount);
    } else if (line.costType === "Labour & Materials") {
      add("labour", directTotal / 2);
      add("materials", directTotal / 2);
    } else add("coordination", directTotal);

    const unallocatedSell = sellTotal - allocatedSell;
    if (unallocatedSell > 0.005) totals.coordination += unallocatedSell;
  });

  const rows: ProposalCostBreakdownRow[] = [];
  const addCombined = (category: ProposalCostBreakdownCategory, label: string) => {
    const amount = roundMoney(totals[category]);
    if (selected.has(category) && amount > 0) rows.push({ key: category, category, label, amount });
  };

  addCombined("labour", "Labour");
  addCombined("materials", "Materials");
  if (selected.has("subcontractors") && totals.subcontractors > 0) {
    if (quote.proposalSubcontractorBreakdownMode === "individual" && individualSubcontractors.size > 0) {
      [...individualSubcontractors.values()]
        .sort((left, right) => left.label.localeCompare(right.label, "en-CA"))
        .forEach((entry, index) => rows.push({ key: `subcontractor-${index}`, category: "subcontractors", label: entry.label, amount: roundMoney(entry.amount) }));
    } else {
      rows.push({ key: "subcontractors", category: "subcontractors", label: "Subcontractors", amount: roundMoney(totals.subcontractors) });
    }
  }
  addCombined("coordination", "Coordination");

  const proposalTotalCents = Math.round(quoteTotals(quote).subtotal * 100);
  let displayedTotalCents = rows.reduce((sum, row) => sum + Math.round(row.amount * 100), 0);

  // Independently rounded category/vendor rows can very rarely exceed the
  // proposal by a cent. Reduce the final visible row first so the customer
  // breakdown always reconciles exactly without displaying a negative balance.
  let overageCents = Math.max(0, displayedTotalCents - proposalTotalCents);
  for (let index = rows.length - 1; index >= 0 && overageCents > 0; index -= 1) {
    const rowCents = Math.round(rows[index].amount * 100);
    const correctionCents = Math.min(rowCents, overageCents);
    rows[index] = { ...rows[index], amount: (rowCents - correctionCents) / 100 };
    overageCents -= correctionCents;
  }
  const visibleRows = rows.filter((row) => row.amount > 0);
  displayedTotalCents = visibleRows.reduce((sum, row) => sum + Math.round(row.amount * 100), 0);
  const johnGordonCents = Math.max(0, proposalTotalCents - displayedTotalCents);
  if (johnGordonCents > 0) {
    visibleRows.push({
      key: "john-gordon",
      category: "john-gordon",
      label: "John Gordon",
      amount: johnGordonCents / 100,
    });
  }
  return visibleRows;
}
