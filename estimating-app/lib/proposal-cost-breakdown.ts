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
  category: ProposalCostBreakdownCategory | "line-item" | "general-conditions";
  label: string;
  amount: number;
}

export interface ProposalCostBreakdownLineOption {
  id: string;
  label: string;
  amount: number;
  costType: QuoteLine["costType"];
  subcontractor: boolean;
}

export function selectedProposalCostBreakdownCategories(quote: Quote): ProposalCostBreakdownCategory[] {
  return Array.isArray(quote.proposalBreakdownCategories)
    ? quote.proposalBreakdownCategories
    : defaultProposalCostBreakdownCategories;
}

function isSubcontractorLine(line: QuoteLine) {
  if (line.costType === "Sub / Vendor") return true;
  const items = line.costBuildUp?.items ?? [];
  return items.length > 0 && items.every((item) => item.kind === "Subcontractor");
}

function subcontractorLabel(state: AppState, line: QuoteLine) {
  const typedName = line.vendorName?.trim() || "";
  const vendor = state.vendors.find((candidate) => candidate.id === line.vendorId)
    ?? state.vendors.find((candidate) => typedName && candidate.name.trim().toLocaleLowerCase() === typedName.toLocaleLowerCase());
  const description = line.description.trim();
  const buildUpWork = line.costBuildUp?.items.find((item) => item.kind === "Subcontractor")?.description.trim() || "";
  const name = typedName || vendor?.name.trim() || description || "Subcontractor";
  const work = vendor?.trade?.trim()
    || (description && description.toLocaleLowerCase() !== name.toLocaleLowerCase() ? description : "")
    || buildUpWork;
  return work && work.toLocaleLowerCase() !== name.toLocaleLowerCase() ? `${name} — ${work}` : name;
}

export function proposalCostBreakdownLineOptions(state: AppState, quote: Quote): ProposalCostBreakdownLineOption[] {
  return quote.lines
    .filter((line) => line.included && lineSellPrice(line, quote.defaultMarkup) > 0)
    .map((line) => {
      const subcontractor = isSubcontractorLine(line);
      return {
        id: line.id,
        label: subcontractor ? subcontractorLabel(state, line) : line.description.trim() || line.costType,
        amount: lineSellPrice(line, quote.defaultMarkup),
        costType: line.costType,
        subcontractor,
      };
    });
}

export function selectedProposalCostBreakdownLineIds(quote: Quote): string[] {
  const availableLineIds = new Set(quote.lines.filter((line) => line.included && lineSellPrice(line, quote.defaultMarkup) > 0).map((line) => line.id));
  if (Array.isArray(quote.proposalBreakdownLineIds)) {
    return [...new Set(quote.proposalBreakdownLineIds.filter((lineId) => availableLineIds.has(lineId)))];
  }

  // Preserve older quotes that used the former individual-subcontractor mode.
  if (quote.proposalSubcontractorBreakdownMode === "individual" && selectedProposalCostBreakdownCategories(quote).includes("subcontractors")) {
    return quote.lines.filter((line) => availableLineIds.has(line.id) && isSubcontractorLine(line)).map((line) => line.id);
  }
  return [];
}

export function proposalCostBreakdownRows(state: AppState, quote: Quote): ProposalCostBreakdownRow[] {
  const selected = new Set(selectedProposalCostBreakdownCategories(quote));
  const selectedLineIds = new Set(selectedProposalCostBreakdownLineIds(quote));
  const lineOptions = proposalCostBreakdownLineOptions(state, quote);
  const totals: Record<ProposalCostBreakdownCategory, number> = {
    labour: 0,
    materials: 0,
    subcontractors: 0,
    coordination: 0,
  };
  quote.lines.filter((line) => line.included && !selectedLineIds.has(line.id)).forEach((line) => {
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
        else if (item.kind === "Subcontractor") add("subcontractors", directAmount);
        else add("coordination", directAmount);
      });
    } else if (line.costType === "Labour") add("labour", directTotal);
    else if (line.costType === "Material") add("materials", directTotal);
    else if (line.costType === "Sub / Vendor") add("subcontractors", directTotal);
    else if (line.costType === "Labour & Materials") {
      add("labour", directTotal / 2);
      add("materials", directTotal / 2);
    } else add("coordination", directTotal);

    const unallocatedSell = sellTotal - allocatedSell;
    if (unallocatedSell > 0.005) totals.coordination += unallocatedSell;
  });

  const rows: ProposalCostBreakdownRow[] = lineOptions
    .filter((option) => selectedLineIds.has(option.id))
    .map((option) => ({ key: `line-${option.id}`, category: "line-item", label: option.label, amount: roundMoney(option.amount) }));
  const addCombined = (category: ProposalCostBreakdownCategory, label: string) => {
    const amount = roundMoney(totals[category]);
    if (selected.has(category) && amount > 0) rows.push({ key: category, category, label, amount });
  };

  addCombined("labour", "Labour");
  addCombined("materials", "Materials");
  if (selected.has("subcontractors") && totals.subcontractors > 0) {
    rows.push({ key: "subcontractors", category: "subcontractors", label: "Subcontractors", amount: roundMoney(totals.subcontractors) });
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
  const remainingCents = Math.max(0, proposalTotalCents - displayedTotalCents);
  if (remainingCents > 0) {
    visibleRows.push({
      key: "general-conditions",
      category: "general-conditions",
      label: "General Conditions/Coordination and Markup",
      amount: remainingCents / 100,
    });
  }
  return visibleRows;
}
