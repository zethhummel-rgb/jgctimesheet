"use client";

import { Fragment, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { SupplierCatalogSection, SupplierPriceImportModal } from "./supplier-price-import";
import type { SupplierCatalogItemRecord, SupplierCatalogSearchResponse } from "../lib/supplier-catalog-types";
import { portalJobs, type PortalJobOption } from "../src/portal-api";
import {
  buildUpItemTotal,
  createDefaultState,
  effectiveUnitCost,
  lineBuildUpTotals,
  lineDirectCost,
  lineSellPrice,
  normalizeAppState,
  preciseLineDirectCost,
  quoteTotals,
  type AppState,
  type Client,
  type ClientContact,
  type CostType,
  type Job,
  type JobCostEntry,
  type PriceBookItem,
  type ProposalStyle,
  type PurchaseOrder,
  type Quote,
  type QuoteClass,
  type QuoteCostBuildUpItem,
  type QuoteLine,
  type QuoteStatus,
  type Vendor,
  type VendorContact,
  type ViewKey,
} from "../lib/estimator-data";

// Start loading the PDF maker with the workspace so a later site update cannot
// leave an already-open quote pointing at an old, removed download file.
const quoteBackupPdfModule = import("../lib/quote-backup-pdf");
const proposalPdfModule = import("../lib/proposal-pdf");
const purchaseOrderPdfModule = import("../lib/purchase-order-pdf");

const moneyFormatter = new Intl.NumberFormat("en-CA", {
  style: "currency",
  currency: "CAD",
  minimumFractionDigits: 2,
});

const compactMoneyFormatter = new Intl.NumberFormat("en-CA", {
  style: "currency",
  currency: "CAD",
  notation: "compact",
  maximumFractionDigits: 1,
});

const numberFormatter = new Intl.NumberFormat("en-CA", { maximumFractionDigits: 2 });

const costTypeOptions: CostType[] = ["Labour", "Material", "Labour & Materials", "Sub / Vendor", "Equipment / Other"];
const estimateCostTypeOrder: CostType[] = ["Sub / Vendor", "Labour & Materials", "Labour", "Material", "Equipment / Other"];

const constructionDivisions = [
  "Div 01 – General Requirements",
  "Division 02 – Existing Conditions/Demo",
  "Division 03 – Concrete",
  "Division 04 – Masonry",
  "Division 05 – Metals",
  "Division 06 – Wood, Plastics and Composites",
  "Division 07 – Thermal and Moisture Protection",
  "Division 08 – Openings",
  "Division 09 – Finishes",
  "Division 10 – Specialties",
  "Division 11 – Equipment",
  "Division 12 – Furnishings",
  "Division 13 – Special Construction",
  "Division 14 – Conveying Equipment",
  "Division 21 – Fire Suppression",
  "Division 22 – Plumbing",
  "Division 23 – Heating, Ventilating and Air-Conditioning (HVAC)",
  "Division 25 – Integrated Automation",
  "Division 26 – Electrical",
  "Division 27 – Communications",
  "Division 28 – Electronic Safety and Security",
  "Division 31 – Earthwork",
  "Division 32 – Exterior Improvements",
  "Division 33 – Utilities",
  "Division 34 – Transportation",
  "Division 35 – Waterway and Marine Construction",
  "Division 42 – Process Heating, Cooling and Drying Equipment",
  "Division 44 – Pollution Control Equipment",
];

function detectConstructionDivision(description: string): string | null {
  const value = description.toLocaleLowerCase();
  const rules: Array<[RegExp, string]> = [
    [/\b(concrete|cement|rebar|forming|formwork|coring)\b/, "Division 03 – Concrete"],
    [/\b(masonry|brick|block|mortar)\b/, "Division 04 – Masonry"],
    [/\b(metal|steel|structural steel|welding)\b/, "Division 05 – Metals"],
    [/\b(wood|carpentry|framing|lumber|millwork)\b/, "Division 06 – Wood, Plastics and Composites"],
    [/\b(roof|roofing|waterproof|insulation|vapou?r barrier|caulking)\b/, "Division 07 – Thermal and Moisture Protection"],
    [/\b(door|frame|hardware|window|glazing)\b/, "Division 08 – Openings"],
    [/\b(drywall|gypsum|flooring|painting|paint|ceiling|tile|finishes)\b/, "Division 09 – Finishes"],
    [/\b(plumb|plumbing|toilet|sink|faucet|drain)\b/, "Division 22 – Plumbing"],
    [/\b(hvac|mechanical|duct|ventilation|heating|cooling)\b/, "Division 23 – Heating, Ventilating and Air-Conditioning (HVAC)"],
    [/\b(electric|electrical|wiring|lighting|panel|receptacle)\b/, "Division 26 – Electrical"],
  ];
  return rules.find(([pattern]) => pattern.test(value))?.[1] ?? null;
}

const unitPricingOptions = [
  { value: "LS", label: "LS — Lump sum for the complete item" },
  { value: "Sq.Ft.", label: "Sq.Ft. — Square foot of area" },
  { value: "Ln.Ft.", label: "Ln.Ft. — Linear foot of length" },
  { value: "Sq.Yd.", label: "Sq.Yd. — Square yard of area" },
  { value: "Cu.Yd.", label: "Cu.Yd. — Cubic yard of volume" },
  { value: "m", label: "m — Linear metre" },
  { value: "m²", label: "m² — Square metre of area" },
  { value: "m³", label: "m³ — Cubic metre of volume" },
  { value: "Each", label: "Each — One complete item" },
  { value: "Unit", label: "Unit — One complete unit" },
  { value: "Piece", label: "Piece — One individual piece" },
  { value: "Hour", label: "Hour — Labour or equipment hour" },
  { value: "Day", label: "Day — Daily labour, rental or service" },
  { value: "Week", label: "Week — Weekly rental or service" },
  { value: "Month", label: "Month — Monthly rental or service" },
  { value: "/hole", label: "/hole — Each drilled or cored hole" },
  { value: "/opening", label: "/opening — Each opening" },
  { value: "/room", label: "/room — Each room or space" },
  { value: "/door", label: "/door — Each door assembly" },
  { value: "Sheet", label: "Sheet — Each sheet of material" },
  { value: "Person-day", label: "Person-day — One person for one day" },
  { value: "Tonne", label: "Tonne — Metric tonne" },
  { value: "kg", label: "kg — Kilogram" },
  { value: "L", label: "L — Litre" },
] as const;

function unitPricingChoice(unit: string) {
  return unitPricingOptions.some((option) => option.value === unit) ? unit : "__custom__";
}

const navItems: { key: ViewKey; label: string; icon: string }[] = [
  { key: "dashboard", label: "Overview", icon: "▦" },
  { key: "quotes", label: "Quotes", icon: "▤" },
  { key: "clients", label: "Clients", icon: "◎" },
  { key: "pricebook", label: "Price Book", icon: "⌘" },
  { key: "vendors", label: "Vendors", icon: "◇" },
  { key: "jobs", label: "Jobs", icon: "✓" },
];

type QuoteTab = "details" | "estimate" | "breakdown" | "review" | "divisions" | "proposal" | "purchase-orders" | "history";
type SaveStatus = "loading" | "saved" | "saving" | "offline" | "error";
type ModalState =
  | null
  | { kind: "client" }
  | { kind: "vendor" }
  | { kind: "pricebook" }
  | { kind: "jobCost"; jobId: string };

type PurchaseOrderEditorState =
  | null
  | { jobId: string; lineId: string; purchaseOrderId?: never }
  | { jobId: string; purchaseOrderId: string; lineId?: never };

function uid(prefix: string) {
  const random = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${random}`;
}

function internalPriceBookCode(name: string, items: PriceBookItem[]) {
  const base = name
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 36) || "PRICE-ITEM";
  const used = new Set(items.map((item) => item.code.toUpperCase()));
  if (!used.has(base)) return base;
  let suffix = 2;
  while (used.has(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function addDays(date: string, days: number) {
  const value = new Date(`${date}T12:00:00`);
  value.setDate(value.getDate() + days);
  return value.toISOString().slice(0, 10);
}

function money(value: number) {
  return moneyFormatter.format(Number.isFinite(value) ? value : 0);
}

function compactMoney(value: number) {
  return compactMoneyFormatter.format(Number.isFinite(value) ? value : 0);
}

async function downloadQuoteBackup(state: AppState, quote: Quote) {
  try {
    const { downloadQuoteBackupPdf } = await quoteBackupPdfModule;
    await downloadQuoteBackupPdf({ state, quote, review: quoteReadiness(quote, state.vendors) });
  } catch (error) {
    console.error("Unable to create quote backup PDF", error);
    window.alert("The PDF backup could not be created. Your quote is still safely saved. Refresh this page and try the download again.");
  }
}

async function downloadCustomerProposal(state: AppState, quote: Quote) {
  try {
    const { downloadProposalPdf } = await proposalPdfModule;
    await downloadProposalPdf(state, quote);
  } catch {
    window.alert("The proposal PDF could not be created. Please try again.");
  }
}

async function downloadEstimateOnly(state: AppState, quote: Quote) {
  try {
    const { downloadEstimatePdf } = await quoteBackupPdfModule;
    await downloadEstimatePdf({ state, quote });
  } catch (error) {
    console.error("Unable to create estimate PDF", error);
    window.alert("The Estimate PDF could not be created. Please refresh and try again.");
  }
}

async function downloadBreakdownOnly(state: AppState, quote: Quote) {
  try {
    const { downloadBreakdownPdf } = await quoteBackupPdfModule;
    await downloadBreakdownPdf({ state, quote });
  } catch (error) {
    console.error("Unable to create breakdown PDF", error);
    window.alert("The Breakdown PDF could not be created. Please refresh and try again.");
  }
}

async function downloadQuotePackage(state: AppState, quote: Quote) {
  try {
    const { downloadEstimatePdf, downloadBreakdownPdf } = await quoteBackupPdfModule;
    const { downloadProposalPdf } = await proposalPdfModule;
    await downloadProposalPdf(state, quote);
    await downloadEstimatePdf({ state, quote });
    if (quote.lines.some((line) => line.costBuildUp)) await downloadBreakdownPdf({ state, quote });
  } catch (error) {
    console.error("Unable to create the quote PDF package", error);
    window.alert("One or more quote PDFs could not be created. Your quote is still safely saved. Please refresh and try again.");
  }
}

async function downloadPurchaseOrder(state: AppState, job: Job, purchaseOrder: PurchaseOrder) {
  try {
    const { downloadPurchaseOrderPdf } = await purchaseOrderPdfModule;
    await downloadPurchaseOrderPdf({ state, job, purchaseOrder });
  } catch (error) {
    console.error("Unable to create purchase order PDF", error);
    window.alert("The purchase order PDF could not be created. The PO is still safely saved. Refresh this page and try again.");
  }
}

function percent(value: number, digits = 1) {
  return `${(value * 100).toFixed(digits)}%`;
}

function shortDate(value: string) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-CA", { month: "short", day: "numeric", year: "numeric" }).format(
    new Date(`${value.slice(0, 10)}T12:00:00`),
  );
}

function proposalStyle(quote: Quote): ProposalStyle {
  return quote.proposalStyle ?? "jgc-classic";
}

function nonBlankLines(value?: string) {
  return (value ?? "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function customerScopeLines(quote: Quote) {
  const written = nonBlankLines(quote.proposalScope);
  if (written.length) return written;
  return quote.lines
    .filter((line) => line.description.trim() && line.included)
    .map((line) => line.description.trim());
}

function lineInternalDetails(line: QuoteLine) {
  if (!line.internalScope) return line.internalNote;
  if (!line.internalNote) return line.internalScope;
  return `${line.internalScope}\n\n${line.internalNote}`;
}

function sectionSummaries(quote: Quote) {
  const groups = new Map<string, { descriptions: string[]; total: number }>();
  quote.lines
    .filter((line) => line.description.trim() && line.included)
    .forEach((line) => {
      const key = line.section.trim() || "General";
      const current = groups.get(key) ?? { descriptions: [], total: 0 };
      current.descriptions.push(line.description.trim());
      current.total += lineSellPrice(line, quote.defaultMarkup);
      groups.set(key, current);
    });
  return [...groups.entries()].map(([section, value]) => ({ section, ...value }));
}

function divisionSummaries(quote: Quote) {
  const included = quote.lines.filter((line) => line.included);
  const extras = Array.from(new Set(included.map((line) => line.division?.trim()).filter((division): division is string => Boolean(division && !constructionDivisions.includes(division)))));
  const total = quoteTotals(quote).subtotal;
  return [...constructionDivisions, ...extras].map((division) => {
    const lines = included.filter((line) => (line.division?.trim() || "Div 01 – General Requirements") === division);
    const directCost = lines.reduce((sum, line) => sum + lineDirectCost(line), 0);
    const bidPrice = lines.reduce((sum, line) => sum + lineSellPrice(line, quote.defaultMarkup), 0);
    return { division, lineCount: lines.length, directCost, profit: bidPrice - directCost, bidPrice, share: total > 0 ? bidPrice / total : 0 };
  });
}

function quoteCostCategories(quote: Quote) {
  const direct = { labour: 0, materials: 0, subcontractors: 0, other: 0 };
  const sell = { labour: 0, materials: 0, subcontractors: 0, other: 0 };
  quote.lines.filter((line) => line.included).forEach((line) => {
    const lineDirect = lineDirectCost(line);
    const lineSell = lineSellPrice(line, quote.defaultMarkup);
    const factor = lineDirect > 0 ? lineSell / lineDirect : 0;
    const add = (key: keyof typeof direct, amount: number) => {
      direct[key] += amount;
      sell[key] += amount * factor;
    };
    if (line.costBuildUp) {
      const totals = lineBuildUpTotals(line);
      add("labour", totals.labour * line.quantity);
      add("materials", totals.materials * line.quantity);
      add("subcontractors", totals.subcontractors * line.quantity);
      add("other", totals.other * line.quantity);
    } else if (line.costType === "Labour") add("labour", lineDirect);
    else if (line.costType === "Material") add("materials", lineDirect);
    else if (line.costType === "Sub / Vendor") add("subcontractors", lineDirect);
    else if (line.costType === "Labour & Materials") {
      add("labour", lineDirect / 2);
      add("materials", lineDirect / 2);
    } else add("other", lineDirect);
  });
  return {
    direct: Object.fromEntries(Object.entries(direct).map(([key, value]) => [key, Math.round(value * 100) / 100])) as typeof direct,
    sell: Object.fromEntries(Object.entries(sell).map(([key, value]) => [key, Math.round(value * 100) / 100])) as typeof sell,
  };
}

function dollarsInWords(value: number): string {
  const belowTwenty = ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
  const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  const underThousand = (amount: number): string => {
    if (amount < 20) return belowTwenty[amount];
    if (amount < 100) return `${tens[Math.floor(amount / 10)]}${amount % 10 ? `-${belowTwenty[amount % 10]}` : ""}`;
    return `${belowTwenty[Math.floor(amount / 100)]} Hundred${amount % 100 ? ` ${underThousand(amount % 100)}` : ""}`;
  };
  const whole = Math.max(0, Math.round(value));
  if (whole < 1000) return underThousand(whole);
  if (whole < 1_000_000) return `${underThousand(Math.floor(whole / 1000))} Thousand${whole % 1000 ? ` ${underThousand(whole % 1000)}` : ""}`;
  return `${underThousand(Math.floor(whole / 1_000_000))} Million${whole % 1_000_000 ? ` ${dollarsInWords(whole % 1_000_000)}` : ""}`;
}

function timeAgo(value: string) {
  const diff = Date.now() - new Date(value).getTime();
  const minutes = Math.max(0, Math.floor(diff / 60000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return shortDate(value);
}

function quoteDisplayStatus(quote: Quote): QuoteStatus | "Expired" {
  if ((quote.status === "Finished" || quote.status === "Sent") && quote.validUntil && quote.validUntil < today()) return "Expired";
  return quote.status;
}

function quoteStatusLabel(status: QuoteStatus | "Expired" | "Active" | "Archived") {
  return status === "Sent" ? "Finished" : status;
}

function clientName(state: AppState, clientId: string) {
  return state.clients.find((client) => client.id === clientId)?.name ?? "Client not selected";
}

function isSubcontractor(vendor: Vendor) {
  return (vendor.category ?? (vendor.trade === "Material Supplier" ? "Supplier" : "Subcontractor")) === "Subcontractor";
}

function activeSubcontractors(vendors: Vendor[]) {
  return vendors.filter((vendor) => vendor.status === "Active" && isSubcontractor(vendor));
}

function quoteReadiness(quote: Quote, vendors: Vendor[]) {
  const blockers: { key: string; message: string }[] = [];
  const warnings: { key: string; message: string }[] = [];
  const included = quote.lines.filter((line) => line.included);

  if (!quote.clientId) blockers.push({ key: "client", message: "Select a client." });
  if (!quote.project.trim()) blockers.push({ key: "project", message: "Enter the project name." });
  if (!included.length) blockers.push({ key: "included-work", message: "Add at least one included line." });

  included.forEach((line, index) => {
    const label = line.description || `Line ${index + 1}`;
    if (!line.description.trim()) blockers.push({ key: `${line.id}-description`, message: `Line ${index + 1} needs a description.` });
    if (!(line.quantity > 0)) blockers.push({ key: `${line.id}-quantity`, message: `${label} needs a quantity above zero.` });
    if (!line.unit.trim()) blockers.push({ key: `${line.id}-unit`, message: `${label} needs a unit.` });
    if (!(effectiveUnitCost(line) > 0)) blockers.push({ key: `${line.id}-cost`, message: `${label} has no usable direct cost.` });
    if (line.costType === "Sub / Vendor" && !line.vendorId && !line.vendorName?.trim()) {
      blockers.push({ key: `${line.id}-vendor`, message: `${label} needs a subcontractor.` });
    }
    if (line.vendorId && !vendors.some((vendor) => vendor.id === line.vendorId)) {
      blockers.push({ key: `${line.id}-vendor-missing`, message: `${label} references a vendor that no longer exists.` });
    }
    if (line.costBuildUp) {
      const activeCostItems = line.costBuildUp.items.filter((item) => item.description.trim() || item.unitCost > 0);
      activeCostItems.forEach((item, itemIndex) => {
        const itemLabel = item.description.trim() || `${item.kind} row ${itemIndex + 1}`;
        if (!item.description.trim()) blockers.push({ key: `${item.id}-description`, message: `${label}: ${item.kind.toLowerCase()} row ${itemIndex + 1} needs a description.` });
        if (!(item.quantity > 0)) blockers.push({ key: `${item.id}-quantity`, message: `${label}: ${itemLabel} needs a quantity above zero.` });
        if (!item.unit.trim()) blockers.push({ key: `${item.id}-unit`, message: `${label}: ${itemLabel} needs a unit.` });
        if (!(item.unitCost > 0)) blockers.push({ key: `${item.id}-cost`, message: `${label}: ${itemLabel} needs a unit cost.` });
      });
    }

    if (line.priceOverride !== null) warnings.push({ key: `${line.id}-price-override`, message: `${label} has a manual customer-price override.` });
    if (line.vendorQuoteExpiry) {
      const twoWeeks = addDays(today(), 14);
      if (line.vendorQuoteExpiry <= twoWeeks) {
        warnings.push({ key: `${line.id}-quote-expiry`, message: `${label} has an expired or soon-expiring vendor quote.` });
      }
    }
  });

  const totals = quoteTotals(quote);
  if (totals.subtotal > 0 && totals.margin < quote.targetMargin) {
    warnings.push({ key: "target-margin", message: `Gross margin ${percent(totals.margin)} is below the ${percent(quote.targetMargin)} target.` });
  }
  if (!customerScopeLines(quote).length) warnings.push({ key: "scope", message: "Add at least one Proposal Scope Line." });
  if (!quote.exclusions.trim()) warnings.push({ key: "exclusions", message: "Add exclusions or state that there are none." });
  if (!quote.terms.trim()) warnings.push({ key: "terms", message: "Add proposal terms." });

  const unresolvedWarnings = warnings.filter((warning) => !quote.acknowledgedWarnings[warning.key]);
  return { blockers, warnings, unresolvedWarnings };
}

function newLine(section = "General"): QuoteLine {
  return {
    id: uid("line"),
    section,
    division: "Div 01 – General Requirements",
    priceBookCode: null,
    description: "",
    internalScope: "",
    classification: "Required",
    included: true,
    costType: "Equipment / Other",
    quantity: 1,
    unit: "LS",
    catalogCost: null,
    projectCost: null,
    markupOverride: null,
    priceOverride: null,
    vendorId: null,
    vendorName: "",
    vendorReference: "",
    vendorQuoteDate: "",
    vendorQuoteExpiry: "",
    vendorPricingMode: "Budget",
    liveQuote: false,
    confidence: "Project-specific",
    low: null,
    high: null,
    sourceNote: "",
    customerNote: "",
    internalNote: "",
  };
}

function newBuildUpItem(kind: QuoteCostBuildUpItem["kind"], patch: Partial<QuoteCostBuildUpItem> = {}): QuoteCostBuildUpItem {
  return {
    id: uid("cost"),
    kind,
    description: "",
    quantity: 0,
    unit: kind === "Labour" ? "hr" : kind === "Subcontractor" || kind === "Other" ? "LS" : "Each",
    unitCost: 0,
    source: "",
    ...patch,
  };
}

function newBuiltUpLine(section = "General"): QuoteLine {
  return {
    ...newLine(section),
    costType: "Labour & Materials",
    quantity: 1,
    unit: "LS",
    sourceNote: "Detailed labour and material cost build-up.",
    costBuildUp: {
      items: [
        newBuildUpItem("Labour", { description: "Crew labour" }),
        newBuildUpItem("Material"),
      ],
    },
  };
}

function newSubcontractorLine(section = "General"): QuoteLine {
  return {
    ...newLine(section),
    costType: "Sub / Vendor",
    quantity: 1,
    unit: "LS",
    liveQuote: true,
    vendorPricingMode: "Quoted",
    confidence: "Project-specific",
    sourceNote: "Current subcontractor quote.",
  };
}

export interface CurrentEstimator {
  id: string;
  name: string;
  isAdmin: boolean;
}

export default function EstimateDesk({ currentEstimator = { id: "", name: "Zeth", isAdmin: true } }: { currentEstimator?: CurrentEstimator }) {
  const [state, setState] = useState<AppState>(() => createDefaultState());
  const [ready, setReady] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("loading");
  const [lastSaved, setLastSaved] = useState("");
  const [view, setView] = useState<ViewKey>("dashboard");
  const [selectedQuoteId, setSelectedQuoteId] = useState<string | null>(null);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [quoteTab, setQuoteTab] = useState<QuoteTab>("estimate");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [modal, setModal] = useState<ModalState>(null);
  const [search, setSearch] = useState("");
  const [quoteStatusFilter, setQuoteStatusFilter] = useState("All");
  const [priceCategory, setPriceCategory] = useState("All");
  const [expandedLineId, setExpandedLineId] = useState<string | null>(null);
  const [catalogToAdd, setCatalogToAdd] = useState("");
  const [expandedPriceId, setExpandedPriceId] = useState<string | null>(null);
  const [supplierImportOpen, setSupplierImportOpen] = useState(false);
  const [supplierCatalogRefresh, setSupplierCatalogRefresh] = useState(0);
  const [pendingDeleteQuoteId, setPendingDeleteQuoteId] = useState<string | null>(null);
  const [pendingFinishQuoteId, setPendingFinishQuoteId] = useState<string | null>(null);
  const [pendingCreateJobQuoteId, setPendingCreateJobQuoteId] = useState<string | null>(null);
  const [purchaseOrderEditor, setPurchaseOrderEditor] = useState<PurchaseOrderEditorState>(null);
  const saveTimer = useRef<number | null>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/state", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Save service unavailable");
        return response.json() as Promise<{ state: AppState; updatedAt: string }>;
      })
      .then((payload) => {
        if (!active) return;
        setState(normalizeAppState(payload.state));
        setLastSaved(payload.updatedAt);
        setSaveStatus("saved");
        setReady(true);
      })
      .catch(() => {
        if (!active) return;
        setSaveStatus("offline");
        setReady(true);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const preventNumberStepping = (event: KeyboardEvent) => {
      const input = event.target instanceof HTMLInputElement ? event.target : null;
      if (input?.type !== "number" || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
      event.preventDefault();
    };
    const releaseNumberInputBeforeWheel = (event: WheelEvent) => {
      const input = event.target instanceof HTMLInputElement ? event.target : null;
      if (input?.type === "number" && document.activeElement === input) input.blur();
    };

    document.addEventListener("keydown", preventNumberStepping, true);
    document.addEventListener("wheel", releaseNumberInputBeforeWheel, { capture: true, passive: true });
    return () => {
      document.removeEventListener("keydown", preventNumberStepping, true);
      document.removeEventListener("wheel", releaseNumberInputBeforeWheel, true);
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    setSaveStatus("saving");
    saveTimer.current = window.setTimeout(async () => {
      try {
        const response = await fetch("/api/state", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ state }),
        });
        if (!response.ok) throw new Error("Save failed");
        const result = (await response.json()) as { updatedAt: string };
        setLastSaved(result.updatedAt);
        setSaveStatus("saved");
      } catch {
        setSaveStatus("error");
      }
    }, 700);
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    };
  }, [state, ready]);

  useEffect(() => {
    if (!sidebarOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSidebarOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [sidebarOpen]);

  useLayoutEffect(() => {
    if (!sidebarOpen) return;

    const root = document.documentElement;
    const body = document.body;
    const scrollTop = window.scrollY;
    const previousBodyStyles = {
      position: body.style.position,
      top: body.style.top,
      right: body.style.right,
      bottom: body.style.bottom,
      left: body.style.left,
      width: body.style.width,
      overflow: body.style.overflow,
    };

    const syncVisualViewport = () => {
      const viewport = window.visualViewport;
      root.style.setProperty("--estimator-viewport-top", `${viewport?.offsetTop ?? 0}px`);
      root.style.setProperty("--estimator-viewport-height", `${viewport?.height ?? window.innerHeight}px`);
    };

    syncVisualViewport();
    root.classList.add("estimator-nav-open");
    body.style.position = "fixed";
    body.style.top = `-${scrollTop}px`;
    body.style.right = "0";
    body.style.bottom = "0";
    body.style.left = "0";
    body.style.width = "100%";
    body.style.overflow = "hidden";
    window.visualViewport?.addEventListener("resize", syncVisualViewport);
    window.visualViewport?.addEventListener("scroll", syncVisualViewport);

    return () => {
      window.visualViewport?.removeEventListener("resize", syncVisualViewport);
      window.visualViewport?.removeEventListener("scroll", syncVisualViewport);
      root.classList.remove("estimator-nav-open");
      root.style.removeProperty("--estimator-viewport-top");
      root.style.removeProperty("--estimator-viewport-height");
      Object.assign(body.style, previousBodyStyles);
      window.scrollTo(0, scrollTop);
    };
  }, [sidebarOpen]);

  const selectedQuote = selectedQuoteId ? state.quotes.find((quote) => quote.id === selectedQuoteId) ?? null : null;
  const selectedJob = selectedJobId ? state.jobs.find((job) => job.id === selectedJobId) ?? null : null;

  const openView = (nextView: ViewKey) => {
    setView(nextView);
    setSidebarOpen(false);
    setSearch("");
    if (nextView === "quotes") setSelectedQuoteId(null);
    if (nextView === "jobs") setSelectedJobId(null);
  };

  const addActivity = (draft: AppState, quoteId: string | null, title: string, detail: string) => ({
    ...draft,
    activity: [
      { id: uid("activity"), quoteId, title, detail, createdAt: new Date().toISOString() },
      ...draft.activity,
    ].slice(0, 100),
  });

  const mutateQuote = (quoteId: string, updater: (quote: Quote) => Quote, activity?: { title: string; detail: string }) => {
    setState((current) => {
      const next = {
        ...current,
        quotes: current.quotes.map((quote) =>
          quote.id === quoteId ? { ...updater(quote), updatedAt: new Date().toISOString() } : quote,
        ),
      };
      return activity ? addActivity(next, quoteId, activity.title, activity.detail) : next;
    });
  };

  const createQuote = () => {
    const date = today();
    const sequence = String(state.settings.nextQuoteNumber).padStart(4, "0");
    const quote: Quote = {
      id: uid("quote"),
      number: `${state.settings.quotePrefix}-${date.slice(0, 4)}-${sequence}`,
      revision: 0,
      status: "Draft",
      clientId: "",
      site: "",
      address: "",
      project: "",
      reference: "",
      preparedBy: currentEstimator.name,
      ownerUserId: currentEstimator.id,
      ownerName: currentEstimator.name,
      quoteDate: date,
      validUntil: addDays(date, state.settings.defaultValidityDays),
      quoteType: "Fixed Price",
      customerQuoteType: "Proposal Quote",
      taxName: state.settings.taxName,
      taxRate: state.settings.taxRate,
      defaultMarkup: state.settings.defaultMarkup,
      targetMargin: state.settings.targetMargin,
      depositPercent: 0,
      proposalStyle: state.settings.defaultProposalStyle ?? "jgc-classic",
      proposalTaxDisplay: state.settings.defaultProposalTaxDisplay ?? "extra",
      proposalScope: "",
      proposalNotes: "Price based on easy access to the job site for labour, materials and equipment\nAll work to be completed during regular business hours\nAll inspections and permits by others",
      proposalAttention: "",
      proposalAttentionContactId: "",
      proposalShowCostBreakdown: false,
      proposalBreakdownIncludesMarkup: true,
      scopeSummary: "",
      inclusions: "",
      exclusions: "",
      terms: state.settings.proposalTerms,
      internalNotes: "",
      lines: [],
      acknowledgedWarnings: {},
      revisions: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      sentAt: "",
      wonAt: "",
      acceptedBy: "",
      customerPo: "",
      lostReason: "",
    };
    setState((current) =>
      addActivity(
        {
          ...current,
          settings: { ...current.settings, nextQuoteNumber: current.settings.nextQuoteNumber + 1 },
          quotes: [quote, ...current.quotes],
        },
        quote.id,
        "Quote created",
        `${quote.number} started as a new draft.`,
      ),
    );
    setSelectedQuoteId(quote.id);
    setQuoteTab("details");
    setView("quotes");
  };

  const openQuote = (quoteId: string, tab: QuoteTab = "estimate") => {
    setSelectedQuoteId(quoteId);
    setQuoteTab(tab);
    setView("quotes");
  };

  const openJob = (jobId: string) => {
    setSelectedJobId(jobId);
    setView("jobs");
  };

  const duplicateQuote = (quote: Quote) => {
    const sequence = String(state.settings.nextQuoteNumber).padStart(4, "0");
    const date = today();
    const copy: Quote = {
      ...quote,
      id: uid("quote"),
      number: `${state.settings.quotePrefix}-${date.slice(0, 4)}-${sequence}`,
      revision: 0,
      status: "Draft",
      preparedBy: currentEstimator.name,
      ownerUserId: currentEstimator.id,
      ownerName: currentEstimator.name,
      project: `${quote.project} — copy`,
      lines: quote.lines.map((line) => ({
        ...line,
        id: uid("line"),
        costBuildUp: line.costBuildUp
          ? { items: line.costBuildUp.items.map((item) => ({ ...item, id: uid("cost") })) }
          : undefined,
      })),
      acknowledgedWarnings: {},
      revisions: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      sentAt: "",
      wonAt: "",
      acceptedBy: "",
      customerPo: "",
      lostReason: "",
      demo: false,
    };
    setState((current) =>
      addActivity(
        {
          ...current,
          settings: { ...current.settings, nextQuoteNumber: current.settings.nextQuoteNumber + 1 },
          quotes: [copy, ...current.quotes],
        },
        copy.id,
        "Quote duplicated",
        `${copy.number} was copied from ${quote.number}.`,
      ),
    );
    setSelectedQuoteId(copy.id);
    setQuoteTab("details");
  };

  const createRevision = (quote: Quote) => {
    if (quote.status !== "Finished") return;
    mutateQuote(
      quote.id,
      (current) => {
        if (current.status !== "Finished") return current;
        return {
          ...current,
          revision: current.revision + 1,
          status: "Draft",
          sentAt: "",
          acknowledgedWarnings: {},
          revisions: [
            ...current.revisions,
            {
              id: uid("revision"),
              revision: current.revision,
              status: "Finished",
              issuedAt: current.sentAt || new Date().toISOString(),
              total: quoteTotals(current).total,
              snapshot: JSON.stringify(current),
            },
          ],
        };
      },
      { title: "Editable revision created", detail: `Revision ${quote.revision + 1} was opened for changes. Revision ${quote.revision} remains frozen in History.` },
    );
    setQuoteTab("estimate");
  };

  const completeFinishQuote = (quote: Quote) => {
    const sentAt = new Date().toISOString();
    const siteName = quote.site.trim();
    const attentionName = quote.proposalAttention?.trim() ?? "";
    setState((current) => {
      const next = {
        ...current,
        clients: siteName || attentionName
          ? current.clients.map((client) => {
              if (client.id !== quote.clientId) return client;
              const siteAlreadySaved = client.sites.some(
                (site) => site.label.trim().toLocaleLowerCase() === siteName.toLocaleLowerCase(),
              );
              const sites = !siteName ? client.sites : siteAlreadySaved
                ? client.sites.map((site) => site.label.trim().toLocaleLowerCase() === siteName.toLocaleLowerCase() && quote.address?.trim() ? { ...site, address: quote.address.trim() } : site)
                : [...client.sites, { id: uid("site"), label: siteName, address: quote.address?.trim() ?? "" }];
              const contacts = client.contacts ?? [];
              const attentionAlreadySaved = attentionName && contacts.some((contact) => contact.name.trim().toLocaleLowerCase() === attentionName.toLocaleLowerCase());
              return { ...client, sites, contacts: attentionName && !attentionAlreadySaved ? [...contacts, { id: uid("client-contact"), name: attentionName, role: "", email: "", phone: "" }] : contacts };
            })
          : current.clients,
        quotes: current.quotes.map((item) =>
          item.id === quote.id
            ? { ...item, site: siteName, status: "Finished" as const, sentAt, updatedAt: sentAt }
            : item,
        ),
      };
      return addActivity(next, quote.id, "Quote finished", `${quote.number} Rev ${quote.revision} was marked Finished and remains editable.`);
    });
    setPendingFinishQuoteId(null);
  };

  const finalizeQuote = (quote: Quote) => {
    const readiness = quoteReadiness(quote, state.vendors);
    if (readiness.blockers.length) {
      setQuoteTab("review");
      return;
    }
    if (readiness.unresolvedWarnings.length) {
      setPendingFinishQuoteId(quote.id);
      return;
    }
    completeFinishQuote(quote);
  };

  const requestCreateJob = (quote: Quote) => {
    setPendingCreateJobQuoteId(quote.id);
  };

  const createJobFromQuote = (quote: Quote, jobNumber: string) => {
    const officialJobNumber = jobNumber.trim();
    if (!officialJobNumber) return;
    const portalJob = portalJobs().find((item) => item.active && item.jobNumber.trim().toLocaleLowerCase() === officialJobNumber.toLocaleLowerCase());
    if (!portalJob) return;
    if (state.jobs.some((item) => item.jobNumber.trim().toLocaleLowerCase() === officialJobNumber.toLocaleLowerCase())) return;
    const totals = quoteTotals(quote);
    const job: Job = {
      id: uid("job"),
      jobNumber: officialJobNumber,
      quoteId: quote.id,
      clientId: quote.clientId,
      project: quote.project,
      status: "Active",
      portalJobId: portalJob.id,
      portalActive: portalJob.active,
      portalLastSyncedAt: new Date().toISOString(),
      archivedAt: "",
      acceptedRevenue: totals.subtotal,
      originalCostBudget: totals.directCost,
      approvedRevenueChanges: 0,
      approvedCostChanges: 0,
      estimateToComplete: totals.directCost,
      acceptedAt: new Date().toISOString(),
      costs: [],
      purchaseOrders: [],
      notes: `Estimate follow-up for ${quote.number} Rev ${quote.revision}. Linked to Portal job ${portalJob.jobNumber} — ${portalJob.jobName}.`,
    };
    setState((current) =>
      addActivity(
        {
          ...current,
          quotes: current.quotes.map((item) => item.id === quote.id ? {
            ...item,
            status: "Won",
            wonAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            revisions: item.revisions.some((revision) => revision.revision === item.revision)
              ? item.revisions
              : [...item.revisions, { id: uid("revision"), revision: item.revision, status: "Finished", issuedAt: item.sentAt || new Date().toISOString(), total: quoteTotals(item).total, snapshot: JSON.stringify({ ...item, status: "Finished" }) }],
          } : item),
          jobs: current.jobs.some((item) => item.quoteId === quote.id) ? current.jobs : [job, ...current.jobs],
        },
        quote.id,
        "Job created from accepted quote",
        `${quote.number} was linked to Portal job ${portalJob.jobNumber} — ${portalJob.jobName}.`,
      ),
    );
    setPendingCreateJobQuoteId(null);
    setSelectedQuoteId(null);
    setSelectedJobId(job.id);
    setView("jobs");
  };

  const markQuoteLost = (quote: Quote) => {
    const reason = window.prompt("Optional: why was this quote lost?", quote.lostReason);
    if (reason === null) return;
    mutateQuote(
      quote.id,
      (current) => ({ ...current, status: "Lost", lostReason: reason }),
      { title: "Quote closed as lost", detail: reason || "No reason recorded." },
    );
  };

  const requestQuoteRemoval = (quote: Quote) => {
    setPendingDeleteQuoteId(quote.id);
  };

  const confirmQuoteRemoval = () => {
    const quote = state.quotes.find((item) => item.id === pendingDeleteQuoteId);
    if (!quote || state.jobs.some((job) => job.quoteId === quote.id)) return;
    setState((current) => ({
      ...current,
      quotes: current.quotes.filter((item) => item.id !== quote.id),
      activity: current.activity.filter((entry) => entry.quoteId !== quote.id),
    }));
    if (selectedQuoteId === quote.id) setSelectedQuoteId(null);
    setPendingDeleteQuoteId(null);
  };

  const pendingDeleteQuote = state.quotes.find((quote) => quote.id === pendingDeleteQuoteId) ?? null;
  const pendingFinishQuote = state.quotes.find((quote) => quote.id === pendingFinishQuoteId) ?? null;
  const pendingCreateJobQuote = state.quotes.find((quote) => quote.id === pendingCreateJobQuoteId) ?? null;
  const purchaseOrderJob = purchaseOrderEditor ? state.jobs.find((job) => job.id === purchaseOrderEditor.jobId) ?? null : null;
  const purchaseOrderQuote = purchaseOrderJob ? state.quotes.find((quote) => quote.id === purchaseOrderJob.quoteId) ?? null : null;
  const purchaseOrderSourceLine = purchaseOrderEditor && "lineId" in purchaseOrderEditor && purchaseOrderQuote
    ? purchaseOrderQuote.lines.find((line) => line.id === purchaseOrderEditor.lineId) ?? null
    : null;
  const existingPurchaseOrder = purchaseOrderEditor && "purchaseOrderId" in purchaseOrderEditor && purchaseOrderJob
    ? purchaseOrderJob.purchaseOrders?.find((purchaseOrder) => purchaseOrder.id === purchaseOrderEditor.purchaseOrderId) ?? null
    : null;

  const savePurchaseOrder = (purchaseOrder: PurchaseOrder) => {
    if (!purchaseOrderJob) return;
    setState((current) => {
      const next = {
        ...current,
        jobs: current.jobs.map((job) => {
          if (job.id !== purchaseOrderJob.id) return job;
          const existing = job.purchaseOrders ?? [];
          return {
            ...job,
            purchaseOrders: existing.some((item) => item.id === purchaseOrder.id)
              ? existing.map((item) => item.id === purchaseOrder.id ? purchaseOrder : item)
              : [purchaseOrder, ...existing],
          };
        }),
      };
      return addActivity(next, purchaseOrderJob.quoteId, existingPurchaseOrder ? "Purchase order updated" : "Purchase order created", `${purchaseOrder.number} for ${purchaseOrder.vendorName}.`);
    });
    setPurchaseOrderEditor(null);
  };

  const renderContent = () => {
    if (!ready) return <LoadingState />;
    if (view === "dashboard") return <Dashboard state={state} currentEstimator={currentEstimator} onNewQuote={createQuote} onOpenQuote={openQuote} onOpenJob={openJob} />;
    if (view === "quotes") {
      if (selectedQuote) {
        return (
          <QuoteWorkspace
            state={state}
            setState={setState}
            quote={selectedQuote}
            tab={quoteTab}
            setTab={setQuoteTab}
            onBack={() => setSelectedQuoteId(null)}
            mutateQuote={mutateQuote}
            duplicateQuote={duplicateQuote}
            createRevision={createRevision}
            finalizeQuote={finalizeQuote}
            createJob={requestCreateJob}
            markLost={markQuoteLost}
            removeQuote={requestQuoteRemoval}
            expandedLineId={expandedLineId}
            setExpandedLineId={setExpandedLineId}
            catalogToAdd={catalogToAdd}
            setCatalogToAdd={setCatalogToAdd}
            onEditPurchaseOrder={(jobId, purchaseOrderId) => setPurchaseOrderEditor({ jobId, purchaseOrderId })}
          />
        );
      }
      return (
        <QuotesPage
          state={state}
          search={search}
          setSearch={setSearch}
          statusFilter={quoteStatusFilter}
          setStatusFilter={setQuoteStatusFilter}
          onNewQuote={createQuote}
          onOpenQuote={openQuote}
          onDelete={requestQuoteRemoval}
        />
      );
    }
    if (view === "clients") return <ClientsPage state={state} setState={setState} search={search} setSearch={setSearch} onAdd={() => setModal({ kind: "client" })} onOpenQuote={openQuote} />;
    if (view === "pricebook") {
      return (
        <PriceBookPage
          state={state}
          setState={setState}
          search={search}
          setSearch={setSearch}
          category={priceCategory}
          setCategory={setPriceCategory}
          expandedId={expandedPriceId}
          setExpandedId={setExpandedPriceId}
          onAdd={() => setModal({ kind: "pricebook" })}
          onImport={() => setSupplierImportOpen(true)}
          supplierRefreshKey={supplierCatalogRefresh}
        />
      );
    }
    if (view === "vendors") return <VendorsPage state={state} setState={setState} search={search} setSearch={setSearch} onAdd={() => setModal({ kind: "vendor" })} />;
    if (view === "jobs") {
      return (
        <JobsPage
          state={state}
          setState={setState}
          job={selectedJob}
          onOpen={setSelectedJobId}
          onBack={() => setSelectedJobId(null)}
          onAddCost={(jobId) => setModal({ kind: "jobCost", jobId })}
          onOpenQuote={openQuote}
          onCreatePurchaseOrder={(jobId, lineId) => setPurchaseOrderEditor({ jobId, lineId })}
          onEditPurchaseOrder={(jobId, purchaseOrderId) => setPurchaseOrderEditor({ jobId, purchaseOrderId })}
        />
      );
    }
    return <SettingsPage state={state} setState={setState} />;
  };

  return (
    <div className="desk-shell">
      <aside id="estimate-navigation" className={`sidebar ${sidebarOpen ? "is-open" : ""}`}>
        <div className="brand-block">
          <img className="brand-logo" src="../icon-192.png" alt="JGC" />
          <div>
            <strong>JGC</strong>
            <span>Estimate Desk</span>
          </div>
          <button className="sidebar-close" aria-label="Close navigation" onClick={() => setSidebarOpen(false)}>×</button>
        </div>
        <nav className="primary-nav" aria-label="Primary navigation">
          <span className="nav-heading">WORKSPACE</span>
          {navItems.map((item) => (
            <button key={item.key} className={view === item.key ? "active" : ""} onClick={() => openView(item.key)}>
              <span className="nav-icon" aria-hidden="true">{item.icon}</span>
              {item.label}
              {item.key === "quotes" && <span className="nav-count">{state.quotes.filter((quote) => quote.status === "Draft").length}</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <button className={view === "settings" ? "active" : ""} onClick={() => openView("settings")}>
            <span className="nav-icon" aria-hidden="true">⚙</span>
            Settings
          </button>
          <div className="workspace-card">
            <div className="workspace-avatar">ZG</div>
            <div>
              <strong>{currentEstimator.name}</strong>
              <span>Estimator workspace</span>
            </div>
          </div>
        </div>
      </aside>
      {sidebarOpen && <button className="sidebar-scrim" aria-label="Close navigation" onClick={() => setSidebarOpen(false)} />}

      <div className="main-column">
        <header className="topbar">
          <button className="mobile-menu" aria-label={sidebarOpen ? "Close navigation" : "Open navigation"} aria-controls="estimate-navigation" aria-expanded={sidebarOpen} onClick={() => setSidebarOpen((open) => !open)}>☰</button>
          <div className="topbar-context">
            <span>Connected to JGC Portal</span>
            <strong>{selectedQuote ? selectedQuote.number : state.settings.appName}</strong>
          </div>
          <div className="topbar-actions">
            <a className="button secondary compact portal-return-button" href="../admin.html?tab=summary"><span aria-hidden="true">←</span> Return to Portal</a>
            <div className={`save-indicator ${saveStatus}`} title={lastSaved ? `Last saved ${shortDate(lastSaved)}` : ""}>
              <span className="save-dot" />
              {saveStatus === "loading" && "Loading"}
              {saveStatus === "saving" && "Saving…"}
              {saveStatus === "saved" && "All changes saved"}
              {saveStatus === "offline" && "Working offline"}
              {saveStatus === "error" && "Save needs attention"}
            </div>
            <button className="button primary compact" onClick={createQuote}><span aria-hidden="true">＋</span> New quote</button>
          </div>
        </header>
        <main className="page-canvas">{renderContent()}</main>
      </div>

      {modal && (
        <QuickModal
          modal={modal}
          state={state}
          onClose={() => setModal(null)}
          onSubmit={(nextState) => {
            setState(nextState);
            setModal(null);
          }}
        />
      )}
      {supplierImportOpen && (
        <SupplierPriceImportModal
          vendors={state.vendors}
          divisions={constructionDivisions}
          onClose={() => setSupplierImportOpen(false)}
          onApplied={(supplier) => {
            setState((current) => current.vendors.some((vendor) => vendor.id === supplier.id) ? current : { ...current, vendors: [supplier, ...current.vendors] });
            setSupplierCatalogRefresh((current) => current + 1);
          }}
        />
      )}
      {pendingDeleteQuote && (
        <QuoteDeleteModal
          quote={pendingDeleteQuote}
          linkedJob={state.jobs.some((job) => job.quoteId === pendingDeleteQuote.id)}
          onCancel={() => setPendingDeleteQuoteId(null)}
          onConfirm={confirmQuoteRemoval}
        />
      )}
      {pendingFinishQuote && (
        <QuoteFinishModal
          quote={pendingFinishQuote}
          warningCount={quoteReadiness(pendingFinishQuote, state.vendors).unresolvedWarnings.length}
          onCancel={() => setPendingFinishQuoteId(null)}
          onConfirm={() => completeFinishQuote(pendingFinishQuote)}
        />
      )}
      {pendingCreateJobQuote && (
        <JobCreateModal
          quote={pendingCreateJobQuote}
          existingJobNumbers={state.jobs.map((job) => job.jobNumber)}
          portalJobs={portalJobs()}
          onCancel={() => setPendingCreateJobQuoteId(null)}
          onConfirm={(jobNumber) => createJobFromQuote(pendingCreateJobQuote, jobNumber)}
        />
      )}
      {purchaseOrderEditor && purchaseOrderJob && purchaseOrderQuote && (purchaseOrderSourceLine || existingPurchaseOrder) && (
        <PurchaseOrderModal
          state={state}
          job={purchaseOrderJob}
          quote={purchaseOrderQuote}
          sourceLine={purchaseOrderSourceLine}
          purchaseOrder={existingPurchaseOrder}
          onCancel={() => setPurchaseOrderEditor(null)}
          onSave={savePurchaseOrder}
        />
      )}
    </div>
  );
}

function LoadingState() {
  return (
    <div className="loading-state">
      <div className="loading-mark">JG</div>
      <strong>Opening Estimate Desk</strong>
      <span>Loading quotes, clients and the Price Book…</span>
    </div>
  );
}

function PageHeading({ eyebrow, title, description, actions }: { eyebrow?: string; title: string; description: string; actions?: React.ReactNode }) {
  return (
    <div className="page-heading">
      <div>
        {eyebrow && <span className="eyebrow">{eyebrow}</span>}
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}

interface SearchPickerOption {
  id: string;
  label: string;
  detail?: string;
}

function SearchablePicker({ value, options, disabled, placeholder, ariaLabel, allowCustom = false, onChange, onSelect, addLabel, onAdd }: {
  value: string;
  options: SearchPickerOption[];
  disabled?: boolean;
  placeholder: string;
  ariaLabel: string;
  allowCustom?: boolean;
  onChange?: (value: string) => void;
  onSelect: (option: SearchPickerOption) => void;
  addLabel?: string;
  onAdd?: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(value);
  const [mobileResultsStyle, setMobileResultsStyle] = useState<CSSProperties | undefined>();
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (!open) setQuery(value); }, [value, open]);
  useLayoutEffect(() => {
    if (!open) {
      setMobileResultsStyle(undefined);
      return;
    }

    const syncResultsPosition = () => {
      const input = inputRef.current;
      if (!input || window.matchMedia("(min-width: 761px)").matches) {
        setMobileResultsStyle(undefined);
        return;
      }

      const viewport = window.visualViewport;
      const viewportTop = viewport?.offsetTop ?? 0;
      const viewportHeight = viewport?.height ?? window.innerHeight;
      const viewportBottom = viewportTop + viewportHeight;
      const margin = 10;
      const gap = 6;
      const inputBounds = input.getBoundingClientRect();
      const availableBelow = viewportBottom - inputBounds.bottom - gap - margin;
      const availableAbove = inputBounds.top - viewportTop - gap - margin;
      const preferredHeight = Math.min(340, Math.max(180, viewportHeight * .52));
      let maxHeight = Math.min(preferredHeight, Math.max(availableBelow, availableAbove));
      let top = inputBounds.bottom + gap;

      if (availableBelow < 180 && availableAbove > availableBelow) {
        maxHeight = Math.min(preferredHeight, availableAbove);
        top = inputBounds.top - gap - maxHeight;
      }

      if (Math.max(availableBelow, availableAbove) < 180) {
        maxHeight = Math.max(150, viewportHeight - margin * 2);
        top = viewportTop + margin;
      }

      top = Math.max(viewportTop + margin, Math.min(top, viewportBottom - margin - maxHeight));

      const left = Math.max(margin, Math.min(inputBounds.left, window.innerWidth - margin - inputBounds.width));
      setMobileResultsStyle({
        position: "fixed",
        top,
        left,
        width: Math.min(inputBounds.width, window.innerWidth - margin * 2),
        maxHeight,
      });
    };

    syncResultsPosition();
    const firstKeyboardSync = window.setTimeout(syncResultsPosition, 120);
    const finalKeyboardSync = window.setTimeout(syncResultsPosition, 360);
    window.addEventListener("resize", syncResultsPosition);
    window.visualViewport?.addEventListener("resize", syncResultsPosition);
    window.visualViewport?.addEventListener("scroll", syncResultsPosition);
    return () => {
      window.clearTimeout(firstKeyboardSync);
      window.clearTimeout(finalKeyboardSync);
      window.removeEventListener("resize", syncResultsPosition);
      window.visualViewport?.removeEventListener("resize", syncResultsPosition);
      window.visualViewport?.removeEventListener("scroll", syncResultsPosition);
    };
  }, [open]);
  const normalized = query.trim().toLocaleLowerCase();
  const matches = options.filter((option) => `${option.label} ${option.detail ?? ""}`.toLocaleLowerCase().includes(normalized)).slice(0, 30);
  const chooseOption = (option: SearchPickerOption) => {
    onSelect(option);
    setQuery(option.label);
    setOpen(false);
    inputRef.current?.blur();
  };
  return (
    <div className="saved-data-picker" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false); }}>
      <input
        ref={inputRef}
        role="combobox"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-autocomplete="list"
        autoComplete="off"
        value={open ? query : value}
        disabled={disabled}
        placeholder={placeholder}
        onFocus={() => { setQuery(value); setOpen(true); }}
        onChange={(event) => { setQuery(event.target.value); setOpen(true); if (allowCustom) onChange?.(event.target.value); }}
        onKeyDown={(event) => {
          if (event.key === "Escape") setOpen(false);
          if (event.key === "Enter" && matches[0]) { event.preventDefault(); chooseOption(matches[0]); }
        }}
      />
      {open && !disabled && (
        <div className="saved-data-results" role="listbox" style={mobileResultsStyle}>
          <div className="saved-data-results-heading" role="presentation"><strong>Select {ariaLabel}</strong><span>{matches.length} saved option{matches.length === 1 ? "" : "s"}</span></div>
          {matches.map((option) => <button key={option.id} type="button" role="option" aria-selected={option.label === value} onPointerDown={(event) => event.preventDefault()} onClick={() => chooseOption(option)}><strong>{option.label}</strong>{option.detail && <small>{option.detail}</small>}</button>)}
          {!matches.length && <div className="saved-data-empty">No saved matches</div>}
          {onAdd && <button type="button" className="saved-data-add" onPointerDown={(event) => event.preventDefault()} onClick={() => { onAdd(query.trim()); setOpen(false); inputRef.current?.blur(); }}>＋ {addLabel || "Add new"}{query.trim() ? `: ${query.trim()}` : ""}</button>}
        </div>
      )}
    </div>
  );
}

function StatusPill({ status }: { status: QuoteStatus | "Expired" | "Active" | "Archived" }) {
  return <span className={`status-pill status-${status.toLowerCase().replace(" ", "-")}`}><span />{quoteStatusLabel(status)}</span>;
}

function ReadinessPill({ quote, vendors }: { quote: Quote; vendors: Vendor[] }) {
  const readiness = quoteReadiness(quote, vendors);
  if (readiness.blockers.length) return <span className="readiness-pill blocked">{readiness.blockers.length} blocker{readiness.blockers.length === 1 ? "" : "s"}</span>;
  if (readiness.unresolvedWarnings.length) return <span className="readiness-pill warning">{readiness.unresolvedWarnings.length} warning{readiness.unresolvedWarnings.length === 1 ? "" : "s"}</span>;
  return <span className="readiness-pill ready">Ready to finish</span>;
}

function Dashboard({ state, currentEstimator, onNewQuote, onOpenQuote, onOpenJob }: { state: AppState; currentEstimator: CurrentEstimator; onNewQuote: () => void; onOpenQuote: (id: string, tab?: QuoteTab) => void; onOpenJob: (id: string) => void }) {
  const [companyWide, setCompanyWide] = useState(false);
  const [dashboardSearch, setDashboardSearch] = useState("");
  const currentOwnerName = currentEstimator.name.trim().toLocaleLowerCase();
  const ownedQuotes = state.quotes.filter((quote) => {
    if (quote.ownerUserId) return quote.ownerUserId === currentEstimator.id;
    const quoteOwnerName = (quote.ownerName || quote.preparedBy).trim().toLocaleLowerCase();
    return quoteOwnerName === currentOwnerName || currentOwnerName.startsWith(`${quoteOwnerName} `) || quoteOwnerName.startsWith(`${currentOwnerName} `);
  });
  const dashboardQuotes = currentEstimator.isAdmin && companyWide ? state.quotes : ownedQuotes;
  const dashboardQuoteIds = new Set(dashboardQuotes.map((quote) => quote.id));
  const dashboardJobs = state.jobs.filter((job) => dashboardQuoteIds.has(job.quoteId));
  const searchTerms = dashboardSearch.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const matchesSearch = (...values: Array<string | null | undefined>) => {
    const haystack = values.filter(Boolean).join(" ").toLocaleLowerCase();
    return searchTerms.every((term) => haystack.includes(term));
  };
  const matchingQuotes = searchTerms.length
    ? dashboardQuotes.filter((quote) => matchesSearch(
      quote.number,
      quote.project,
      quote.site,
      quote.address,
      quote.reference,
      quote.customerPo,
      quote.proposalAttention,
      quote.status,
      quote.preparedBy,
      clientName(state, quote.clientId),
      ...quote.lines.flatMap((line) => [line.description, line.vendorName, line.vendorReference, line.division]),
    )).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    : [];
  const matchingJobs = searchTerms.length
    ? dashboardJobs.filter((job) => {
      const linkedQuote = state.quotes.find((quote) => quote.id === job.quoteId);
      return matchesSearch(
        job.jobNumber,
        job.project,
        job.status,
        linkedQuote?.number,
        linkedQuote?.site,
        linkedQuote?.address,
        linkedQuote?.reference,
        clientName(state, job.clientId),
        ...(job.purchaseOrders ?? []).flatMap((purchaseOrder) => [purchaseOrder.number, purchaseOrder.vendorName, purchaseOrder.vendorQuoteNumber]),
      );
    }).sort((a, b) => b.acceptedAt.localeCompare(a.acceptedAt))
    : [];
  const activeQuotes = dashboardQuotes.filter((quote) => quote.status === "Draft" || quote.status === "Finished");
  const pipeline = activeQuotes.reduce((sum, quote) => sum + quoteTotals(quote).subtotal, 0);
  const sent = dashboardQuotes.filter((quote) => quote.status === "Finished").length;
  const wonValue = dashboardQuotes.filter((quote) => quote.status === "Won").reduce((sum, quote) => sum + quoteTotals(quote).subtotal, 0);
  const attention = activeQuotes
    .map((quote) => ({ quote, readiness: quoteReadiness(quote, state.vendors) }))
    .filter((item) => item.readiness.blockers.length || item.readiness.unresolvedWarnings.length)
    .slice(0, 5);
  const recentQuotes = [...dashboardQuotes].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 5);
  const stageValues = [
    { label: "Draft", count: dashboardQuotes.filter((quote) => quote.status === "Draft").length, value: dashboardQuotes.filter((quote) => quote.status === "Draft").reduce((sum, quote) => sum + quoteTotals(quote).subtotal, 0), color: "blue" },
    { label: "Finished", count: sent, value: dashboardQuotes.filter((quote) => quote.status === "Finished").reduce((sum, quote) => sum + quoteTotals(quote).subtotal, 0), color: "amber" },
    { label: "Won", count: dashboardQuotes.filter((quote) => quote.status === "Won").length, value: wonValue, color: "green" },
  ];
  const maxStage = Math.max(1, ...stageValues.map((stage) => stage.value));
  const recentWork = (
    <section className="panel recent-work-panel">
      <div className="panel-heading">
        <div><span className="eyebrow">RECENT WORK</span><h2>Quotes</h2></div>
        {!!recentQuotes.length && <button className="text-button" onClick={() => onOpenQuote(recentQuotes[0].id)}>Open latest <span>→</span></button>}
      </div>
      <div className="data-table-wrap">
        <table className="data-table recent-table">
          <thead><tr><th>Quote</th><th>Client / project</th><th>Value</th><th>Margin</th><th>Status</th><th>Updated</th></tr></thead>
          <tbody>
            {recentQuotes.map((quote) => {
              const totals = quoteTotals(quote);
              return (
                <tr key={quote.id} onClick={() => onOpenQuote(quote.id)}>
                  <td data-label="Quote"><strong>{quote.number}</strong><small>Rev {quote.revision}</small></td>
                  <td data-label="Client / project"><strong>{clientName(state, quote.clientId)}</strong><small>{quote.project || "Project not named"}</small></td>
                  <td data-label="Value"><strong>{money(totals.subtotal)}</strong></td>
                  <td data-label="Margin">{percent(totals.margin)}</td>
                  <td data-label="Status"><StatusPill status={quoteDisplayStatus(quote)} /></td>
                  <td data-label="Updated">{timeAgo(quote.updatedAt)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!recentQuotes.length && <EmptyInline title="No recent quotes" detail="Your newest estimates will appear here." />}
      </div>
    </section>
  );

  return (
    <div className="page-stack">
      {currentEstimator.isAdmin && <div className="dashboard-scope-switch"><span>Viewing</span><button className={!companyWide ? "active" : ""} onClick={() => setCompanyWide(false)}>My estimates</button><button className={companyWide ? "active" : ""} onClick={() => setCompanyWide(true)}>Company-wide</button></div>}
      {!companyWide && recentWork}
      <section className={`panel overview-search ${searchTerms.length ? "has-results" : ""}`}>
        <label>
          <span className="overview-search-icon" aria-hidden="true">⌕</span>
          <span className="sr-only">Search estimates and jobs</span>
          <input
            type="search"
            value={dashboardSearch}
            onChange={(event) => setDashboardSearch(event.target.value)}
            placeholder="Search quote #, job #, PO #, client, site, project or reference…"
            autoComplete="off"
            spellCheck={false}
          />
          {dashboardSearch && <button type="button" className="overview-search-clear" aria-label="Clear overview search" onClick={() => setDashboardSearch("")}>×</button>}
        </label>
        {searchTerms.length > 0 && (
          <div className="overview-search-results" aria-live="polite">
            <div className="overview-search-summary">
              <strong>{matchingQuotes.length + matchingJobs.length} result{matchingQuotes.length + matchingJobs.length === 1 ? "" : "s"}</strong>
              <span>Searching {currentEstimator.isAdmin && companyWide ? "company-wide estimates" : "your estimates"}</span>
            </div>
            {matchingQuotes.length > 0 && (
              <div className="overview-result-group">
                <h2>Quotes <span>{matchingQuotes.length}</span></h2>
                {matchingQuotes.slice(0, 8).map((quote) => (
                  <button type="button" key={quote.id} onClick={() => onOpenQuote(quote.id)}>
                    <span className="overview-result-type quote">Q</span>
                    <span><strong>{quote.number} · {quote.project || "Project not named"}</strong><small>{clientName(state, quote.clientId)}{quote.site ? ` · ${quote.site}` : ""}</small></span>
                    <StatusPill status={quoteDisplayStatus(quote)} />
                    <span className="row-arrow" aria-hidden="true">›</span>
                  </button>
                ))}
              </div>
            )}
            {matchingJobs.length > 0 && (
              <div className="overview-result-group">
                <h2>Jobs <span>{matchingJobs.length}</span></h2>
                {matchingJobs.slice(0, 8).map((job) => (
                  <button type="button" key={job.id} onClick={() => onOpenJob(job.id)}>
                    <span className="overview-result-type job">J</span>
                    <span><strong>{job.jobNumber} · {job.project}</strong><small>{clientName(state, job.clientId)}</small></span>
                    <StatusPill status={job.status} />
                    <span className="row-arrow" aria-hidden="true">›</span>
                  </button>
                ))}
              </div>
            )}
            {!matchingQuotes.length && !matchingJobs.length && <div className="overview-search-empty"><strong>No matching quotes or jobs</strong><span>Try a quote, job or PO number, client, project, site, vendor or reference.</span></div>}
          </div>
        )}
      </section>
      <section className="welcome-panel">
        <div>
          <span className="eyebrow inverse">ESTIMATING CONTROL CENTRE</span>
          <h1>Clear pricing. Controlled risk. Better handoff.</h1>
          <p>Build the quote once, review the numbers, finish a clean proposal, then connect accepted work to its Portal job.</p>
        </div>
        <div className="welcome-actions"><img src="../logo.webp" alt="John Gordon Construction" /><button className="button light" onClick={onNewQuote}>＋ Start a quote</button></div>
      </section>

      {companyWide && <section className="metric-grid">
        <MetricCard label="Active pipeline" value={compactMoney(pipeline)} detail={`${activeQuotes.length} open quotes`} tone="navy" />
        <MetricCard label="Awaiting response" value={String(sent)} detail="finished quotes awaiting response" tone="amber" />
        <MetricCard label="Won value" value={compactMoney(wonValue)} detail="pre-tax accepted work" tone="green" />
        <MetricCard label="Won quotes tracked" value={String(state.jobs.filter((job) => job.status === "Active").length)} detail="estimate follow-up only" tone="blue" />
      </section>}

      <div className={`dashboard-grid ${companyWide ? "company-wide" : "personal"}`}>
        {companyWide && <section className="panel pipeline-panel">
          <div className="panel-heading">
            <div><span className="eyebrow">PIPELINE</span><h2>Quote flow</h2></div>
            <span className="panel-note">Pre-tax value</span>
          </div>
          <div className="pipeline-bars">
            {stageValues.map((stage) => (
              <div className="pipeline-row" key={stage.label}>
                <div><strong>{stage.label}</strong><span>{stage.count} quote{stage.count === 1 ? "" : "s"}</span></div>
                <div className="bar-track"><span className={`bar-fill ${stage.color}`} style={{ width: `${Math.max(stage.value ? 8 : 0, (stage.value / maxStage) * 100)}%` }} /></div>
                <strong>{compactMoney(stage.value)}</strong>
              </div>
            ))}
          </div>
          <div className="margin-note"><span>i</span><p><strong>Markup and margin are different.</strong> A 20% markup produces a 16.7% gross margin. Estimate Desk shows both.</p></div>
        </section>}

        <section className="panel attention-panel">
          <div className="panel-heading">
              <div><span className="eyebrow">ATTENTION</span><h2>Before you finish</h2></div>
            <span className="count-badge">{attention.length}</span>
          </div>
          {attention.length ? (
            <div className="attention-list">
              {attention.map(({ quote, readiness }) => (
                <button key={quote.id} onClick={() => onOpenQuote(quote.id, "review")}>
                  <span className={`attention-icon ${readiness.blockers.length ? "danger" : "warn"}`}>{readiness.blockers.length ? "!" : "△"}</span>
                  <span><strong>{quote.project || quote.number}</strong><small>{readiness.blockers.length ? `${readiness.blockers.length} blocker(s)` : `${readiness.unresolvedWarnings.length} warning(s)`}</small></span>
                  <span className="row-arrow">›</span>
                </button>
              ))}
            </div>
          ) : <EmptyInline title="Nothing needs attention" detail="Open quotes have passed their current readiness checks." />}
        </section>
      </div>

      {companyWide && recentWork}
    </div>
  );
}

function MetricCard({ label, value, detail, tone }: { label: string; value: string; detail: string; tone: string }) {
  return (
    <div className={`metric-card ${tone}`}>
      <span className="metric-label">{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}

function EmptyInline({ title, detail }: { title: string; detail: string }) {
  return <div className="empty-inline"><span>✓</span><strong>{title}</strong><p>{detail}</p></div>;
}

type LibraryPathPart = { key: string; label: string };
type LibraryRecord<T> = {
  item: T;
  creator: LibraryPathPart;
  year: LibraryPathPart;
  client: LibraryPathPart;
  location: LibraryPathPart;
  value: number;
};

const libraryLevels = [
  { name: "Created by", field: "creator" },
  { name: "Year", field: "year" },
  { name: "Client", field: "client" },
  { name: "Location", field: "location" },
] as const;

function libraryPart(record: LibraryRecord<unknown>, level: number) {
  return record[libraryLevels[level].field];
}

function LibraryFolders<T>({ records, path, setPath, noun, renderItems }: {
  records: LibraryRecord<T>[];
  path: LibraryPathPart[];
  setPath: (path: LibraryPathPart[]) => void;
  noun: "quote" | "job";
  renderItems: (items: T[]) => React.ReactNode;
}) {
  const scoped = records.filter((record) => path.every((part, level) => libraryPart(record as LibraryRecord<unknown>, level).key === part.key));
  const breadcrumbs = (
    <nav className="library-breadcrumbs" aria-label={`${noun} folders`}>
      <button onClick={() => setPath([])}>All {noun}s</button>
      {path.map((part, index) => <Fragment key={`${part.key}-${index}`}><span>›</span><button onClick={() => setPath(path.slice(0, index + 1))}>{part.label}</button></Fragment>)}
    </nav>
  );
  if (path.length === libraryLevels.length) return <><section className="panel library-path-panel">{breadcrumbs}</section>{renderItems(scoped.map((record) => record.item))}</>;

  const level = libraryLevels[path.length];
  const grouped = Array.from(scoped.reduce((groups, record) => {
    const part = libraryPart(record as LibraryRecord<unknown>, path.length);
    const current = groups.get(part.key) ?? { part, count: 0, value: 0 };
    current.count += 1;
    current.value += record.value;
    groups.set(part.key, current);
    return groups;
  }, new Map<string, { part: LibraryPathPart; count: number; value: number }>()).values()).sort((a, b) => {
    if (level.field === "year") return b.part.label.localeCompare(a.part.label, undefined, { numeric: true });
    return a.part.label.localeCompare(b.part.label, undefined, { numeric: true });
  });

  return (
    <section className="panel library-browser">
      {breadcrumbs}
      <div className="library-stage-heading"><div><span className="eyebrow">{level.name}</span><h2>{path.length ? path[path.length - 1].label : `Browse ${noun}s`}</h2></div><small>{scoped.length} {noun}{scoped.length === 1 ? "" : "s"}</small></div>
      <div className="library-folder-grid">
        {grouped.map((group) => (
          <button key={group.part.key} className="library-folder" onClick={() => setPath([...path, group.part])}>
            <span className="library-folder-icon" aria-hidden="true">▰</span>
            <span><small>{level.name}</small><strong>{group.part.label}</strong><em>{group.count} {noun}{group.count === 1 ? "" : "s"} · {money(group.value)}</em></span>
            <b aria-hidden="true">›</b>
          </button>
        ))}
      </div>
      {!grouped.length && <div className="empty-state compact-empty"><span>⌕</span><h3>No {noun}s in this folder</h3><p>Change the status filter or return to All {noun}s.</p></div>}
    </section>
  );
}

function QuotesPage({ state, search, setSearch, statusFilter, setStatusFilter, onNewQuote, onOpenQuote, onDelete }: {
  state: AppState;
  search: string;
  setSearch: (value: string) => void;
  statusFilter: string;
  setStatusFilter: (value: string) => void;
  onNewQuote: () => void;
  onOpenQuote: (id: string, tab?: QuoteTab) => void;
  onDelete: (quote: Quote) => void;
}) {
  const [libraryPath, setLibraryPath] = useState<LibraryPathPart[]>([]);
  const normalized = search.toLowerCase();
  const quotes = state.quotes.filter((quote) => {
    const status = quoteDisplayStatus(quote);
    const matchesStatus = statusFilter === "All" || status === statusFilter;
    const haystack = `${quote.number} ${quote.preparedBy} ${clientName(state, quote.clientId)} ${quote.site} ${quote.project} ${quote.reference}`.toLowerCase();
    return matchesStatus && haystack.includes(normalized);
  });

  const quoteRecords: LibraryRecord<Quote>[] = quotes.map((quote) => {
    const creator = quote.preparedBy.trim() || "Unassigned";
    const year = (quote.quoteDate || quote.createdAt).slice(0, 4) || "No year";
    const clientLabel = clientName(state, quote.clientId);
    const location = quote.site.trim() || "No location";
    return {
      item: quote,
      creator: { key: creator.toLocaleLowerCase(), label: creator },
      year: { key: year, label: year },
      client: { key: quote.clientId || "__no_client__", label: clientLabel },
      location: { key: location.toLocaleLowerCase(), label: location },
      value: quoteTotals(quote).subtotal,
    };
  });

  const renderQuoteTable = (items: Quote[]) => (
    <section className="panel table-panel">
      <div className="table-summary"><strong>{items.length} quote{items.length === 1 ? "" : "s"}</strong><span>{search.trim() ? "Search results across every folder." : "Internal prices are never shown on customer proposals."}</span></div>
      <div className="data-table-wrap">
        <table className="data-table quotes-table">
          <thead><tr><th>Quote</th><th>Client / project</th><th>Pre-tax price</th><th>Profit / margin</th><th>Readiness</th><th>Status</th><th>Valid until</th><th><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>
            {items.map((quote) => {
              const totals = quoteTotals(quote);
              return (
                <tr key={quote.id} onClick={() => onOpenQuote(quote.id)}>
                  <td data-label="Quote"><strong>{quote.number}</strong><small>Revision {quote.revision}{quote.demo ? " · Demo" : ""} · {quote.preparedBy || "Unassigned"}</small></td>
                  <td data-label="Client / project"><strong>{clientName(state, quote.clientId)}</strong><small>{quote.site || "No location"} · {quote.project || "Project not named"}</small></td>
                  <td data-label="Price"><strong>{money(totals.subtotal)}</strong><small>{money(totals.total)} incl. {quote.taxName}</small></td>
                  <td data-label="Margin"><strong>{money(totals.profit)}</strong><small>{percent(totals.margin)} margin</small></td>
                  <td data-label="Readiness"><ReadinessPill quote={quote} vendors={state.vendors} /></td>
                  <td data-label="Status"><StatusPill status={quoteDisplayStatus(quote)} /></td>
                  <td data-label="Valid until">{shortDate(quote.validUntil)}</td>
                  <td className="row-actions" onClick={(event) => event.stopPropagation()}>
                    <button className="quote-delete-button" title={state.jobs.some((job) => job.quoteId === quote.id) ? "Won quote is protected by its Jobs tracking record" : `Delete ${quote.number}`} aria-label={`Delete ${quote.number}`} disabled={state.jobs.some((job) => job.quoteId === quote.id)} onClick={() => onDelete(quote)}>×</button>
                    <button title="Open quote" onClick={() => onOpenQuote(quote.id)}>›</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!items.length && <div className="empty-state"><span>▤</span><h3>No quotes found</h3><p>Try another filter or create a new quote.</p><button className="button primary" onClick={onNewQuote}>New quote</button></div>}
    </section>
  );

  return (
    <div className="page-stack">
      <PageHeading
        eyebrow="SALES PIPELINE"
        title="Quotes"
        description="Browse by estimator, year, client and work location, or search across every quote."
        actions={<button className="button primary" onClick={onNewQuote}>＋ New quote</button>}
      />
      <section className="panel toolbar-panel">
        <div className="search-field"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search quote, client, project or reference" aria-label="Search quotes" /></div>
        <div className="filter-tabs" role="group" aria-label="Filter quotes by status">
          {[{ value: "All", label: "All" }, { value: "Draft", label: "Draft" }, { value: "Finished", label: "Finished" }, { value: "Won", label: "Won" }, { value: "Lost", label: "Lost" }, { value: "Expired", label: "Expired" }].map((status) => (
            <button key={status.value} className={statusFilter === status.value ? "active" : ""} onClick={() => { setStatusFilter(status.value); setLibraryPath([]); }}>{status.label}</button>
          ))}
        </div>
      </section>
      {search.trim() ? renderQuoteTable(quotes) : <LibraryFolders records={quoteRecords} path={libraryPath} setPath={setLibraryPath} noun="quote" renderItems={renderQuoteTable} />}
    </div>
  );
}

function JobCreateModal({ quote, existingJobNumbers, portalJobs: availablePortalJobs, onCancel, onConfirm }: {
  quote: Quote;
  existingJobNumbers: string[];
  portalJobs: PortalJobOption[];
  onCancel: () => void;
  onConfirm: (jobNumber: string) => void;
}) {
  const [jobNumber, setJobNumber] = useState("");
  const [error, setError] = useState("");
  const selectedPortalJob = availablePortalJobs.find((job) => job.jobNumber === jobNumber);
  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = jobNumber.trim();
    if (!value) {
      setError("Choose an active job number from the JGC Portal job list.");
      return;
    }
    if (existingJobNumbers.some((number) => number.trim().toLocaleLowerCase() === value.toLocaleLowerCase())) {
      setError("That job number is already connected to another quote.");
      return;
    }
    if (!availablePortalJobs.some((job) => job.active && job.jobNumber.trim().toLocaleLowerCase() === value.toLocaleLowerCase())) {
      setError("That number is not an active job in the JGC Portal.");
      return;
    }
    onConfirm(value);
  };
  return (
    <div className="modal-layer" role="presentation" onMouseDown={onCancel}>
      <section className="modal-card job-create-modal" role="dialog" aria-modal="true" aria-labelledby="create-job-title" onMouseDown={(event) => event.stopPropagation()}>
        <header><div><span className="eyebrow">ACCEPTED QUOTE HANDOFF</span><h2 id="create-job-title">Make into job</h2></div><button aria-label="Close" onClick={onCancel}>×</button></header>
        <form onSubmit={submit}>
          <div className="job-create-content">
            <div className="job-create-quote"><span>{quote.number} · Rev {quote.revision}</span><strong>{quote.project || "Project not named"}</strong></div>
            <label className="field"><span>Portal job <b>*</b></span><SearchablePicker value={jobNumber} options={availablePortalJobs.filter((job) => job.active).map((job) => ({ id: job.id, label: job.jobNumber, detail: `${job.jobName}${job.customer ? ` · ${job.customer}` : ""}` }))} placeholder="Search by job number or job name" ariaLabel="Portal job" onSelect={(option) => { setJobNumber(option.label); setError(""); }} /></label>
            {selectedPortalJob && <div className="selected-portal-job"><span>SELECTED PORTAL JOB</span><strong>{selectedPortalJob.jobNumber}</strong><p>{selectedPortalJob.jobName}</p></div>}
            {error && <p className="field-error" role="alert">{error}</p>}
            <div className="estimating-boundary-note"><strong>Connected to the Portal</strong><p>The quote will be linked to this existing job. If the Portal job later becomes inactive, it will move into the Estimate Desk archive automatically.</p></div>
          </div>
          <footer><button type="button" className="button secondary" onClick={onCancel}>Cancel</button><button type="submit" className="button success">Make into job</button></footer>
        </form>
      </section>
    </div>
  );
}

function PurchaseOrderModal({ state, job, quote, sourceLine, purchaseOrder, onCancel, onSave }: {
  state: AppState;
  job: Job;
  quote: Quote;
  sourceLine: QuoteLine | null;
  purchaseOrder: PurchaseOrder | null;
  onCancel: () => void;
  onSave: (purchaseOrder: PurchaseOrder) => void;
}) {
  const sourceVendor = sourceLine?.vendorId ? state.vendors.find((vendor) => vendor.id === sourceLine.vendorId) : null;
  const now = new Date().toISOString();
  const initial: PurchaseOrder = purchaseOrder ?? {
    id: uid("po"),
    number: job.jobNumber,
    status: "Draft",
    vendorId: sourceVendor?.id ?? sourceLine?.vendorId ?? null,
    vendorName: sourceVendor?.name ?? sourceLine?.vendorName?.trim() ?? "",
    vendorContact: sourceVendor?.contact ?? "",
    vendorEmail: sourceVendor?.email ?? "",
    vendorPhone: sourceVendor?.phone ?? "",
    vendorQuoteNumber: sourceLine?.vendorReference.trim() ?? "",
    issueDate: today(),
    shipBy: "Your Means",
    shipVia: "Your Means",
    fob: "Job Site",
    shipTo: quote.site.trim() || "Job Site",
    authorizedBy: state.settings.signatoryName ?? quote.preparedBy ?? "Zeth Hummel",
    taxRate: quote.taxRate,
    notes: "The purchase order number must appear on all invoices and documents relating to this order. Complete only the work described and obtain written approval before any extra work.",
    lines: sourceLine ? [{
      id: uid("po-line"),
      quoteLineId: sourceLine.id,
      description: sourceLine.description,
      quantity: sourceLine.quantity,
      unit: sourceLine.unit,
      unitCost: effectiveUnitCost(sourceLine),
      amount: preciseLineDirectCost(sourceLine),
      sourceReference: sourceLine.vendorReference,
    }] : [],
    createdAt: now,
    updatedAt: now,
  };
  const [draft, setDraft] = useState<PurchaseOrder>(initial);
  const [error, setError] = useState("");
  const subtotal = draft.lines.reduce((sum, line) => sum + line.amount, 0);
  const hst = subtotal * draft.taxRate;
  const update = <K extends keyof PurchaseOrder>(key: K, value: PurchaseOrder[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const updateLine = (patch: Partial<PurchaseOrder["lines"][number]>) => setDraft((current) => ({
    ...current,
    lines: current.lines.map((line, index) => index === 0 ? { ...line, ...patch } : line),
  }));
  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!draft.number.trim()) return setError("Enter the JGC purchase order number.");
    if (!draft.vendorName.trim()) return setError("Enter the subcontractor company name.");
    if (!draft.lines.length || !draft.lines[0].description.trim()) return setError("Enter the work being authorized.");
    if (!(draft.lines[0].amount > 0)) return setError("Enter a purchase order amount above zero.");
    onSave({ ...draft, number: draft.number.trim(), vendorName: draft.vendorName.trim(), updatedAt: new Date().toISOString() });
  };
  return (
    <div className="modal-layer" role="presentation" onMouseDown={onCancel}>
      <section className="modal-card purchase-order-modal" role="dialog" aria-modal="true" aria-labelledby="purchase-order-title" onMouseDown={(event) => event.stopPropagation()}>
        <header><div><span className="eyebrow">SUBCONTRACTOR COMMITMENT</span><h2 id="purchase-order-title">{purchaseOrder ? `Edit PO ${purchaseOrder.number}` : "Create purchase order"}</h2></div><button aria-label="Close" onClick={onCancel}>×</button></header>
        <form onSubmit={submit}>
          <div className="purchase-order-form">
            <div className="po-source-banner"><div><span>JOB</span><strong>{job.jobNumber} · {job.project}</strong></div><div><span>ACCEPTED QUOTE</span><strong>{quote.number} · Rev {quote.revision}</strong></div></div>
            <div className="form-grid four-column">
              <label className="field"><span>JGC PO number <b>*</b></span><input autoFocus value={draft.number} onChange={(event) => { update("number", event.target.value); setError(""); }} /></label>
              <label className="field"><span>PO date</span><input type="date" value={draft.issueDate} onChange={(event) => update("issueDate", event.target.value)} /></label>
              <label className="field"><span>Status</span><select value={draft.status} onChange={(event) => update("status", event.target.value as PurchaseOrder["status"])}><option>Draft</option><option>Issued</option><option>Void</option></select></label>
              <label className="field"><span>Vendor quote #</span><input value={draft.vendorQuoteNumber} onChange={(event) => update("vendorQuoteNumber", event.target.value)} placeholder="e.g. Q25-130" /></label>
              <label className="field two-wide"><span>Subcontractor company <b>*</b></span><input value={draft.vendorName} onChange={(event) => { update("vendorName", event.target.value); setError(""); }} /></label>
              <label className="field"><span>Contact</span><input value={draft.vendorContact} onChange={(event) => update("vendorContact", event.target.value)} /></label>
              <label className="field"><span>Email</span><input type="email" value={draft.vendorEmail} onChange={(event) => update("vendorEmail", event.target.value)} /></label>
              <label className="field"><span>Phone</span><input value={draft.vendorPhone} onChange={(event) => update("vendorPhone", event.target.value)} /></label>
              <label className="field"><span>Ship by</span><input value={draft.shipBy} onChange={(event) => update("shipBy", event.target.value)} /></label>
              <label className="field"><span>Ship via</span><input value={draft.shipVia} onChange={(event) => update("shipVia", event.target.value)} /></label>
              <label className="field"><span>F.O.B.</span><input value={draft.fob} onChange={(event) => update("fob", event.target.value)} /></label>
              <label className="field two-wide"><span>Ship to / job site</span><input value={draft.shipTo} onChange={(event) => update("shipTo", event.target.value)} /></label>
              <label className="field"><span>Authorized by</span><input value={draft.authorizedBy} onChange={(event) => update("authorizedBy", event.target.value)} /></label>
              <label className="field"><span>HST rate</span><div className="input-suffix"><input type="number" min="0" step="0.1" value={draft.taxRate * 100} onChange={(event) => update("taxRate", Number(event.target.value) / 100)} /><span>%</span></div></label>
            </div>
            <div className="po-line-editor">
              <div className="po-line-heading"><div><span className="eyebrow">AUTHORIZED WORK</span><h3>Subcontractor line</h3></div><span className="po-cost-rule">Uses direct estimate cost - no customer markup</span></div>
              {draft.lines.slice(0, 1).map((line) => (
                <div className="po-line-grid" key={line.id}>
                  <label className="field po-description"><span>Description</span><textarea rows={3} value={line.description} onChange={(event) => { updateLine({ description: event.target.value }); setError(""); }} /></label>
                  <label className="field"><span>Qty</span><input type="number" min="0" step="0.01" value={line.quantity} onChange={(event) => { const quantity = Number(event.target.value); updateLine({ quantity, amount: Math.round(quantity * line.unitCost * 100) / 100 }); }} /></label>
                  <label className="field"><span>Unit</span><input value={line.unit} onChange={(event) => updateLine({ unit: event.target.value })} /></label>
                  <label className="field"><span>Unit cost</span><div className="input-prefix"><span>$</span><input type="number" min="0" step="0.01" value={line.unitCost} onChange={(event) => { const unitCost = Number(event.target.value); updateLine({ unitCost, amount: Math.round(line.quantity * unitCost * 100) / 100 }); }} /></div></label>
                  <label className="field"><span>Pre-tax amount</span><div className="input-prefix"><span>$</span><input type="number" min="0" step="0.01" value={line.amount} onChange={(event) => { updateLine({ amount: Number(event.target.value) }); setError(""); }} /></div></label>
                  <label className="field po-reference"><span>Source quote #</span><input value={line.sourceReference} onChange={(event) => { updateLine({ sourceReference: event.target.value }); update("vendorQuoteNumber", event.target.value); }} /></label>
                </div>
              ))}
              <div className="po-total-preview"><div><span>Subtotal</span><strong>{money(subtotal)}</strong></div><div><span>HST</span><strong>{money(hst)}</strong></div><div className="grand"><span>Total</span><strong>{money(subtotal + hst)}</strong></div></div>
            </div>
            <label className="field"><span>PO instructions / notes</span><textarea rows={3} value={draft.notes} onChange={(event) => update("notes", event.target.value)} /></label>
            {error && <p className="field-error" role="alert">{error}</p>}
            <div className="estimating-boundary-note"><strong>Saved as a snapshot</strong><p>This PO keeps its own subcontractor, quote number and amount. Later estimate changes will not rewrite it.</p></div>
          </div>
          <footer><button type="button" className="button secondary" onClick={onCancel}>Cancel</button><button type="submit" className="button success">{purchaseOrder ? "Save PO changes" : "Create PO"}</button></footer>
        </form>
      </section>
    </div>
  );
}

function QuoteDeleteModal({ quote, linkedJob, onCancel, onConfirm }: { quote: Quote; linkedJob: boolean; onCancel: () => void; onConfirm: () => void }) {
  return (
    <div className="modal-layer" role="presentation" onMouseDown={onCancel}>
      <section className="modal-card confirm-card" role="dialog" aria-modal="true" aria-labelledby="delete-quote-title" onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <div><span className="eyebrow danger-eyebrow">DELETE QUOTE</span><h2 id="delete-quote-title">{linkedJob ? "This quote is protected" : "Delete this quote?"}</h2></div>
          <button aria-label="Cancel deletion" onClick={onCancel}>×</button>
        </header>
        <div className="confirm-content">
          <div className="confirm-line-name"><span>{quote.number}</span><strong>{quote.project || "Project not named"}</strong></div>
          <p>{linkedJob ? "This won quote is connected to its estimate follow-up record in Jobs, so it cannot be deleted from the quote list." : "This permanently removes the quote, its estimate lines, revision history and activity. This cannot be undone."}</p>
        </div>
        <footer className="confirm-actions">
          <button className="button secondary" onClick={onCancel}>{linkedJob ? "Close" : "Keep quote"}</button>
          {!linkedJob && <button className="button danger-solid" onClick={onConfirm}>Delete quote</button>}
        </footer>
      </section>
    </div>
  );
}

function QuoteFinishModal({ quote, warningCount, onCancel, onConfirm }: { quote: Quote; warningCount: number; onCancel: () => void; onConfirm: () => void }) {
  return (
    <div className="modal-layer" role="presentation" onMouseDown={onCancel}>
      <section className="modal-card confirm-card" role="dialog" aria-modal="true" aria-labelledby="finish-quote-title" onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <div><span className="eyebrow">FINISH QUOTE</span><h2 id="finish-quote-title">Mark {quote.number} as Finished?</h2></div>
          <button aria-label="Cancel" onClick={onCancel}>×</button>
        </header>
        <div className="confirm-content">
          <div className="confirm-line-name"><span>{quote.project || "Project not named"}</span><strong>{warningCount} reviewed warning{warningCount === 1 ? "" : "s"}</strong></div>
          <p>The quote will remain editable. Nothing is locked or made into a Portal job until you use <strong>Make into job</strong>.</p>
        </div>
        <footer className="confirm-actions">
          <button className="button secondary" onClick={onCancel}>Keep editing</button>
          <button className="button primary" onClick={onConfirm}>Finish quote</button>
        </footer>
      </section>
    </div>
  );
}

function QuoteWorkspace({
  state,
  setState,
  quote,
  tab,
  setTab,
  onBack,
  mutateQuote,
  duplicateQuote,
  createRevision,
  finalizeQuote,
  createJob,
  markLost,
  removeQuote,
  expandedLineId,
  setExpandedLineId,
  catalogToAdd,
  setCatalogToAdd,
  onEditPurchaseOrder,
}: {
  state: AppState;
  setState: React.Dispatch<React.SetStateAction<AppState>>;
  quote: Quote;
  tab: QuoteTab;
  setTab: (tab: QuoteTab) => void;
  onBack: () => void;
  mutateQuote: (id: string, updater: (quote: Quote) => Quote, activity?: { title: string; detail: string }) => void;
  duplicateQuote: (quote: Quote) => void;
  createRevision: (quote: Quote) => void;
  finalizeQuote: (quote: Quote) => void;
  createJob: (quote: Quote) => void;
  markLost: (quote: Quote) => void;
  removeQuote: (quote: Quote) => void;
  expandedLineId: string | null;
  setExpandedLineId: (id: string | null) => void;
  catalogToAdd: string;
  setCatalogToAdd: (code: string) => void;
  onEditPurchaseOrder: (jobId: string, purchaseOrderId: string) => void;
}) {
  const [revisionConfirmOpen, setRevisionConfirmOpen] = useState(false);
  const totals = quoteTotals(quote);
  const readiness = quoteReadiness(quote, state.vendors);
  const locked = quote.status === "Won" || quote.status === "Lost";
  const linkedJob = state.jobs.find((job) => job.quoteId === quote.id) ?? null;
  const linkedPurchaseOrders = linkedJob?.purchaseOrders ?? [];
  const tabs: { key: QuoteTab; label: string; badge?: number }[] = [
    { key: "details", label: "Details" },
    { key: "estimate", label: "Estimate", badge: quote.lines.length },
    { key: "breakdown", label: "Breakdown", badge: quote.lines.filter((line) => line.costBuildUp).length },
    { key: "review", label: "Review", badge: readiness.blockers.length + readiness.unresolvedWarnings.length },
    { key: "divisions", label: "Divisions", badge: divisionSummaries(quote).filter((division) => division.lineCount > 0).length },
    { key: "proposal", label: "Proposal" },
    ...(linkedPurchaseOrders.length ? [{ key: "purchase-orders" as const, label: "POs", badge: linkedPurchaseOrders.length }] : []),
    { key: "history", label: "History", badge: quote.revisions.length + (quote.status === "Draft" ? 0 : 1) },
  ];

  const updateQuoteField = <K extends keyof Quote>(field: K, value: Quote[K]) => {
    mutateQuote(quote.id, (current) => ({ ...current, [field]: value, acknowledgedWarnings: {} }));
  };

  return (
    <div className="quote-workspace">
      <div className="quote-topline">
        <button className="back-button" onClick={onBack}>← All quotes</button>
        <div className="quote-identity">
          <div>
            <span className="eyebrow">{quote.number} · REV {quote.revision}</span>
            <h1>{quote.project || "Untitled quote"}</h1>
            <p>{clientName(state, quote.clientId)}{quote.site ? ` · ${quote.site}` : ""}</p>
          </div>
          <div className="identity-badges"><StatusPill status={quoteDisplayStatus(quote)} /><ReadinessPill quote={quote} vendors={state.vendors} /></div>
        </div>
        <div className="quote-primary-actions">
          <button className="button secondary quote-package-download" onClick={() => void downloadQuotePackage(state, quote)}>⇩ Download Proposal, Estimate, Breakdown</button>
          {quote.demo && <button className="button danger-ghost" onClick={() => removeQuote(quote)}>Delete demo</button>}
          {quote.status === "Draft" && <button className="button primary" onClick={() => finalizeQuote(quote)}>Finish quote</button>}
          {quote.status === "Finished" && <button className="button success" onClick={() => createJob(quote)}>Make into job</button>}
          {quote.status === "Finished" && <button className="button danger-ghost" onClick={() => markLost(quote)}>Lost</button>}
        </div>
      </div>

      {locked && (
        <div className="locked-banner">
          <span>🔒</span>
          <div><strong>This {quote.status.toLowerCase()} quote is preserved and read-only.</strong><p>The estimate used for the job or closed quote remains intact for history and audit reference.</p></div>
        </div>
      )}
      {quote.status === "Finished" && <div className="finished-banner"><span>✓</span><div><strong>This quote is finished but still editable.</strong><p>Make any client-requested changes directly. Use Make into job only after the quote is accepted.</p></div></div>}

      <div className="quote-tabs" role="tablist" aria-label="Quote workflow">
        {tabs.map((item, index) => (
          <button key={item.key} role="tab" aria-selected={tab === item.key} className={tab === item.key ? "active" : ""} onClick={() => setTab(item.key)}>
            <span className="tab-number">{index + 1}</span>{item.label}
            {!!item.badge && <span className={`tab-badge ${item.key === "review" && readiness.blockers.length ? "danger" : ""}`}>{item.badge}</span>}
          </button>
        ))}
      </div>

      <div className="quote-tab-content">
        {tab === "details" && <QuoteDetails state={state} setState={setState} quote={quote} locked={locked} updateField={updateQuoteField} />}
        {tab === "estimate" && (
          <EstimateBuilder
            state={state}
            quote={quote}
            locked={locked}
            mutateQuote={mutateQuote}
            expandedLineId={expandedLineId}
            setExpandedLineId={setExpandedLineId}
            catalogToAdd={catalogToAdd}
            setCatalogToAdd={setCatalogToAdd}
          />
        )}
        {tab === "breakdown" && <QuoteBreakdown state={state} quote={quote} />}
        {tab === "review" && <QuoteReview state={state} quote={quote} locked={locked} mutateQuote={mutateQuote} setTab={setTab} finalizeQuote={finalizeQuote} duplicateQuote={duplicateQuote} />}
        {tab === "divisions" && <QuoteDivisions quote={quote} />}
        {tab === "proposal" && <QuoteProposal state={state} quote={quote} />}
        {tab === "purchase-orders" && linkedJob && <QuotePurchaseOrders state={state} quote={quote} job={linkedJob} onEditPurchaseOrder={onEditPurchaseOrder} />}
        {tab === "history" && <QuoteHistory state={state} quote={quote} />}
      </div>

      {tab !== "proposal" && tab !== "purchase-orders" && (
        <div className="sticky-quote-summary">
          <div><span>Direct cost</span><strong>{money(totals.directCost)}</strong></div>
          <div><span>Quote price</span><strong>{money(totals.subtotal)}</strong></div>
          <div className={totals.margin < quote.targetMargin ? "metric-alert" : ""}><span>Gross margin</span><strong>{percent(totals.margin)}</strong></div>
          <div><span>Total with {quote.taxName}</span><strong>{money(totals.total)}</strong></div>
        </div>
      )}

      {revisionConfirmOpen && (
        <div className="modal-layer" role="presentation" onMouseDown={() => setRevisionConfirmOpen(false)}>
          <section className="modal-card confirm-card" role="dialog" aria-modal="true" aria-labelledby="create-revision-title" onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <div><span className="eyebrow">PRESERVE THE ORIGINAL</span><h2 id="create-revision-title">Start Revision {quote.revision + 1}?</h2></div>
              <button aria-label="Close" onClick={() => setRevisionConfirmOpen(false)}>×</button>
            </header>
            <div className="confirm-content">
              <div className="revision-confirm-summary"><span>Finished version</span><strong>{quote.number} · Revision {quote.revision}</strong></div>
              <p>The finished version will be frozen in History. Revision {quote.revision + 1} will be an editable copy where you can add, remove or change estimate items and proposal wording.</p>
            </div>
            <footer className="confirm-actions">
              <button className="button secondary" onClick={() => setRevisionConfirmOpen(false)}>Keep finished</button>
              <button className="button primary" onClick={() => { setRevisionConfirmOpen(false); createRevision(quote); }}>Create editable revision</button>
            </footer>
          </section>
        </div>
      )}
    </div>
  );
}

function QuoteDetails({ state, setState, quote, locked, updateField }: {
  state: AppState;
  setState: React.Dispatch<React.SetStateAction<AppState>>;
  quote: Quote;
  locked: boolean;
  updateField: <K extends keyof Quote>(field: K, value: Quote[K]) => void;
}) {
  const selectedClient = state.clients.find((client) => client.id === quote.clientId);
  const clientContacts = selectedClient?.contacts ?? [];
  const saveAttentionContact = (name: string) => {
    const cleanName = name.trim();
    if (!selectedClient || !cleanName) return;
    const existing = clientContacts.find((contact) => contact.name.trim().toLocaleLowerCase() === cleanName.toLocaleLowerCase());
    if (existing) {
      updateField("proposalAttentionContactId", existing.id);
      updateField("proposalAttention", existing.name);
      return;
    }
    const contact: ClientContact = { id: uid("client-contact"), name: cleanName, role: "", email: "", phone: "" };
    setState((current) => ({ ...current, clients: current.clients.map((client) => client.id === selectedClient.id ? { ...client, contacts: [...(client.contacts ?? []), contact] } : client) }));
    updateField("proposalAttentionContactId", contact.id);
    updateField("proposalAttention", contact.name);
  };
  return (
    <div className="content-grid details-grid-layout">
      <section className="panel form-panel">
        <div className="panel-heading"><div><span className="eyebrow">QUOTE SETUP</span><h2>Client and project</h2></div><span className="step-chip">Step 1 of 7</span></div>
        <div className="form-grid two-column">
          <label className="field"><span>Client <b>*</b></span><SearchablePicker value={selectedClient?.name ?? ""} options={state.clients.map((client) => ({ id: client.id, label: client.name, detail: `${client.sites.length} site${client.sites.length === 1 ? "" : "s"}` }))} disabled={locked} placeholder="Search clients" ariaLabel="Client" onSelect={(option) => { updateField("clientId", option.id); updateField("site", ""); updateField("address", ""); updateField("proposalAttention", ""); updateField("proposalAttentionContactId", ""); }} /></label>
          <label className="field"><span>Attention <em>Saved under this client</em></span><SearchablePicker value={quote.proposalAttention ?? ""} options={clientContacts.map((contact) => ({ id: contact.id, label: contact.name, detail: [contact.role, contact.email, contact.phone].filter(Boolean).join(" · ") }))} disabled={locked || !selectedClient} placeholder={selectedClient ? "Search or add an attention contact" : "Select a client first"} ariaLabel="Attention contact" allowCustom onChange={(value) => { updateField("proposalAttention", value); updateField("proposalAttentionContactId", ""); }} onSelect={(option) => { updateField("proposalAttentionContactId", option.id); updateField("proposalAttention", option.label); }} onAdd={saveAttentionContact} addLabel="Save new attention contact" /></label>
          <label className="field">
            <span>Site name <em>Search saved sites or add a new one</em></span>
            <SearchablePicker value={quote.site} options={(selectedClient?.sites ?? []).map((site) => ({ id: site.id, label: site.label, detail: site.address }))} disabled={locked || !quote.clientId} placeholder={quote.clientId ? "Search saved sites" : "Select a client first"} ariaLabel="Site name" allowCustom onChange={(value) => { updateField("site", value); const saved = selectedClient?.sites.find((site) => site.label.trim().toLocaleLowerCase() === value.trim().toLocaleLowerCase()); updateField("address", saved?.address ?? ""); }} onSelect={(option) => { const site = selectedClient?.sites.find((candidate) => candidate.id === option.id); updateField("site", option.label); updateField("address", site?.address ?? ""); }} onAdd={(value) => { updateField("site", value); updateField("address", ""); }} addLabel="Use new site" />
            {!locked && quote.clientId && <small>New sites and addresses are saved to this client when you finish the quote.</small>}
          </label>
          <label className="field"><span>Address</span><input value={quote.address ?? ""} disabled={locked} onChange={(event) => updateField("address", event.target.value)} placeholder="Project street address (optional)" /></label>
          <label className="field full"><span>Project name <b>*</b></span><input value={quote.project} disabled={locked} onChange={(event) => updateField("project", event.target.value)} placeholder="e.g. Office renovation — Phase 1" /></label>
          <label className="field"><span>Customer / RFP reference</span><input value={quote.reference} disabled={locked} onChange={(event) => updateField("reference", event.target.value)} /></label>
          <label className="field"><span>Prepared by</span><input value={quote.preparedBy} disabled={locked} onChange={(event) => updateField("preparedBy", event.target.value)} /></label>
          <label className="field"><span>Quote date</span><input type="date" value={quote.quoteDate} disabled={locked} onChange={(event) => updateField("quoteDate", event.target.value)} /></label>
          <label className="field"><span>Valid until</span><input type="date" value={quote.validUntil} disabled={locked} onChange={(event) => updateField("validUntil", event.target.value)} /></label>
          <label className="field"><span>Customer document</span><select value={quote.customerQuoteType ?? "Proposal Quote"} disabled={locked} onChange={(event) => updateField("customerQuoteType", event.target.value as Quote["customerQuoteType"])}><option>Proposal Quote</option><option>Budget Quote</option></select></label>
          <label className="field"><span>Deposit</span><div className="input-suffix"><input type="number" min="0" max="100" step="1" value={quote.depositPercent * 100} disabled={locked} onChange={(event) => updateField("depositPercent", Number(event.target.value) / 100)} /><span>%</span></div></label>
        </div>
      </section>

      <aside className="panel pricing-controls">
        <div className="panel-heading"><div><span className="eyebrow">PRICING CONTROLS</span><h2>Defaults</h2></div></div>
        <label className="control-row range-control"><span><strong>Project markup</strong><small>Applied unless a line overrides it</small></span><div><input type="range" min="0" max="100" step="0.5" value={quote.defaultMarkup * 100} disabled={locked} style={{ "--range-fill": `${quote.defaultMarkup * 100}%` } as React.CSSProperties} onChange={(event) => updateField("defaultMarkup", Number(event.target.value) / 100)} /><output>{percent(quote.defaultMarkup)}</output></div></label>
        <label className="control-row range-control"><span><strong>Target margin</strong><small>Creates a warning below target</small></span><div><input type="range" min="0" max="60" step="0.5" value={quote.targetMargin * 100} disabled={locked} style={{ "--range-fill": `${Math.min(100, quote.targetMargin * 100 / 0.6)}%` } as React.CSSProperties} onChange={(event) => updateField("targetMargin", Number(event.target.value) / 100)} /><output>{percent(quote.targetMargin)}</output></div></label>
        <div className="control-row fixed-tax-row"><span><strong>HST</strong><small>Always shown as extra on the customer proposal</small></span><strong>Extra</strong></div>
      </aside>

      <section className="panel form-panel full-span">
        <div className="panel-heading"><div><span className="eyebrow">SCOPE FOUNDATION</span><h2>What are we pricing?</h2></div><span className="client-safe-chip">Customer-facing</span></div>
        <div className="form-grid two-column">
          <label className="field full"><span>Proposal Scope Lines <em>One numbered item per line</em></span><textarea rows={6} value={quote.proposalScope ?? ""} disabled={locked} onChange={(event) => updateField("proposalScope", event.target.value)} placeholder="Supply labour and materials to complete…" /></label>
          <label className="field full"><span>Proposal Notes <em>One item per line</em></span><textarea rows={4} value={quote.proposalNotes ?? ""} disabled={locked} onChange={(event) => updateField("proposalNotes", event.target.value)} placeholder="Access, working hours, permits and project assumptions." /></label>
          <label className="field"><span>Inclusions</span><textarea rows={5} value={quote.inclusions} disabled={locked} onChange={(event) => updateField("inclusions", event.target.value)} placeholder="What the price includes" /></label>
          <label className="field"><span>Exclusions</span><textarea rows={5} value={quote.exclusions} disabled={locked} onChange={(event) => updateField("exclusions", event.target.value)} placeholder="What is specifically excluded" /></label>
          <label className="field"><span>Proposal terms</span><textarea rows={4} value={quote.terms} disabled={locked} onChange={(event) => updateField("terms", event.target.value)} /></label>
          <label className="field internal-field"><span>Internal notes <em>Not shown to customer</em></span><textarea rows={4} value={quote.internalNotes} disabled={locked} onChange={(event) => updateField("internalNotes", event.target.value)} /></label>
        </div>
      </section>

      <section className="panel form-panel full-span">
        <div className="panel-heading"><div><span className="eyebrow">CUSTOMER PRICING</span><h2>Optional cost breakdown</h2></div><span className="client-safe-chip">Lump sum remains standard</span></div>
        <div className="proposal-breakdown-controls">
          <label className="check-field"><input type="checkbox" checked={quote.proposalShowCostBreakdown ?? false} disabled={locked} onChange={(event) => updateField("proposalShowCostBreakdown", event.target.checked)} /><span><strong>Show cost breakdown on proposal</strong><small>Show customer-facing Labour, Materials, Subcontractors and Other totals.</small></span></label>
          <label className="check-field"><input type="checkbox" checked={quote.proposalBreakdownIncludesMarkup ?? true} disabled={locked || !quote.proposalShowCostBreakdown} onChange={(event) => updateField("proposalBreakdownIncludesMarkup", event.target.checked)} /><span><strong>Include markup in breakdown totals</strong><small>When off, markup is shown as its own separate line.</small></span></label>
        </div>
      </section>
    </div>
  );
}

function EstimateBuilder({ state, quote, locked, mutateQuote, expandedLineId, setExpandedLineId, catalogToAdd, setCatalogToAdd }: {
  state: AppState;
  quote: Quote;
  locked: boolean;
  mutateQuote: (id: string, updater: (quote: Quote) => Quote, activity?: { title: string; detail: string }) => void;
  expandedLineId: string | null;
  setExpandedLineId: (id: string | null) => void;
  catalogToAdd: string;
  setCatalogToAdd: (value: string) => void;
}) {
  const [pendingDeleteLineId, setPendingDeleteLineId] = useState<string | null>(null);
  const [catalogSearch, setCatalogSearch] = useState("");
  const [catalogPickerOpen, setCatalogPickerOpen] = useState(false);
  const [supplierCatalogMatches, setSupplierCatalogMatches] = useState<SupplierCatalogItemRecord[]>([]);
  const [supplierSearchLoading, setSupplierSearchLoading] = useState(false);
  const totals = quoteTotals(quote);
  const appliedItems = state.priceBook.filter((item) => item.active);
  const normalizedCatalogSearch = catalogSearch.trim().toLocaleLowerCase();
  const visibleSupplierCatalogMatches = normalizedCatalogSearch.length >= 2 ? supplierCatalogMatches : [];
  const catalogMatches = appliedItems
    .filter((item) => !normalizedCatalogSearch || `${item.name} ${item.category} ${item.costType} ${item.unit} ${item.recommendedUse}`.toLocaleLowerCase().includes(normalizedCatalogSearch))
    .sort((left, right) => left.name.localeCompare(right.name))
    .slice(0, 12);
  const displayedLines = quote.lines
    .map((line, originalIndex) => ({ line, originalIndex }))
    .sort((left, right) => {
      const costTypeDifference = estimateCostTypeOrder.indexOf(left.line.costType) - estimateCostTypeOrder.indexOf(right.line.costType);
      return costTypeDifference || left.originalIndex - right.originalIndex;
    });
  useEffect(() => {
    const query = catalogSearch.trim();
    if (query.length < 2) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setSupplierSearchLoading(true);
      fetch(`/api/supplier-catalog?q=${encodeURIComponent(query)}&limit=12`, { cache: "no-store", signal: controller.signal })
        .then((response) => response.ok ? response.json() as Promise<SupplierCatalogSearchResponse> : Promise.reject(new Error("Supplier search unavailable")))
        .then((result) => { setSupplierCatalogMatches(result.items); setSupplierSearchLoading(false); })
        .catch((error) => { if (error instanceof DOMException && error.name === "AbortError") return; setSupplierCatalogMatches([]); setSupplierSearchLoading(false); });
    }, 180);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [catalogSearch]);
  const pendingDeleteLine = pendingDeleteLineId
    ? quote.lines.find((line) => line.id === pendingDeleteLineId) ?? null
    : null;
  const revealNewLine = (lineId: string) => {
    setExpandedLineId(lineId);
    window.setTimeout(() => {
      const row = document.getElementById(`estimate-line-${lineId}`);
      row?.scrollIntoView({ behavior: "smooth", block: "center" });
      window.setTimeout(() => row?.querySelector<HTMLInputElement>("input.description-input, .saved-data-picker input")?.focus({ preventScroll: true }), 260);
    }, 40);
  };
  const updateLine = (lineId: string, patch: Partial<QuoteLine>) => {
    mutateQuote(quote.id, (current) => ({
      ...current,
      acknowledgedWarnings: {},
      lines: current.lines.map((line) => (line.id === lineId ? { ...line, ...patch } : line)),
    }));
  };
  const updateLineVendor = (line: QuoteLine, typedName: string) => {
    const subcontractorName = typedName.trim();
    const matchedVendor = activeSubcontractors(state.vendors).find((vendor) => vendor.name.trim().toLowerCase() === subcontractorName.toLowerCase());
    updateLine(line.id, {
      vendorId: matchedVendor?.id ?? null,
      vendorName: matchedVendor ? "" : typedName,
      description: subcontractorName,
    });
  };
  const applyCatalog = (lineId: string, code: string) => {
    if (!code) {
      updateLine(lineId, { priceBookCode: null, priceSourceSnapshot: undefined, costBuildUp: undefined, catalogCost: null, projectCost: null, liveQuote: false, confidence: "Project-specific", low: null, high: null, sourceNote: "" });
      return;
    }
    const item = state.priceBook.find((candidate) => candidate.code === code);
    if (!item) return;
    const defaultVendor = state.vendors.find((vendor) => vendor.id === item.defaultVendorId && isSubcontractor(vendor));
    updateLine(lineId, {
      priceBookCode: item.code,
      priceSourceSnapshot: undefined,
      costBuildUp: undefined,
      division: item.category,
      description: item.name,
      internalScope: `${item.includedComponents}${item.adjustExclude ? ` Adjust / exclude: ${item.adjustExclude}` : ""}`,
      classification: item.defaultClass,
      included: item.defaultClass !== "Optional",
      costType: item.costType,
      unit: item.unit,
      catalogCost: item.typical,
      projectCost: null,
      markupOverride: null,
      priceOverride: null,
      vendorId: defaultVendor?.id ?? null,
      vendorName: defaultVendor ? "" : item.defaultVendorName ?? "",
      vendorReference: "",
      vendorQuoteDate: "",
      vendorQuoteExpiry: "",
      liveQuote: item.liveQuote,
      confidence: item.confidence,
      low: item.low,
      high: item.high,
      sourceNote: item.pricingBasis,
      internalNote: item.note,
    });
  };
  const addSelectedItem = (selection = catalogToAdd) => {
    if (!selection) return;
    if (selection.startsWith("supplier:")) {
      const supplierItem = supplierCatalogMatches.find((candidate) => `supplier:${candidate.id}` === selection);
      if (!supplierItem) return;
      const line = newLine(quote.lines.at(-1)?.section || "General");
      const completed: QuoteLine = {
        ...line,
        priceBookCode: null,
        division: supplierItem.division,
        description: supplierItem.productName,
        internalScope: supplierItem.rawDescription,
        classification: "Required",
        included: true,
        costType: "Material",
        unit: supplierItem.unit,
        catalogCost: supplierItem.netCost,
        vendorId: supplierItem.supplierId,
        vendorName: supplierItem.supplierName,
        vendorReference: supplierItem.supplierSku,
        vendorQuoteDate: supplierItem.effectiveDate,
        vendorQuoteExpiry: supplierItem.validUntil,
        liveQuote: false,
        confidence: supplierItem.validUntil && supplierItem.validUntil < today() ? "Low-Medium" : "High",
        sourceNote: `${supplierItem.supplierName} · SKU ${supplierItem.supplierSku} · price ${supplierItem.effectiveDate}`,
        internalNote: `Supplier PDF price snapshot. Original wording: ${supplierItem.rawDescription}`,
        priceSourceSnapshot: {
          kind: "supplier",
          catalogItemId: supplierItem.id,
          importId: supplierItem.latestImportId,
          supplierId: supplierItem.supplierId,
          supplierName: supplierItem.supplierName,
          supplierSku: supplierItem.supplierSku,
          effectiveDate: supplierItem.effectiveDate,
          validUntil: supplierItem.validUntil,
          capturedAt: new Date().toISOString(),
          rawUnit: supplierItem.rawUnit,
          listUnitPrice: supplierItem.listPrice,
          netUnitCost: supplierItem.netCost,
        },
      };
      mutateQuote(quote.id, (current) => ({ ...current, lines: [...current.lines, completed], acknowledgedWarnings: {} }));
      revealNewLine(completed.id);
      setCatalogToAdd("");
      setCatalogSearch("");
      setCatalogPickerOpen(false);
      return;
    }
    const item = state.priceBook.find((candidate) => candidate.code === selection);
    if (!item) return;
    const defaultVendor = state.vendors.find((vendor) => vendor.id === item.defaultVendorId && isSubcontractor(vendor));
    const line = newLine(quote.lines.at(-1)?.section || "General");
    const completed: QuoteLine = {
      ...line,
      priceBookCode: item.code,
      division: item.category,
      description: item.name,
      internalScope: `${item.includedComponents}${item.adjustExclude ? ` Adjust / exclude: ${item.adjustExclude}` : ""}`,
      classification: item.defaultClass,
      included: item.defaultClass !== "Optional",
      costType: item.costType,
      unit: item.unit,
      catalogCost: item.typical,
      vendorId: defaultVendor?.id ?? null,
      vendorName: defaultVendor ? "" : item.defaultVendorName ?? "",
      liveQuote: item.liveQuote,
      confidence: item.confidence,
      low: item.low,
      high: item.high,
      sourceNote: item.pricingBasis,
      internalNote: item.note,
    };
    mutateQuote(quote.id, (current) => ({ ...current, lines: [...current.lines, completed], acknowledgedWarnings: {} }));
    revealNewLine(completed.id);
    setCatalogToAdd("");
    setCatalogSearch("");
    setCatalogPickerOpen(false);
  };
  const selectCatalogItem = (item: PriceBookItem) => {
    addSelectedItem(item.code);
  };
  const selectSupplierCatalogItem = (item: SupplierCatalogItemRecord) => {
    addSelectedItem(`supplier:${item.id}`);
  };
  const addCustom = () => {
    const line = newLine(quote.lines.at(-1)?.section || "General");
    mutateQuote(quote.id, (current) => ({ ...current, lines: [...current.lines, line], acknowledgedWarnings: {} }));
    revealNewLine(line.id);
  };
  const addBuiltUp = () => {
    const line = newBuiltUpLine(quote.lines.at(-1)?.section || "General");
    mutateQuote(quote.id, (current) => ({ ...current, lines: [...current.lines, line], acknowledgedWarnings: {} }));
    revealNewLine(line.id);
  };
  const addSubcontractor = () => {
    const line = newSubcontractorLine(quote.lines.at(-1)?.section || "General");
    mutateQuote(quote.id, (current) => ({ ...current, lines: [...current.lines, line], acknowledgedWarnings: {} }));
    revealNewLine(line.id);
  };
  const enableCostBuildUp = (line: QuoteLine) => {
    updateLine(line.id, {
      priceBookCode: null,
      priceSourceSnapshot: undefined,
      costType: "Labour & Materials",
      quantity: 1,
      unit: "LS",
      catalogCost: null,
      projectCost: null,
      priceOverride: null,
      liveQuote: false,
      confidence: "Project-specific",
      sourceNote: line.sourceNote || "Detailed labour and material cost build-up.",
      costBuildUp: {
        items: [
          newBuildUpItem("Labour", { description: "Crew labour" }),
          newBuildUpItem("Material"),
        ],
      },
    });
  };
  const enableSubcontractorCostBreakdown = (line: QuoteLine) => {
    const vendor = line.vendorName || (line.vendorId ? state.vendors.find((item) => item.id === line.vendorId)?.name ?? "" : "");
    const baseCost = line.projectCost ?? line.catalogCost ?? 0;
    updateLine(line.id, {
      priceBookCode: null,
      priceSourceSnapshot: undefined,
      catalogCost: null,
      projectCost: null,
      confidence: "Project-specific",
      sourceNote: line.sourceNote || "Subcontractor price plus separately quoted extras.",
      costBuildUp: {
        items: [
          newBuildUpItem("Subcontractor", {
            description: vendor ? `${vendor} quoted work` : "Subcontractor quoted work",
            quantity: 1,
            unit: "LS",
            unitCost: baseCost,
            source: line.vendorReference ? `Quote #${line.vendorReference}` : "Quote number not provided",
          }),
          newBuildUpItem("Other", { quantity: 1, unit: "LS" }),
        ],
      },
    });
  };
  const requestLineRemoval = (lineId: string) => {
    setPendingDeleteLineId(lineId);
  };
  const confirmLineRemoval = () => {
    if (!pendingDeleteLineId) return;
    const lineId = pendingDeleteLineId;
    mutateQuote(quote.id, (current) => ({ ...current, lines: current.lines.filter((line) => line.id !== lineId), acknowledgedWarnings: {} }));
    if (expandedLineId === lineId) setExpandedLineId(null);
    setPendingDeleteLineId(null);
  };

  return (
    <div className="estimate-layout">
      <section className="pricing-ribbon">
        <div><span>Included direct cost</span><strong>{money(totals.directCost)}</strong></div>
        <div><span>Included sell price</span><strong>{money(totals.subtotal)}</strong></div>
        <div><span>Gross profit</span><strong>{money(totals.profit)}</strong></div>
        <div className={totals.margin < quote.targetMargin ? "ribbon-warning" : ""}><span>Gross margin</span><strong>{percent(totals.margin)}</strong><small>Target {percent(quote.targetMargin)}</small></div>
        <div><span>Unselected options</span><strong>{money(totals.optional)}</strong></div>
      </section>

      <section className="panel estimate-panel">
        <div className="panel-heading estimate-heading">
          <div><span className="eyebrow">INTERNAL ESTIMATE</span><h2>Products, services and custom work</h2><p>Select a Price Book item or add a project-specific line. Blue fields are inputs; calculated totals stay protected.</p></div>
          <div className="estimate-heading-actions"><span className="step-chip">Step 2 of 7</span><button className="button secondary compact" onClick={() => void downloadEstimateOnly(state, quote)}>⇩ Estimate Only PDF</button></div>
        </div>

        {!locked && (
          <div className="add-line-bar">
            <div className="catalog-search-picker" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setCatalogPickerOpen(false); }}>
              <label><span className="sr-only">Search products and services</span><span className="catalog-search-icon">⌕</span><input role="combobox" aria-expanded={catalogPickerOpen} aria-controls={`catalog-results-${quote.id}`} aria-autocomplete="list" value={catalogSearch} onFocus={() => setCatalogPickerOpen(true)} onChange={(event) => { const value = event.target.value; setCatalogSearch(value); setCatalogToAdd(""); setCatalogPickerOpen(true); if (value.trim().length < 2) setSupplierSearchLoading(false); }} onKeyDown={(event) => { if (event.key === "Enter" && (catalogMatches.length || visibleSupplierCatalogMatches.length)) { event.preventDefault(); if (catalogMatches.length) selectCatalogItem(catalogMatches[0]); else selectSupplierCatalogItem(visibleSupplierCatalogMatches[0]); } if (event.key === "Escape") setCatalogPickerOpen(false); }} placeholder="Search services, installed rates or materials…" /></label>
              {catalogPickerOpen && <div className="catalog-search-results" id={`catalog-results-${quote.id}`} role="listbox">
                {!!catalogMatches.length && <div className="catalog-result-heading">SERVICES &amp; ASSEMBLIES</div>}
                {catalogMatches.map((item) => <button type="button" role="option" aria-selected="false" key={item.id} onMouseDown={(event) => event.preventDefault()} onClick={() => selectCatalogItem(item)}><span><strong>{item.name}</strong><small>{item.category} · {item.costType} · {item.unit}</small></span><b>{item.liveQuote ? "Live quote" : item.typical === null ? "No cost" : money(item.typical)}</b></button>)}
                {!!visibleSupplierCatalogMatches.length && <div className="catalog-result-heading">MATERIAL PRICES</div>}
                {visibleSupplierCatalogMatches.map((item) => <button type="button" className="supplier-catalog-result" role="option" aria-selected="false" key={item.id} onMouseDown={(event) => event.preventDefault()} onClick={() => selectSupplierCatalogItem(item)}><span><strong>{item.productName}</strong><small>{item.supplierName} · {item.unit}{item.validUntil && item.validUntil < today() ? " · expired source" : ""}</small></span><b>{money(item.netCost)}</b></button>)}
                {supplierSearchLoading && <div className="catalog-searching">Searching supplier materials…</div>}
                {!catalogMatches.length && !visibleSupplierCatalogMatches.length && !supplierSearchLoading && <div className="catalog-no-results"><strong>No matching Price Book items</strong><span>Try another word or add a custom line.</span></div>}
              </div>}
            </div>
            <button className="button secondary subcontractor-add-button" onClick={addSubcontractor}>＋ Subcontractor</button>
            <button className="button secondary built-up-add-button" onClick={addBuiltUp}>＋ Built-up item</button>
            <button className="button secondary" onClick={addCustom}>＋ Custom line</button>
          </div>
        )}

        <div className="estimate-table-wrap">
          <table className="estimate-table">
            <thead>
              <tr><th>#</th><th>Description / Vendor</th><th>Cost type</th><th>Division</th><th>Qty</th><th>Unit</th><th className="direct-unit-cost-heading">Direct unit cost</th><th className="direct-cost-heading">Direct cost</th><th>Class</th><th>Include</th><th><span className="sr-only">Details</span></th></tr>
            </thead>
            <tbody>
              {displayedLines.map(({ line }, index) => {
                const direct = lineDirectCost(line);
                const sell = lineSellPrice(line, quote.defaultMarkup);
                const markup = line.markupOverride ?? quote.defaultMarkup;
                const buildUpTotals = lineBuildUpTotals(line);
                const needsLiveCost = line.liveQuote && !(effectiveUnitCost(line) > 0);
                const outOfRange = !line.costBuildUp && line.projectCost !== null && ((line.low !== null && line.projectCost < line.low) || (line.high !== null && line.projectCost > line.high));
                return (
                  <Fragment key={line.id}>
                    <tr id={`estimate-line-${line.id}`} className={`${expandedLineId === line.id ? "expanded" : ""} ${!line.included ? "not-included" : ""}`}>
                      <td className="line-number" data-label="#">{index + 1}</td>
                      {line.costType === "Sub / Vendor" ? <td data-label="Vendor"><SearchablePicker value={line.vendorName || (line.vendorId ? state.vendors.find((vendor) => vendor.id === line.vendorId)?.name ?? "" : "")} options={activeSubcontractors(state.vendors).map((vendor) => ({ id: vendor.id, label: vendor.name, detail: vendor.trade }))} disabled={locked} placeholder="Search or type subcontractor" ariaLabel={`Vendor for line ${index + 1}`} allowCustom onChange={(value) => updateLineVendor(line, value)} onSelect={(option) => updateLineVendor(line, option.label)} /><small className="cell-hint sub-quote-hint">{(line.vendorPricingMode ?? "Quoted") === "Budget" ? "Budget allowance" : line.vendorReference ? `Sub quote ${line.vendorReference}` : "Quote # optional"}</small></td> : <td data-label="Description"><input className="cell-input description-input" autoComplete="off" value={line.description} disabled={locked} onChange={(event) => { const description = event.target.value; const division = !line.divisionManual ? detectConstructionDivision(description) : null; updateLine(line.id, { description, ...(division ? { division } : {}) }); }} placeholder="Describe the work" /></td>}
                      <td data-label="Cost type">{line.costType === "Sub / Vendor" ? <span className="fixed-cost-type">Sub / Vendor</span> : <select className="cell-input cost-type-input" value={line.costType} disabled={locked || !!line.costBuildUp} onChange={(event) => updateLine(line.id, { costType: event.target.value as CostType })}>{costTypeOptions.filter((type) => type !== "Sub / Vendor").map((type) => <option key={type}>{type}</option>)}</select>}</td>
                      <td data-label="Division"><select className="cell-input division-input" value={line.division ?? "Div 01 – General Requirements"} disabled={locked} onChange={(event) => updateLine(line.id, { division: event.target.value, divisionManual: true })}>{line.division && !constructionDivisions.includes(line.division) && <option value={line.division}>{line.division}</option>}{constructionDivisions.map((division) => <option key={division}>{division}</option>)}</select></td>
                      <td data-label="Qty"><input className="cell-input number-input" type="number" min="0" step="0.01" value={line.quantity} disabled={locked} onChange={(event) => updateLine(line.id, { quantity: Number(event.target.value) })} /></td>
                      <td data-label="Unit"><input className="cell-input unit-input" value={line.unit} disabled={locked} onChange={(event) => updateLine(line.id, { unit: event.target.value })} /></td>
                      <td className="direct-unit-cost-cell" data-label="Direct unit cost">
                        <div className={`money-input ${needsLiveCost ? "required" : ""} ${line.costBuildUp ? "built-up-cost" : ""}`}><span>$</span><input type="number" min="0" step="0.01" value={line.costBuildUp ? buildUpTotals.total : line.projectCost ?? line.catalogCost ?? ""} disabled={locked || !!line.costBuildUp} onChange={(event) => updateLine(line.id, { projectCost: event.target.value === "" ? null : Number(event.target.value) })} placeholder={line.liveQuote ? "Quote required" : "0.00"} /></div>
                        {line.costBuildUp ? <div className="build-up-mini-totals">{line.costType === "Sub / Vendor" ? <><span>Vendor {money(buildUpTotals.subcontractors)}</span><span>Other {money(buildUpTotals.other)}</span></> : <><span>Labour {money(buildUpTotals.labour)}</span><span>Materials {money(buildUpTotals.materials)}</span></>}</div> : line.catalogCost !== null && <small className="cell-hint">Catalog {money(line.catalogCost)}</small>}
                      </td>
                      <td className="direct-cost-cell" data-label="Direct cost"><strong>{money(direct)}</strong></td>
                      <td data-label="Class"><select className="cell-input class-select" value={line.classification} disabled={locked} onChange={(event) => updateLine(line.id, { classification: event.target.value as QuoteClass })}><option>Required</option><option>Allowance</option><option>Optional</option></select></td>
                      <td data-label="Include"><label className="switch"><input type="checkbox" checked={line.included} disabled={locked} aria-label={`${line.included ? "Exclude" : "Include"} ${line.description || `line ${index + 1}`} from quote`} onChange={(event) => updateLine(line.id, { included: event.target.checked })} /><span /></label></td>
                      <td className="line-actions">
                        {(needsLiveCost || outOfRange || line.confidence === "Low") && <span className={`line-warning ${needsLiveCost ? "danger" : ""}`} title={needsLiveCost ? "Enter a usable direct cost" : "Review this pricing"}>!</span>}
                        {!locked && <button className="line-delete-button" title="Delete line" aria-label={`Delete ${line.description || `line ${index + 1}`}`} onClick={() => requestLineRemoval(line.id)}>×</button>}
                        <button className={`line-detail-toggle ${expandedLineId === line.id ? "line-finish-button" : ""}`} title={expandedLineId === line.id ? "Finish row" : "Show line details"} aria-label={expandedLineId === line.id ? `Finish ${line.description || `line ${index + 1}`}` : `Edit details for ${line.description || `line ${index + 1}`}`} onClick={() => setExpandedLineId(expandedLineId === line.id ? null : line.id)}>{expandedLineId === line.id ? "✓" : "⌄"}</button>
                      </td>
                    </tr>
                    {expandedLineId === line.id && (
                      <tr className="line-detail-row">
                        <td colSpan={11}>
                          <div className="line-detail-panel">
                            <div className="detail-panel-heading">
                              <div><span className="eyebrow">LINE {index + 1} DETAILS</span><h3>{line.description || "New estimate line"}</h3></div>
                              <div className="detail-panel-controls">
                                <div className="line-detail-pricing">
                                  <label><span>Markup</span><div className="percent-input"><input aria-label={`Markup for ${line.description || `line ${index + 1}`}`} type="number" min="0" step="0.5" value={markup * 100} disabled={locked} onChange={(event) => updateLine(line.id, { markupOverride: Number(event.target.value) / 100 })} /><span>%</span></div></label>
                                  <div><span>Sell price</span><strong>{money(sell)}</strong></div>
                                </div>
                                {!locked && <button className="text-button danger" onClick={() => requestLineRemoval(line.id)}>Delete line</button>}
                              </div>
                            </div>
                            {line.costBuildUp ? (
                              <CostBuildUpEditor line={line} locked={locked} updateLine={updateLine} />
                            ) : (
                              <div className="build-up-invitation">
                                {line.costType === "Sub / Vendor" ? <>
                                  <div><span className="eyebrow">OPTIONAL COST BREAKDOWN</span><strong>Add the subcontractor price and separate extras</strong><p>Keep the vendor price, shipping, perforation, delivery and other charges separate while their combined total feeds this estimate line.</p></div>
                                  {!locked && <button className="button secondary" onClick={() => enableSubcontractorCostBreakdown(line)}>＋ Add quote cost breakdown</button>}
                                </> : <>
                                  <div><span className="eyebrow">OPTIONAL COST WORKSHEET</span><strong>Build this item from labour and materials</strong><p>Keep one clean line on the quote while the labour hours and material quantities calculate its direct cost underneath.</p></div>
                                  {!locked && <button className="button secondary" onClick={() => enableCostBuildUp(line)}>＋ Add labour &amp; material worksheet</button>}
                                </>}
                              </div>
                            )}
                            <div className="form-grid four-column">
                              {line.costType === "Sub / Vendor" && <label className="field"><span>Subcontractor <em>Search or type a name</em></span><SearchablePicker value={line.vendorName || (line.vendorId ? state.vendors.find((vendor) => vendor.id === line.vendorId)?.name ?? "" : "")} options={activeSubcontractors(state.vendors).map((vendor) => ({ id: vendor.id, label: vendor.name, detail: vendor.trade }))} disabled={locked} placeholder="Search subcontractors" ariaLabel="Subcontractor" allowCustom onChange={(value) => updateLineVendor(line, value)} onSelect={(option) => updateLineVendor(line, option.label)} /></label>}
                              {line.costType === "Sub / Vendor" && <label className="check-field"><input type="checkbox" checked={(line.vendorPricingMode ?? "Quoted") === "Budget"} disabled={locked} onChange={(event) => updateLine(line.id, { vendorPricingMode: event.target.checked ? "Budget" : "Quoted", liveQuote: !event.target.checked })} /><span><strong>Budget allowance</strong><small>Use an estimated subcontractor cost; a quote number is not required.</small></span></label>}
                              <label className="field"><span>{line.costType === "Sub / Vendor" ? <>Subcontractor quote # <em>Optional</em></> : "Quote / source reference"}</span><input value={line.vendorReference} disabled={locked} onChange={(event) => updateLine(line.id, { vendorReference: event.target.value })} placeholder={line.costType === "Sub / Vendor" ? "Enter only when the subcontractor provides one" : "Supplier reference or takeoff"} /></label>
                              {line.costType === "Sub / Vendor" && (line.vendorPricingMode ?? "Quoted") === "Quoted" && <label className="field"><span>Vendor quote date</span><input type="date" value={line.vendorQuoteDate} disabled={locked} onChange={(event) => updateLine(line.id, { vendorQuoteDate: event.target.value })} /></label>}
                              {line.costType === "Sub / Vendor" && (line.vendorPricingMode ?? "Quoted") === "Quoted" && <label className="field"><span>Vendor quote expiry</span><input type="date" value={line.vendorQuoteExpiry} disabled={locked} onChange={(event) => updateLine(line.id, { vendorQuoteExpiry: event.target.value })} /></label>}
                              <label className="field"><span>Customer-price override</span><div className="input-prefix"><span>$</span><input type="number" min="0" step="0.01" value={line.priceOverride ?? ""} disabled={locked} onChange={(event) => updateLine(line.id, { priceOverride: event.target.value === "" ? null : Number(event.target.value) })} placeholder={money(sell)} /></div></label>
                              <label className="field full internal-field"><span>Internal scope, assumptions and notes <em>Hidden from customer</em></span><textarea rows={3} value={lineInternalDetails(line)} disabled={locked} onChange={(event) => updateLine(line.id, { internalScope: event.target.value, internalNote: "" })} /></label>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        {!quote.lines.length && <div className="empty-state estimate-empty"><span>＋</span><h3>Build the estimate</h3><p>Choose a reusable Price Book item or add custom project work.</p></div>}
      </section>

      {pendingDeleteLine && (
        <div className="modal-layer" role="presentation" onMouseDown={() => setPendingDeleteLineId(null)}>
          <section className="modal-card confirm-card" role="dialog" aria-modal="true" aria-labelledby="delete-line-title" onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <div><span className="eyebrow danger-eyebrow">DELETE ESTIMATE LINE</span><h2 id="delete-line-title">Remove this quote line?</h2></div>
              <button aria-label="Cancel deletion" onClick={() => setPendingDeleteLineId(null)}>×</button>
            </header>
            <div className="confirm-content">
              <div className="confirm-line-name"><span>{pendingDeleteLine.section || "General"}</span><strong>{pendingDeleteLine.description || "Unnamed estimate line"}</strong></div>
              <p>This removes the line and its cost from the quote. The rest of the estimate will not be changed.</p>
            </div>
            <footer className="confirm-actions">
              <button className="button secondary" onClick={() => setPendingDeleteLineId(null)}>Keep line</button>
              <button className="button danger-solid" onClick={confirmLineRemoval}>Delete line</button>
            </footer>
          </section>
        </div>
      )}
    </div>
  );
}

function CostBuildUpEditor({ line, locked, updateLine }: {
  line: QuoteLine;
  locked: boolean;
  updateLine: (lineId: string, patch: Partial<QuoteLine>) => void;
}) {
  const [materialSearch, setMaterialSearch] = useState("");
  const [materialMatches, setMaterialMatches] = useState<SupplierCatalogItemRecord[]>([]);
  const [materialSearchOpen, setMaterialSearchOpen] = useState(false);
  const [materialSearchLoading, setMaterialSearchLoading] = useState(false);
  const items = line.costBuildUp?.items ?? [];
  const labourItems = items.filter((item) => item.kind === "Labour");
  const materialItems = items.filter((item) => item.kind === "Material");
  const subcontractorItems = items.filter((item) => item.kind === "Subcontractor");
  const otherItems = items.filter((item) => item.kind === "Other");
  const totals = lineBuildUpTotals(line);
  const subcontractorBreakdown = line.costType === "Sub / Vendor";

  useEffect(() => {
    const query = materialSearch.trim();
    if (query.length < 2) {
      setMaterialMatches([]);
      setMaterialSearchLoading(false);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setMaterialSearchLoading(true);
      fetch(`/api/supplier-catalog?q=${encodeURIComponent(query)}&limit=10`, { cache: "no-store", signal: controller.signal })
        .then((response) => response.ok ? response.json() as Promise<SupplierCatalogSearchResponse> : Promise.reject(new Error("Material search unavailable")))
        .then((result) => { setMaterialMatches(result.items); setMaterialSearchLoading(false); })
        .catch((error) => {
          if (error instanceof DOMException && error.name === "AbortError") return;
          setMaterialMatches([]);
          setMaterialSearchLoading(false);
        });
    }, 180);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [materialSearch]);

  const commitItems = (nextItems: QuoteCostBuildUpItem[]) => updateLine(line.id, { costBuildUp: { items: nextItems } });
  const updateItem = (itemId: string, patch: Partial<QuoteCostBuildUpItem>) => commitItems(items.map((item) => item.id === itemId ? { ...item, ...patch } : item));
  const removeItem = (itemId: string) => commitItems(items.filter((item) => item.id !== itemId));
  const addLabour = () => commitItems([...items, newBuildUpItem("Labour", { description: "Crew labour" })]);
  const addManualMaterial = () => commitItems([...items, newBuildUpItem("Material")]);
  const addSubcontractor = () => commitItems([...items, newBuildUpItem("Subcontractor", { unit: "LS" })]);
  const addOther = () => commitItems([...items, newBuildUpItem("Other", { unit: "LS" })]);
  const addPricedMaterial = (material: SupplierCatalogItemRecord) => {
    const pricedItem = newBuildUpItem("Material", {
      description: material.productName,
      quantity: 1,
      unit: material.unit,
      unitCost: material.netCost,
      source: `${material.supplierName} · ${material.effectiveDate || "current price"}`,
      priceSourceSnapshot: {
        kind: "supplier",
        catalogItemId: material.id,
        importId: material.latestImportId,
        supplierId: material.supplierId,
        supplierName: material.supplierName,
        supplierSku: material.supplierSku,
        effectiveDate: material.effectiveDate,
        validUntil: material.validUntil,
        capturedAt: new Date().toISOString(),
        rawUnit: material.rawUnit,
        listUnitPrice: material.listPrice,
        netUnitCost: material.netCost,
      },
    });
    commitItems([...items, pricedItem]);
    setMaterialSearch("");
    setMaterialMatches([]);
    setMaterialSearchOpen(false);
  };

  const renderCostRow = (item: QuoteCostBuildUpItem) => (
    <div className="build-up-row" key={item.id}>
      <div className="build-up-description-cell">
        <input value={item.description} disabled={locked} onChange={(event) => updateItem(item.id, { description: event.target.value })} placeholder={item.kind === "Labour" ? "e.g. 4-person framing crew" : item.kind === "Subcontractor" ? "e.g. Quoted work" : item.kind === "Other" ? "e.g. Shipping or perforation" : "e.g. 2x12x16 SPF"} aria-label={`${item.kind} description`} />
        {item.priceSourceSnapshot ? <small className="supplier-source">{item.priceSourceSnapshot.supplierName} · price saved {item.priceSourceSnapshot.effectiveDate || "without a date"}</small> : <input className="build-up-source-input" value={item.source} disabled={locked} onChange={(event) => updateItem(item.id, { source: event.target.value })} placeholder={item.kind === "Labour" ? "Crew or rate note (optional)" : "Supplier or source (optional)"} aria-label={`${item.kind} source`} />}
      </div>
      <input type="number" min="0" step="0.01" value={item.quantity || ""} disabled={locked} onChange={(event) => updateItem(item.id, { quantity: Number(event.target.value) })} placeholder="0" aria-label={`${item.description || item.kind} quantity`} />
      <input value={item.unit} disabled={locked} onChange={(event) => updateItem(item.id, { unit: event.target.value })} placeholder={item.kind === "Labour" ? "hr" : "Each"} aria-label={`${item.description || item.kind} unit`} />
      <div className="build-up-money-input"><span>$</span><input type="number" min="0" step="0.01" value={item.unitCost || ""} disabled={locked} onChange={(event) => updateItem(item.id, { unitCost: Number(event.target.value) })} placeholder="0.00" aria-label={`${item.description || item.kind} unit cost`} /></div>
      <strong>{money(buildUpItemTotal(item))}</strong>
      {!locked ? <button className="build-up-remove" onClick={() => removeItem(item.id)} aria-label={`Remove ${item.description || item.kind} row`} title="Remove cost row">×</button> : <span />}
    </div>
  );

  return (
    <section className="build-up-worksheet">
      <header className="build-up-header">
        <div><span className="eyebrow">{subcontractorBreakdown ? "SUBCONTRACTOR COST BREAKDOWN" : "LABOUR & MATERIAL WORKSHEET"}</span><h4>{subcontractorBreakdown ? "Combine the vendor price with separately quoted extras" : "Build the cost behind this one quote item"}</h4><p>{subcontractorBreakdown ? "Keep shipping, perforation, delivery and other add-ons separate. Their combined total automatically becomes the direct unit cost." : "Each row is internal. The combined total automatically becomes the direct unit cost on the main estimate row."}</p></div>
        <div className="build-up-applied-total"><span>Applied unit cost</span><strong>{money(totals.total)}</strong><small>{numberFormatter.format(line.quantity)} {line.unit} = {money(lineDirectCost(line))} direct cost</small></div>
      </header>

      {!subcontractorBreakdown && <div className="build-up-group labour-group">
        <div className="build-up-group-heading"><div><span className="build-up-kind-icon">L</span><div><strong>Labour</strong><small>Hours, crew rates or other labour units</small></div></div>{!locked && <button className="button compact secondary" onClick={addLabour}>＋ Labour row</button>}</div>
        <div className="build-up-grid-header"><span>Description / crew</span><span>Qty</span><span>Unit</span><span>Unit cost</span><span>Total</span><span /></div>
        <div className="build-up-rows">{labourItems.map(renderCostRow)}{!labourItems.length && <div className="build-up-empty">No labour rows yet.</div>}</div>
        <div className="build-up-subtotal"><span>Labour total</span><strong>{money(totals.labour)}</strong></div>
      </div>}

      {!subcontractorBreakdown && <div className="build-up-group material-group">
        <div className="build-up-group-heading"><div><span className="build-up-kind-icon">M</span><div><strong>Materials</strong><small>Use saved Material Prices or enter a one-off item</small></div></div>{!locked && <button className="button compact secondary" onClick={addManualMaterial}>＋ Manual material</button>}</div>
        {!locked && <div className="build-up-material-picker" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setMaterialSearchOpen(false); }}>
          <label><span className="catalog-search-icon">⌕</span><input role="combobox" aria-expanded={materialSearchOpen} aria-controls={`build-up-material-results-${line.id}`} value={materialSearch} onFocus={() => setMaterialSearchOpen(true)} onChange={(event) => { setMaterialSearch(event.target.value); setMaterialSearchOpen(true); }} onKeyDown={(event) => { if (event.key === "Enter" && materialMatches[0]) { event.preventDefault(); addPricedMaterial(materialMatches[0]); } if (event.key === "Escape") setMaterialSearchOpen(false); }} placeholder="Search Material Prices, such as 2x12 or plywood…" /></label>
          {materialSearchOpen && materialSearch.trim().length >= 2 && <div className="build-up-material-results" id={`build-up-material-results-${line.id}`} role="listbox">
            {materialMatches.map((material) => <button key={material.id} type="button" role="option" aria-selected="false" onClick={() => addPricedMaterial(material)}><span><strong>{material.productName}</strong><small>{material.supplierName} · {material.unit}</small></span><b>{money(material.netCost)}</b></button>)}
            {materialSearchLoading && <div className="catalog-searching">Searching saved material prices…</div>}
            {!materialSearchLoading && !materialMatches.length && <div className="catalog-no-results"><strong>No saved material found</strong><span>Add a manual material row instead.</span></div>}
          </div>}
        </div>}
        <div className="build-up-grid-header"><span>Material / source</span><span>Qty</span><span>Unit</span><span>Unit cost</span><span>Total</span><span /></div>
        <div className="build-up-rows">{materialItems.map(renderCostRow)}{!materialItems.length && <div className="build-up-empty">No material rows yet.</div>}</div>
        <div className="build-up-subtotal"><span>Materials total</span><strong>{money(totals.materials)}</strong></div>
      </div>}

      <div className="build-up-group subcontractor-group">
        <div className="build-up-group-heading"><div><span className="build-up-kind-icon">S</span><div><strong>{subcontractorBreakdown ? "Subcontractor price" : "Subcontractors"}</strong><small>{subcontractorBreakdown ? "The vendor's main quoted or budget amount" : "Firm quotes or budget allowances included in this item"}</small></div></div>{!locked && <button className="button compact secondary" onClick={addSubcontractor}>＋ {subcontractorBreakdown ? "Vendor price row" : "Subcontractor row"}</button>}</div>
        <div className="build-up-grid-header"><span>{subcontractorBreakdown ? "Quoted work / source" : "Subcontractor / scope"}</span><span>Qty</span><span>Unit</span><span>Unit cost</span><span>Total</span><span /></div>
        <div className="build-up-rows">{subcontractorItems.map(renderCostRow)}{!subcontractorItems.length && <div className="build-up-empty">No subcontractor price entered yet.</div>}</div>
        <div className="build-up-subtotal"><span>{subcontractorBreakdown ? "Vendor price total" : "Subcontractor total"}</span><strong>{money(totals.subcontractors)}</strong></div>
      </div>

      <div className="build-up-group other-group">
        <div className="build-up-group-heading"><div><span className="build-up-kind-icon">O</span><div><strong>{subcontractorBreakdown ? "Additional quoted costs" : "Other direct costs"}</strong><small>{subcontractorBreakdown ? "Shipping, perforation, delivery or other separately priced extras" : "Equipment, rentals, permits or miscellaneous direct costs"}</small></div></div>{!locked && <button className="button compact secondary" onClick={addOther}>＋ Other cost row</button>}</div>
        <div className="build-up-grid-header"><span>Description / source</span><span>Qty</span><span>Unit</span><span>Unit cost</span><span>Total</span><span /></div>
        <div className="build-up-rows">{otherItems.map(renderCostRow)}{!otherItems.length && <div className="build-up-empty">No other cost rows yet.</div>}</div>
        <div className="build-up-subtotal"><span>Other total</span><strong>{money(totals.other)}</strong></div>
      </div>

      {subcontractorBreakdown ? <footer className="build-up-summary subcontractor-build-up-summary">
        <div><span>Vendor price</span><strong>{money(totals.subcontractors)}</strong></div>
        <span className="build-up-plus">＋</span>
        <div><span>Other costs</span><strong>{money(totals.other)}</strong></div>
        <span className="build-up-equals">＝</span>
        <div className="build-up-grand"><span>Direct unit cost</span><strong>{money(totals.total)}</strong></div>
      </footer> : <footer className="build-up-summary">
        <div><span>Labour</span><strong>{money(totals.labour)}</strong></div>
        <span className="build-up-plus">＋</span>
        <div><span>Materials</span><strong>{money(totals.materials)}</strong></div>
        <span className="build-up-equals">＝</span>
        <div><span>Subs &amp; other</span><strong>{money(totals.subcontractors + totals.other)}</strong></div>
        <span className="build-up-equals">＝</span>
        <div className="build-up-grand"><span>Built-up unit cost</span><strong>{money(totals.total)}</strong></div>
      </footer>}
    </section>
  );
}

function QuoteBreakdown({ state, quote }: { state: AppState; quote: Quote }) {
  const builtUpLines = quote.lines.filter((line) => line.costBuildUp);
  const renderGroup = (line: QuoteLine, kind: QuoteCostBuildUpItem["kind"], title: string) => {
    const items = line.costBuildUp?.items.filter((item) => item.kind === kind) ?? [];
    if (!items.length) return null;
    return (
      <section className="breakdown-cost-group">
        <h3>{title}</h3>
        <table><thead><tr><th>Description</th><th>Qty / Hours</th><th>Unit</th><th>Unit cost / Rate</th><th>Total</th></tr></thead><tbody>
          {items.map((item) => <tr key={item.id}><td><strong>{item.description || "Unnamed cost"}</strong>{item.source && <small>{item.source}</small>}</td><td>{numberFormatter.format(item.quantity)}</td><td>{item.unit}</td><td>{money(item.unitCost)}</td><td>{money(buildUpItemTotal(item))}</td></tr>)}
        </tbody><tfoot><tr><td colSpan={4}>{title} total</td><td>{money(items.reduce((sum, item) => sum + buildUpItemTotal(item), 0))}</td></tr></tfoot></table>
      </section>
    );
  };
  return (
    <div className="breakdown-workspace">
      <div className="breakdown-toolbar"><div><span className="eyebrow">INTERNAL ESTIMATING · STEP 3 OF 7</span><h2>Built-up item breakdown</h2><p>One printable page per built-up estimate item. This document is internal and never appears on the customer proposal.</p></div><button className="button secondary" disabled={!builtUpLines.length} onClick={() => void downloadBreakdownOnly(state, quote)}>⇩ Download Breakdown PDF</button></div>
      {!builtUpLines.length && <section className="panel empty-state"><span>▤</span><h3>No built-up items yet</h3><p>Add a Built-up item on the Estimate tab to create detailed labour and material worksheets.</p></section>}
      <div className="breakdown-pages">
        {builtUpLines.map((line, index) => {
          const totals = lineBuildUpTotals(line);
          const markup = line.markupOverride ?? quote.defaultMarkup;
          return (
            <article className="breakdown-page" key={line.id}>
              <header><div><span>JGC INTERNAL ESTIMATE</span><h1>{line.description || "Unnamed built-up item"}</h1><p>{line.division || "Division not assigned"} · {numberFormatter.format(line.quantity)} {line.unit}</p></div><div><span>QUOTE</span><strong>{quote.number}</strong><small>Page {index + 1} of {builtUpLines.length}</small></div></header>
              {renderGroup(line, "Labour", "Labour")}
              {renderGroup(line, "Material", "Materials")}
              {renderGroup(line, "Subcontractor", "Subcontractors / Vendors")}
              {renderGroup(line, "Other", "Equipment / Other")}
              <section className="breakdown-summary">
                <div><span>Labour</span><strong>{money(totals.labour)}</strong></div><div><span>Materials</span><strong>{money(totals.materials)}</strong></div><div><span>Subcontractors</span><strong>{money(totals.subcontractors)}</strong></div><div><span>Equipment / Other</span><strong>{money(totals.other)}</strong></div>
                <div><span>Built-up unit cost</span><strong>{money(totals.total)}</strong></div><div><span>Direct cost</span><strong>{money(lineDirectCost(line))}</strong></div><div><span>Markup</span><strong>{percent(markup)}</strong></div><div className="grand"><span>Final selling price</span><strong>{money(lineSellPrice(line, quote.defaultMarkup))}</strong></div>
              </section>
              {lineInternalDetails(line) && <footer><p><strong>Internal scope and notes:</strong> {lineInternalDetails(line)}</p></footer>}
            </article>
          );
        })}
      </div>
    </div>
  );
}

function QuoteReview({ state, quote, locked, mutateQuote, setTab, finalizeQuote, duplicateQuote }: {
  state: AppState;
  quote: Quote;
  locked: boolean;
  mutateQuote: (id: string, updater: (quote: Quote) => Quote, activity?: { title: string; detail: string }) => void;
  setTab: (tab: QuoteTab) => void;
  finalizeQuote: (quote: Quote) => void;
  duplicateQuote: (quote: Quote) => void;
}) {
  const totals = quoteTotals(quote);
  const readiness = quoteReadiness(quote, state.vendors);
  const includedLines = quote.lines.filter((line) => line.included);
  const subcontractorLines = includedLines.filter((line) => line.costType === "Sub / Vendor");
  const costTypes: CostType[] = ["Sub / Vendor", "Labour", "Material", "Labour & Materials", "Equipment / Other"];
  const costBreakdown = costTypes.map((type) => ({
    type,
    value: includedLines.filter((line) => line.costType === type).reduce((sum, line) => sum + lineDirectCost(line), 0),
  }));
  const maxCost = Math.max(1, ...costBreakdown.map((item) => item.value));
  const acknowledgeWarnings = () => {
    const stamped = new Date().toISOString();
    mutateQuote(
      quote.id,
      (current) => ({
        ...current,
        acknowledgedWarnings: {
          ...current.acknowledgedWarnings,
          ...Object.fromEntries(readiness.warnings.map((warning) => [warning.key, stamped])),
        },
      }),
      { title: "Warnings reviewed", detail: `${readiness.warnings.length} pricing and scope warning(s) acknowledged.` },
    );
  };

  return (
    <div className="review-layout">
      <section className="review-hero panel">
        <div className="review-hero-copy">
          <span className="eyebrow">APPROVAL GATE · STEP 4 OF 7</span>
            <h2>{readiness.blockers.length ? "Not ready to finish" : readiness.unresolvedWarnings.length ? "Ready with warnings" : "Ready to finish"}</h2>
            <p>{readiness.blockers.length ? "Clear the blocking checks before the quote can be finished." : readiness.unresolvedWarnings.length ? "The quote can be finished once these judgment items have been reviewed." : "Required fields, current costs and customer scope are in place."}</p>
        </div>
        <div className={`readiness-orb ${readiness.blockers.length ? "blocked" : readiness.unresolvedWarnings.length ? "warning" : "ready"}`}>
          <strong>{readiness.blockers.length || readiness.unresolvedWarnings.length || "✓"}</strong>
          <span>{readiness.blockers.length ? "blockers" : readiness.unresolvedWarnings.length ? "warnings" : "clear"}</span>
        </div>
      </section>

      <div className="review-grid">
        <section className="panel financial-review">
          <div className="panel-heading"><div><span className="eyebrow">FINANCIAL REVIEW</span><h2>Price and margin</h2></div><span className="internal-chip">Internal</span></div>
          <div className="review-totals">
            <div><span>Direct cost</span><strong>{money(totals.directCost)}</strong></div>
            <div><span>Gross profit</span><strong>{money(totals.profit)}</strong></div>
            <div><span>Markup on cost</span><strong>{percent(totals.markup)}</strong></div>
            <div className={totals.margin < quote.targetMargin ? "total-warning" : "total-good"}><span>Gross margin</span><strong>{percent(totals.margin)}</strong><small>Target {percent(quote.targetMargin)}</small></div>
            <div><span>Pre-tax proposal</span><strong>{money(totals.subtotal)}</strong></div>
            <div><span>{quote.taxName}</span><strong>{money(totals.tax)}</strong></div>
            <div className="grand-total"><span>Customer total</span><strong>{money(totals.total)}</strong></div>
          </div>
          <div className="cost-breakdown">
            <h3>Direct cost composition</h3>
            {costBreakdown.map((item) => (
              <div className="cost-row" key={item.type}>
                <span>{item.type}</span>
                <div><i style={{ width: `${(item.value / maxCost) * 100}%` }} /></div>
                <strong>{money(item.value)}</strong>
              </div>
            ))}
          </div>
          {!!totals.optional && <div className="optional-summary"><span>Unselected customer options</span><strong>{money(totals.optional)}</strong><small>Not included in the proposal total</small></div>}
        </section>

        <section className="panel readiness-checks">
          <div className="panel-heading"><div><span className="eyebrow">READINESS CHECKS</span><h2>What needs attention</h2></div></div>
          {readiness.blockers.length > 0 && (
            <div className="check-group blockers">
              <h3><span>!</span> Blocking items</h3>
              {readiness.blockers.map((item) => <button key={item.key} onClick={() => setTab(item.key === "client" || item.key === "project" ? "details" : "estimate")}><span className="check-icon">×</span><span>{item.message}</span><b>Fix →</b></button>)}
            </div>
          )}
          {readiness.warnings.length > 0 && (
            <div className="check-group warnings">
              <h3><span>△</span> Review warnings</h3>
              {readiness.warnings.map((item) => {
                const acknowledged = !!quote.acknowledgedWarnings[item.key];
                return <div className={acknowledged ? "acknowledged" : ""} key={item.key}><span className="check-icon">{acknowledged ? "✓" : "△"}</span><span>{item.message}</span><b>{acknowledged ? "Reviewed" : "Open"}</b></div>;
              })}
              {!locked && readiness.unresolvedWarnings.length > 0 && <button className="button warning-button" onClick={acknowledgeWarnings}>✓ Acknowledge reviewed warnings</button>}
            </div>
          )}
          {!readiness.blockers.length && !readiness.warnings.length && <EmptyInline title="All checks passed" detail="The estimate, client scope and pricing controls are ready." />}
          {!locked && (
            <div className="review-actions">
              <button className="button secondary" onClick={() => setTab("proposal")}>Preview proposal</button>
              <button className="button primary" disabled={!!readiness.blockers.length} onClick={() => finalizeQuote(quote)}>Finish quote</button>
            </div>
          )}
        </section>
      </div>
      {subcontractorLines.length > 0 && (
        <section className="review-build-ups review-subcontractors-only">
          <div className="review-section-heading"><span className="eyebrow">SUBCONTRACTOR REVIEW</span><h2>Quoted and budget subcontractors</h2><p>Confirm which subcontractor prices are firm quotations and which are estimating allowances.</p></div>
          {subcontractorLines.map((line) => <article className="review-subcontractor-card" key={line.id}><div><span className={`sub-pricing-badge ${(line.vendorPricingMode ?? "Quoted").toLowerCase()}`}>{(line.vendorPricingMode ?? "Quoted") === "Budget" ? "Budget Allowance" : "Actual Quote"}</span><h3>{line.description || "Subcontractor work"}</h3><p>{line.vendorName || state.vendors.find((vendor) => vendor.id === line.vendorId)?.name || "Subcontractor not selected"}{line.vendorReference ? ` · Quote #${line.vendorReference}` : ""}{line.costBuildUp ? " · Includes added costs" : ""}</p></div><strong>{money(lineDirectCost(line))}</strong></article>)}
        </section>
      )}
      <section className="panel review-utility-actions">
        <div><span className="eyebrow">QUOTE FILE ACTIONS</span><h2>Duplicate or save a complete backup</h2><p>These occasional actions stay here so the main quote header remains focused on the active workflow.</p></div>
        <div><button className="button secondary" onClick={() => duplicateQuote(quote)}>⧉ Duplicate quote</button><button className="button secondary" onClick={() => void downloadQuoteBackup(state, quote)}>⇩ Download full PDF backup</button></div>
      </section>
    </div>
  );
}

function QuotePurchaseOrders({ state, quote, job, onEditPurchaseOrder }: {
  state: AppState;
  quote: Quote;
  job: Job;
  onEditPurchaseOrder: (jobId: string, purchaseOrderId: string) => void;
}) {
  const purchaseOrders = job.purchaseOrders ?? [];
  const activePurchaseOrders = purchaseOrders.filter((purchaseOrder) => purchaseOrder.status !== "Void");
  const preTaxCommitment = activePurchaseOrders.reduce((sum, purchaseOrder) => (
    sum + purchaseOrder.lines.reduce((lineSum, line) => lineSum + (Number(line.amount) || 0), 0)
  ), 0);
  const issuedCount = purchaseOrders.filter((purchaseOrder) => purchaseOrder.status === "Issued").length;
  const draftCount = purchaseOrders.filter((purchaseOrder) => purchaseOrder.status === "Draft").length;

  return (
    <div className="page-stack quote-po-layout">
      <section className="panel quote-po-hero">
        <div>
          <span className="eyebrow">LINKED JOB PURCHASE ORDERS</span>
          <h2>POs for Job {job.jobNumber}</h2>
          <p>All purchase orders connected to this accepted quote stay together here and are also included in the Full Quote Backup PDF.</p>
        </div>
        <div className="quote-po-total"><span>Active PO commitment</span><strong>{money(preTaxCommitment)}</strong><small>Pre-tax · void POs excluded</small></div>
      </section>

      <section className="quote-po-kpis" aria-label="Purchase order summary">
        <div><span>Total POs</span><strong>{purchaseOrders.length}</strong><small>Attached to this quote</small></div>
        <div><span>Issued</span><strong>{issuedCount}</strong><small>Released commitments</small></div>
        <div><span>Draft</span><strong>{draftCount}</strong><small>Still being prepared</small></div>
        <div><span>Job</span><strong>{job.jobNumber}</strong><small>{job.status} · {quote.project || "Project not named"}</small></div>
      </section>

      <section className="panel subcontract-po-panel quote-po-list-panel">
        <div className="panel-heading">
          <div><span className="eyebrow">PURCHASE ORDER REGISTER</span><h2>Attached purchase orders</h2><p>Edit or download a PO here without leaving the quote.</p></div>
          <span className="po-count-chip">{purchaseOrders.length} PO{purchaseOrders.length === 1 ? "" : "s"}</span>
        </div>
        <div className="data-table-wrap">
          <table className="data-table po-source-table quote-po-table">
            <thead><tr><th>PO number</th><th>Subcontractor</th><th>Vendor quote #</th><th>PO date</th><th>Status</th><th>Pre-tax</th><th><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>{purchaseOrders.map((purchaseOrder) => {
              const preTax = purchaseOrder.lines.reduce((sum, line) => sum + (Number(line.amount) || 0), 0);
              return (
                <tr key={purchaseOrder.id}>
                  <td data-label="PO number"><strong>{purchaseOrder.number || "Not assigned"}</strong></td>
                  <td data-label="Subcontractor"><strong>{purchaseOrder.vendorName || "Not recorded"}</strong><small>{purchaseOrder.vendorContact || purchaseOrder.vendorEmail || "No contact selected"}</small></td>
                  <td data-label="Vendor quote #">{purchaseOrder.vendorQuoteNumber || "—"}</td>
                  <td data-label="PO date">{shortDate(purchaseOrder.issueDate)}</td>
                  <td data-label="Status"><span className={`po-status po-${purchaseOrder.status.toLowerCase()}`}>{purchaseOrder.status}</span></td>
                  <td data-label="Pre-tax"><strong>{money(preTax)}</strong></td>
                  <td className="po-row-actions">
                    <button className="button secondary compact" onClick={() => onEditPurchaseOrder(job.id, purchaseOrder.id)}>Edit PO</button>
                    <button className="button primary compact" onClick={() => void downloadPurchaseOrder(state, job, purchaseOrder)}>Download PDF</button>
                  </td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function QuoteDivisions({ quote }: { quote: Quote }) {
  const [showAll, setShowAll] = useState(true);
  const totals = quoteTotals(quote);
  const divisions = divisionSummaries(quote);
  const visibleDivisions = showAll ? divisions : divisions.filter((division) => division.lineCount > 0);
  const assignedLines = quote.lines.filter((line) => line.included && line.division?.trim()).length;
  const includedLines = quote.lines.filter((line) => line.included).length;
  return (
    <div className="division-layout">
      <section className="panel division-hero">
        <div><span className="eyebrow">BID FORM BREAKDOWN · STEP 5 OF 7</span><h2>Pricing by construction division</h2><p>Each included estimate row rolls into its assigned division. These bid prices reconcile to the pre-tax quote total.</p></div>
        <div className="division-hero-total"><span>Pre-tax bid total</span><strong>{money(totals.subtotal)}</strong><small>{assignedLines} of {includedLines} included rows assigned</small></div>
      </section>
      <section className="panel division-table-panel">
        <div className="panel-heading division-heading"><div><span className="eyebrow">INTERNAL BID FORM</span><h2>Division breakdown</h2></div><label className="division-show-all"><input type="checkbox" checked={showAll} onChange={(event) => setShowAll(event.target.checked)} /><span>Show unused divisions</span></label></div>
        <div className="data-table-wrap">
          <table className="data-table division-table">
            <thead><tr><th>Division</th><th>Rows</th><th>Direct cost</th><th>Markup / profit</th><th>Bid price</th><th>Share</th></tr></thead>
            <tbody>
              {visibleDivisions.map((division) => <tr key={division.division} className={division.lineCount ? "" : "unused-division"}><td data-label="Division"><strong>{division.division}</strong></td><td data-label="Rows">{division.lineCount || "—"}</td><td data-label="Direct cost">{division.lineCount ? money(division.directCost) : "—"}</td><td data-label="Markup / profit">{division.lineCount ? money(division.profit) : "—"}</td><td data-label="Bid price"><strong>{division.lineCount ? money(division.bidPrice) : "—"}</strong></td><td data-label="Share">{division.lineCount ? percent(division.share) : "—"}</td></tr>)}
            </tbody>
            <tfoot><tr><td data-label="Division"><strong>Total included bid</strong></td><td data-label="Rows">{includedLines}</td><td data-label="Direct cost">{money(totals.directCost)}</td><td data-label="Markup / profit">{money(totals.profit)}</td><td data-label="Bid price"><strong>{money(totals.subtotal)}</strong></td><td data-label="Share">100.0%</td></tr></tfoot>
          </table>
        </div>
        <div className="division-note"><strong>How to change a division:</strong><span>Open the Estimate tab and choose the Division directly on each row. Price Book items select their saved division automatically.</span></div>
      </section>
    </div>
  );
}

function QuoteProposal({ state, quote }: { state: AppState; quote: Quote }) {
  const totals = quoteTotals(quote);
  const client = state.clients.find((item) => item.id === quote.clientId);
  const projectAddress = quote.address?.trim() || client?.sites.find((site) => site.label.trim().toLocaleLowerCase() === quote.site.trim().toLocaleLowerCase())?.address?.trim() || "";
  const style = "jgc-classic" as ProposalStyle;
  const required = quote.lines.filter((line) => line.included);
  const optional = quote.lines.filter((line) => line.classification === "Optional" && !line.included);
  const scope = customerScopeLines(quote);
  const notes = nonBlankLines(quote.proposalNotes);
  const sections = sectionSummaries(quote);
  const taxExtra = true;
  const categoryTotals = quoteCostCategories(quote);
  const company = {
    phone: state.settings.companyPhone ?? "(613) 932-1293",
    fax: state.settings.companyFax ?? "(613) 937-3656",
    address: state.settings.companyAddress ?? "830 Campbell St. Unit 3",
    city: state.settings.companyCity ?? "Cornwall, Ontario",
    postal: state.settings.companyPostalCode ?? "K6H 6L7",
    signatory: state.settings.signatoryName ?? quote.preparedBy ?? "Zeth Hummel",
  };
  const sharedOptional = optional.length > 0 && (
    <section className="proposal-section optional-proposal">
      <div className="proposal-section-title"><span>{style === "jgc-classic" ? "03" : "02"}</span><h3>Optional work</h3></div>
      <p className="section-note">Available if requested and not included in the base proposal price.</p>
      <table className="proposal-table"><tbody>{optional.map((line) => <tr key={line.id}><td data-label="Optional work"><strong>{line.description}</strong>{line.customerNote && <small>{line.customerNote}</small>}</td><td data-label="Amount">{money(lineSellPrice(line, quote.defaultMarkup))}</td></tr>)}</tbody></table>
    </section>
  );
  return (
    <div className="proposal-workspace">
      <div className="proposal-toolbar">
        <div><span className="eyebrow">CUSTOMER VIEW · STEP 6 OF 7</span><h2>Proposal preview</h2><p>JGC Classic lump sum. Internal costs, markup and vendors remain hidden unless you enable the optional breakdown.</p></div>
        <div className="proposal-toolbar-actions"><button className="button primary" onClick={() => void downloadCustomerProposal(state, quote)}>⇩ Proposal PDF</button></div>
      </div>
      <article className={`proposal-paper ${style === "jgc-classic" ? "classic-proposal hybrid-classic-proposal" : "modern-proposal"}`}>
        {style === "jgc-classic" ? (
          <>
            <header className="hybrid-letterhead">
              <img src="./jgc-logo-transparent.png" alt="John Gordon Construction" />
              <div className="hybrid-company-contact">
                <span>GENERAL CONTRACTOR</span>
                <div><p><strong>{company.phone}</strong><small>Phone</small></p><p><strong>{company.fax}</strong><small>Fax</small></p></div>
                <address>{company.address}<br />{company.city} {company.postal}</address>
              </div>
            </header>
            <div className="hybrid-titlebar">
              <div><span>{quote.customerQuoteType === "Budget Quote" ? "BUDGET QUOTATION" : "QUOTATION"}</span><h1>{quote.customerQuoteType === "Budget Quote" ? "Budget Quote" : "Proposal"}</h1></div>
              <div className="hybrid-quote-id"><span>QUOTE NUMBER</span><strong>{quote.number}</strong><small>Revision {quote.revision}</small></div>
            </div>
            {quote.demo && <div className="demo-watermark">DEMO ONLY — VERIFY OR DELETE</div>}
            <section className={`hybrid-meta ${projectAddress ? "has-address" : ""}`}>
              <div><span>Prepared for</span><strong>{client?.name || "Client not selected"}</strong>{(quote.proposalAttention || client?.contact) && <p>Attention: {quote.proposalAttention || client?.contact}</p>}</div>
              {projectAddress && <div><span>Address</span><strong>{projectAddress}</strong></div>}
              <div><span>Project</span><strong>{quote.site || "Site name not recorded"}</strong><p>{quote.project || "Project not named"}</p>{quote.reference && <p>Reference: {quote.reference}</p>}</div>
              <div><span>Quote date</span><strong>{shortDate(quote.quoteDate)}</strong><p>Valid until {shortDate(quote.validUntil)}</p></div>
            </section>
            <section className="hybrid-intro"><p>{state.settings.proposalIntro}</p></section>
          </>
        ) : (
          <>
            <header className="jgc-letterhead">
              <div className="letterhead-contact"><strong>Phone:</strong> {company.phone}<br /><strong>Fax:</strong> {company.fax}</div>
              <img src="./jgc-letterhead-logo.jpg" alt="John Gordon Construction" />
              <div className="letterhead-address">{company.address}<br />{company.city}<br />{company.postal}</div>
            </header>
            <div className="letterhead-title"><h1>Proposal</h1><p>{quote.number} · Revision {quote.revision}</p></div>
            {quote.demo && <div className="demo-watermark">DEMO ONLY — VERIFY OR DELETE</div>}
            <section className="classic-meta">
              <div><span>To:</span><strong>{client?.name || "Client not selected"}</strong><p>{quote.site}</p>{(quote.proposalAttention || client?.contact) && <p><b>Attention:</b> {quote.proposalAttention || client?.contact}</p>}</div>
              <div><p><span>Date:</span> {shortDate(quote.quoteDate)}</p><p><span>Project:</span> {quote.project || "Project not named"}</p>{quote.reference && <p><span>Reference:</span> {quote.reference}</p>}</div>
            </section>
            <section className="classic-intro"><p>{state.settings.proposalIntro}</p>{quote.scopeSummary && <p>{quote.scopeSummary}</p>}</section>
          </>
        )}

        {style === "jgc-classic" && (
          <>
            <section className="hybrid-document-section">
              <header><span>01</span><div><small>PROJECT SCOPE</small><h2>Scope of Work</h2></div></header>
              <ol className="hybrid-scope-list">{scope.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ol>
            </section>
            <section className="hybrid-document-section hybrid-notes-section">
              <header><span>02</span><div><small>ASSUMPTIONS & CLARIFICATIONS</small><h2>Notes</h2></div></header>
              {notes.length > 0 ? <ul className="hybrid-notes-list">{notes.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul> : <p className="hybrid-empty-note">No additional project notes recorded.</p>}
              {(quote.inclusions || quote.exclusions) && <div className="hybrid-clarifications">{quote.inclusions && <div><span>Included</span><p>{quote.inclusions}</p></div>}{quote.exclusions && <div><span>Excluded</span><p>{quote.exclusions}</p></div>}</div>}
            </section>
            {sharedOptional}
            {quote.proposalShowCostBreakdown && <section className="proposal-cost-breakdown"><h2>Cost Breakdown</h2>{([
              ["Labour", "labour"],
              ["Materials", "materials"],
              ["Subcontractors", "subcontractors"],
              ["Other direct costs", "other"],
            ] as const).filter(([, key]) => categoryTotals.direct[key] > 0).map(([label, key]) => <div key={key}><span>{label}</span><strong>{money((quote.proposalBreakdownIncludesMarkup ?? true) ? categoryTotals.sell[key] : categoryTotals.direct[key])}</strong></div>)}{!(quote.proposalBreakdownIncludesMarkup ?? true) && <div><span>Markup</span><strong>{money(totals.profit)}</strong></div>}<footer><span>Proposal total</span><strong>{money(totals.subtotal)}</strong></footer></section>}
            <section className="hybrid-lump-sum">
              <div><span>LUMP SUM PROPOSAL</span><p>Complete the Scope of Work above in a good and workmanlike manner.</p><small>{dollarsInWords(totals.subtotal)} Dollars</small></div>
              <div><strong>{money(totals.subtotal)}</strong><span>HST Extra</span></div>
            </section>
          </>
        )}

        {style === "section-summary" && (
          <>
            <section className="proposal-section"><div className="proposal-section-title"><span>01</span><h3>Scope and pricing by section</h3></div><table className="proposal-table section-summary-table"><thead><tr><th>Section / phase</th><th>Amount</th></tr></thead><tbody>{sections.map((section) => <tr key={section.section}><td data-label="Section / phase"><strong>{section.section}</strong><small>{section.descriptions.join(" · ")}</small></td><td data-label="Amount">{money(section.total)}</td></tr>)}</tbody></table></section>
            {sharedOptional}
          </>
        )}

        {style === "detailed" && (
          <>
            <section className="proposal-section"><div className="proposal-section-title"><span>01</span><h3>Scope and pricing</h3></div><table className="proposal-table"><thead><tr><th>Description</th><th>Qty</th><th>Unit</th><th>Amount</th></tr></thead><tbody>{required.map((line) => <tr key={line.id}><td data-label="Description"><strong>{line.description}</strong>{line.classification === "Allowance" && <span className="proposal-tag">Allowance</span>}{line.classification === "Optional" && <span className="proposal-tag selected">Selected option</span>}{line.customerNote && <small>{line.customerNote}</small>}</td><td data-label="Qty">{numberFormatter.format(line.quantity)}</td><td data-label="Unit">{line.unit}</td><td data-label="Amount">{money(lineSellPrice(line, quote.defaultMarkup))}</td></tr>)}</tbody></table></section>
            {sharedOptional}
          </>
        )}

        {style !== "jgc-classic" && <section className="proposal-bottom-grid"><div className="proposal-terms"><h3>Inclusions</h3><p>{quote.inclusions || "As specifically listed above."}</p><h3>Exclusions</h3><p>{quote.exclusions || "No exclusions recorded."}</p><h3>Terms</h3><p>{quote.terms}</p></div><ProposalTotals quote={quote} totals={totals} taxExtra={taxExtra} /></section>}
        {style === "jgc-classic" && !taxExtra && <ProposalTotals quote={quote} totals={totals} taxExtra={false} />}
        <section className={`classic-legal ${style === "jgc-classic" ? "hybrid-legal" : ""}`}><h3>Terms</h3><p>{quote.terms}</p><p><strong>HST Extra</strong></p></section>
        <section className={`proposal-signoff ${style === "jgc-classic" ? "hybrid-signoff" : ""}`}><div /><div><span>Respectfully submitted,</span><strong>{company.signatory}</strong><small>John Gordon Construction</small></div></section>
        <section className={`classic-acceptance ${style === "jgc-classic" ? "hybrid-acceptance" : ""}`}><h2>ACCEPTANCE</h2><p>You are hereby authorized to furnish all materials and labour to complete the work mentioned in the above proposal. The undersigned agrees to pay the amount stated in this proposal according to the terms herein.</p><div><span>Signature</span><span>Print name</span><span>Date</span></div></section>
        <footer className="proposal-footer"><strong>John Gordon Construction Inc.</strong><span>Prepared by {quote.preparedBy || "JGC Estimating"}</span><span>Quote {quote.number} · Rev {quote.revision}</span></footer>
      </article>
    </div>
  );
}

function ProposalTotals({ quote, totals, taxExtra }: { quote: Quote; totals: ReturnType<typeof quoteTotals>; taxExtra: boolean }) {
  return <div className="proposal-totals"><div><span>Subtotal</span><strong>{money(totals.subtotal)}</strong></div>{!taxExtra && <><div><span>{quote.taxName} ({percent(quote.taxRate, 0)})</span><strong>{money(totals.tax)}</strong></div><div className="proposal-grand"><span>Total</span><strong>{money(totals.total)}</strong></div></>}{taxExtra && <div className="proposal-grand"><span>Total before {quote.taxName}</span><strong>{money(totals.subtotal)}</strong></div>}{quote.depositPercent > 0 && <div><span>Deposit ({percent(quote.depositPercent, 0)})</span><strong>{money(totals.deposit)}</strong></div>}</div>;
}

function savedRevisionQuote(snapshot: string): Quote | null {
  try {
    const parsed = JSON.parse(snapshot) as Quote;
    return parsed && Array.isArray(parsed.lines) ? parsed : null;
  } catch {
    return null;
  }
}

function QuoteHistory({ state, quote }: { state: AppState; quote: Quote }) {
  const [selectedRevisionId, setSelectedRevisionId] = useState<string | null>(null);
  const activity = state.activity.filter((entry) => entry.quoteId === quote.id);
  const selectedRevision = quote.revisions.find((revision) => revision.id === selectedRevisionId) ?? null;
  const selectedSnapshot = selectedRevision ? savedRevisionQuote(selectedRevision.snapshot) : null;
  const currentVersionLabel = quote.status === "Draft" ? "Current editable quote" : quote.status === "Finished" ? "Current finished editable quote" : `Current ${quote.status.toLowerCase()} version`;

  return (
    <>
      <div className="history-layout">
        <section className="panel">
          <div className="panel-heading"><div><span className="eyebrow">SAVED VERSIONS · STEP 7 OF 7</span><h2>Quote history</h2><p>The accepted estimate is frozen here when a finished quote is made into a job.</p></div></div>
          <div className="revision-list">
            <div className="revision-card current"><div className="revision-marker">R{quote.revision}</div><div><strong>{currentVersionLabel}</strong><span>Last changed {timeAgo(quote.updatedAt)}</span></div><div><strong>{money(quoteTotals(quote).total)}</strong><small>incl. {quote.taxName}</small></div></div>
            {[...quote.revisions].reverse().map((revision) => (
              <button type="button" className="revision-card revision-card-button" key={revision.id} onClick={() => setSelectedRevisionId(revision.id)}>
                <div className="revision-marker">R{revision.revision}</div>
                <div><strong>{revision.revision === 0 ? "Original accepted quote" : "Accepted revision"}</strong><span>Saved {shortDate(revision.issuedAt)}</span><small>View saved version →</small></div>
                <div><strong>{money(revision.total)}</strong><small>frozen snapshot</small></div>
              </button>
            ))}
            {!quote.revisions.length && (quote.status === "Draft" || quote.status === "Finished") && <p className="empty-copy">When this quote is made into a job, the accepted estimate will be saved here as a locked snapshot.</p>}
          </div>
        </section>
        <section className="panel">
          <div className="panel-heading"><div><span className="eyebrow">ACTIVITY</span><h2>Quote timeline</h2></div></div>
          <div className="timeline">
            {activity.map((entry) => <div key={entry.id}><span className="timeline-dot" /><div><strong>{entry.title}</strong><p>{entry.detail}</p><small>{timeAgo(entry.createdAt)}</small></div></div>)}
          </div>
        </section>
      </div>

      {selectedRevision && selectedSnapshot && (
        <div className="modal-layer" role="presentation" onMouseDown={() => setSelectedRevisionId(null)}>
          <section className="modal-card revision-preview-modal" role="dialog" aria-modal="true" aria-labelledby="revision-preview-title" onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <div><span className="eyebrow">FROZEN QUOTE VERSION</span><h2 id="revision-preview-title">{selectedSnapshot.number} · Revision {selectedSnapshot.revision}</h2><p>{selectedSnapshot.project || "Project not named"}</p></div>
              <button aria-label="Close saved revision" onClick={() => setSelectedRevisionId(null)}>×</button>
            </header>
            <div className="revision-preview-content">
              <div className="revision-preview-summary">
                <div><span>Client</span><strong>{clientName(state, selectedSnapshot.clientId)}</strong></div>
                <div><span>Finalized</span><strong>{shortDate(selectedRevision.issuedAt)}</strong></div>
                <div><span>Pre-tax price</span><strong>{money(quoteTotals(selectedSnapshot).subtotal)}</strong></div>
                <div><span>Total with {selectedSnapshot.taxName}</span><strong>{money(quoteTotals(selectedSnapshot).total)}</strong></div>
              </div>
              <div className="revision-scope-preview">
                <span className="eyebrow">CUSTOMER SCOPE</span>
                <ol>{customerScopeLines(selectedSnapshot).map((line, index) => <li key={`${index}-${line}`}>{line}</li>)}</ol>
              </div>
              <div className="data-table-wrap revision-lines-wrap">
                <table className="data-table revision-lines-table">
                  <thead><tr><th>Estimate item</th><th>Qty</th><th>Unit</th><th>Direct cost</th><th>Customer price</th></tr></thead>
                  <tbody>{selectedSnapshot.lines.map((line) => <tr key={line.id}><td data-label="Estimate item"><strong>{line.description || "Untitled item"}</strong><small>{line.section}</small></td><td data-label="Qty">{numberFormatter.format(line.quantity)}</td><td data-label="Unit">{line.unit}</td><td data-label="Direct cost">{money(lineDirectCost(line))}</td><td data-label="Customer price"><strong>{money(lineSellPrice(line, selectedSnapshot.defaultMarkup))}</strong>{!line.included && <small>Not included</small>}</td></tr>)}</tbody>
                </table>
              </div>
            </div>
            <footer className="revision-preview-actions">
              <span>This is a read-only copy. The current revision remains unchanged.</span>
              <div><button className="button secondary" onClick={() => setSelectedRevisionId(null)}>Close</button><button className="button primary" onClick={() => void downloadQuoteBackup(state, selectedSnapshot)}>Download this version</button></div>
            </footer>
          </section>
        </div>
      )}
    </>
  );
}

function ClientsPage({ state, setState, search, setSearch, onAdd, onOpenQuote }: {
  state: AppState;
  setState: React.Dispatch<React.SetStateAction<AppState>>;
  search: string;
  setSearch: (value: string) => void;
  onAdd: () => void;
  onOpenQuote: (id: string, tab?: QuoteTab) => void;
}) {
  const [editingClientId, setEditingClientId] = useState<string | null>(null);
  const updateClient = (clientId: string, updater: (client: Client) => Client) => setState((current) => ({ ...current, clients: current.clients.map((client) => client.id === clientId ? updater(client) : client) }));
  const normalized = search.toLowerCase();
  const clients = state.clients.filter((client) => `${client.name} ${client.contact} ${(client.contacts ?? []).map((contact) => `${contact.name} ${contact.role}`).join(" ")} ${client.sites.map((site) => site.label).join(" ")}`.toLowerCase().includes(normalized));
  return (
    <div className="page-stack">
      <PageHeading eyebrow="RELATIONSHIPS" title="Clients and sites" description="Keep the customer, contact and work location consistent across every quote." actions={<button className="button primary" onClick={onAdd}>＋ Add client</button>} />
      <section className="panel toolbar-panel"><div className="search-field"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search clients or sites" /></div><span className="toolbar-note">{clients.length} client{clients.length === 1 ? "" : "s"}</span></section>
      <div className="entity-grid">
        {clients.map((client) => {
          const quotes = state.quotes.filter((quote) => quote.clientId === client.id);
          const openValue = quotes.filter((quote) => quote.status === "Draft" || quote.status === "Finished").reduce((sum, quote) => sum + quoteTotals(quote).subtotal, 0);
          const contacts = client.contacts ?? [];
          const editing = editingClientId === client.id;
          return (
            <section className="entity-card" key={client.id}>
              <div className="entity-card-head"><div className="entity-monogram">{client.name.slice(0, 2).toUpperCase()}</div><div><h2>{client.name}</h2><p>{contacts.length ? `${contacts.length} attention contact${contacts.length === 1 ? "" : "s"}` : "No contacts recorded"}</p></div>{client.demo && <span className="demo-chip">Demo</span>}</div>
              <div className="entity-stats"><div><span>Open value</span><strong>{money(openValue)}</strong></div><div><span>Quotes</span><strong>{quotes.length}</strong></div><div><span>Sites</span><strong>{client.sites.length}</strong></div></div>
              <div className="site-list"><span className="eyebrow">WORK SITES</span>{client.sites.length ? client.sites.map((site) => <div key={site.id}><strong>{site.label}</strong><span>{site.address || "Address not recorded"}</span></div>) : <p>No work sites yet.</p>}</div>
              {!!contacts.length && <div className="client-contact-summary"><span className="eyebrow">ATTENTION CONTACTS</span>{contacts.map((contact) => <span key={contact.id}><strong>{contact.name}</strong>{contact.role ? ` · ${contact.role}` : ""}</span>)}</div>}
              <div className="entity-card-actions"><div>{quotes[0] ? <button className="button secondary compact" onClick={() => onOpenQuote(quotes[0].id)}>Open latest quote</button> : <span>No quotes yet</span>}<button className="button secondary compact" onClick={() => setEditingClientId(editing ? null : client.id)}>{editing ? "Done" : "Edit client"}</button></div><span>{client.email || client.phone || "Contact details not recorded"}</span></div>
              {editing && <div className="client-editor">
                <label className="field"><span>Client name</span><input value={client.name} onChange={(event) => updateClient(client.id, (current) => ({ ...current, name: event.target.value }))} /></label>
                <div className="client-editor-section"><header><div><span className="eyebrow">SITES &amp; ADDRESSES</span><strong>{client.sites.length} saved</strong></div><button className="button secondary compact" onClick={() => updateClient(client.id, (current) => ({ ...current, sites: [...current.sites, { id: uid("site"), label: "New site", address: "" }] }))}>＋ Site</button></header>{client.sites.map((site) => <div className="client-editor-row" key={site.id}><input aria-label="Site name" value={site.label} onChange={(event) => updateClient(client.id, (current) => ({ ...current, sites: current.sites.map((item) => item.id === site.id ? { ...item, label: event.target.value } : item) }))} /><input aria-label="Site address" value={site.address} placeholder="Address" onChange={(event) => updateClient(client.id, (current) => ({ ...current, sites: current.sites.map((item) => item.id === site.id ? { ...item, address: event.target.value } : item) }))} /><button aria-label={`Remove ${site.label}`} onClick={() => updateClient(client.id, (current) => ({ ...current, sites: current.sites.filter((item) => item.id !== site.id) }))}>×</button></div>)}</div>
                <div className="client-editor-section"><header><div><span className="eyebrow">ATTENTION CONTACTS</span><strong>{contacts.length} saved</strong></div><button className="button secondary compact" onClick={() => updateClient(client.id, (current) => ({ ...current, contacts: [...(current.contacts ?? []), { id: uid("client-contact"), name: "New contact", role: "", email: "", phone: "" }] }))}>＋ Contact</button></header>{contacts.map((contact) => <div className="client-contact-editor" key={contact.id}><input aria-label="Contact name" value={contact.name} onChange={(event) => updateClient(client.id, (current) => ({ ...current, contacts: (current.contacts ?? []).map((item) => item.id === contact.id ? { ...item, name: event.target.value } : item) }))} /><input aria-label="Contact role" value={contact.role} placeholder="Role / department" onChange={(event) => updateClient(client.id, (current) => ({ ...current, contacts: (current.contacts ?? []).map((item) => item.id === contact.id ? { ...item, role: event.target.value } : item) }))} /><input aria-label="Contact email" type="email" value={contact.email} placeholder="Email" onChange={(event) => updateClient(client.id, (current) => ({ ...current, contacts: (current.contacts ?? []).map((item) => item.id === contact.id ? { ...item, email: event.target.value } : item) }))} /><input aria-label="Contact phone" value={contact.phone} placeholder="Phone" onChange={(event) => updateClient(client.id, (current) => ({ ...current, contacts: (current.contacts ?? []).map((item) => item.id === contact.id ? { ...item, phone: event.target.value } : item) }))} /><button aria-label={`Remove ${contact.name}`} onClick={() => updateClient(client.id, (current) => ({ ...current, contacts: (current.contacts ?? []).filter((item) => item.id !== contact.id) }))}>×</button></div>)}</div>
              </div>}
            </section>
          );
        })}
      </div>
      {!clients.length && <section className="panel empty-state"><span>◎</span><h3>No clients found</h3><p>Add the first customer and work site.</p><button className="button primary" onClick={onAdd}>Add client</button></section>}
    </div>
  );
}

function PriceBookPage({ state, setState, search, setSearch, category, setCategory, expandedId, setExpandedId, onAdd, onImport, supplierRefreshKey }: {
  state: AppState;
  setState: React.Dispatch<React.SetStateAction<AppState>>;
  search: string;
  setSearch: (value: string) => void;
  category: string;
  setCategory: (value: string) => void;
  expandedId: string | null;
  setExpandedId: (id: string | null) => void;
  onAdd: () => void;
  onImport: () => void;
  supplierRefreshKey: number;
}) {
  const [priceBookSection, setPriceBookSection] = useState<"services" | "materials">("services");
  const [pendingDeleteItem, setPendingDeleteItem] = useState<PriceBookItem | null>(null);
  const divisions = ["All", ...Array.from(new Set(state.priceBook.map((item) => item.category))).sort()];
  const normalized = search.toLowerCase();
  const items = state.priceBook.filter((item) => {
    const matchesCategory = category === "All" || item.category === category;
    const matchesSearch = `${item.code} ${item.name} ${item.category} ${item.costType}`.toLowerCase().includes(normalized);
    return matchesCategory && matchesSearch;
  });
  const toggleActive = (itemId: string) => setState((current) => ({ ...current, priceBook: current.priceBook.map((item) => item.id === itemId ? { ...item, active: !item.active } : item) }));
  const updateItem = <K extends keyof PriceBookItem>(itemId: string, field: K, value: PriceBookItem[K]) => {
    setState((current) => ({
      ...current,
      priceBook: current.priceBook.map((item) => item.id === itemId ? { ...item, [field]: value } : item),
    }));
  };
  const updateDefaultVendor = (itemId: string, typedName: string) => {
    const matchedVendor = activeSubcontractors(state.vendors).find((vendor) => vendor.name.trim().toLocaleLowerCase() === typedName.trim().toLocaleLowerCase());
    setState((current) => ({
      ...current,
      priceBook: current.priceBook.map((item) => item.id === itemId ? {
        ...item,
        defaultVendorId: matchedVendor?.id ?? null,
        defaultVendorName: matchedVendor ? "" : typedName,
      } : item),
    }));
  };
  const deleteItem = (item: PriceBookItem) => {
    setState((current) => ({
      ...current,
      priceBook: current.priceBook.filter((candidate) => candidate.id !== item.id),
      quotes: current.quotes.map((quote) => ({
        ...quote,
        lines: quote.lines.map((line) => line.priceBookCode === item.code ? { ...line, priceBookCode: null } : line),
      })),
    }));
    setExpandedId(null);
    setPendingDeleteItem(null);
  };
  const selectPriceBookSection = (section: "services" | "materials") => {
    setPriceBookSection(section);
    setSearch("");
    setCategory("All");
    setExpandedId(null);
  };
  return (
    <div className="page-stack">
      <PageHeading
        eyebrow="PRICING INTELLIGENCE"
        title="Price Book"
        description={priceBookSection === "services"
          ? "Reusable subcontract pricing, labour, allowances and installed unit rates such as sq. ft. and ln. ft."
          : "Supplier material costs, price dates and update history kept separately from labour and subcontract pricing."}
        actions={priceBookSection === "services"
          ? <div className="heading-actions"><button className="button primary" onClick={onAdd}>＋ Add service or rate</button></div>
          : undefined}
      />
      <section className="pricebook-section-tabs" role="tablist" aria-label="Price Book sections">
        <button type="button" role="tab" aria-selected={priceBookSection === "services"} className={priceBookSection === "services" ? "active" : ""} onClick={() => selectPriceBookSection("services")}>
          <span className="pricebook-tab-icon">↗</span>
          <span><strong>Services &amp; Assemblies</strong><small>Subcontractors, labour, allowances and installed rates</small></span>
          <b>{state.priceBook.filter((item) => item.active).length}</b>
        </button>
        <button type="button" role="tab" aria-selected={priceBookSection === "materials"} className={priceBookSection === "materials" ? "active" : ""} onClick={() => selectPriceBookSection("materials")}>
          <span className="pricebook-tab-icon">▦</span>
          <span><strong>Material Prices</strong><small>Supplier products, current costs and import history</small></span>
        </button>
      </section>
      {priceBookSection === "services" && <>
      <section className="pricebook-summary">
        <div><span>Active items</span><strong>{state.priceBook.filter((item) => item.active).length}</strong></div>
        <div><span>Live quote packages</span><strong>{state.priceBook.filter((item) => item.liveQuote).length}</strong></div>
        <div><span>Historically priced</span><strong>{state.priceBook.filter((item) => item.typical !== null).length}</strong></div>
        <div><span>Actual-cost verified</span><strong>{state.priceBook.filter((item) => item.actualVerified !== "No").length}</strong></div>
      </section>
      <section className="panel toolbar-panel price-toolbar">
        <div className="search-field"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search product, service or trade" /></div>
        <label className="compact-select"><span>Division</span><select value={category} onChange={(event) => setCategory(event.target.value)}>{divisions.map((item) => <option key={item}>{item}</option>)}</select></label>
        <span className="toolbar-note">{items.length} item{items.length === 1 ? "" : "s"}</span>
      </section>
      <section className="panel table-panel">
        <div className="data-table-wrap">
          <table className="data-table pricebook-table">
            <thead><tr><th>Product / service</th><th>Division</th><th>Cost type</th><th>Unit</th><th>Cost</th><th>Confidence</th><th>Rule</th><th>Active</th><th /></tr></thead>
            <tbody>
              {items.map((item) => (
                <Fragment key={item.id}>
                  <tr className={!item.active ? "inactive-row" : ""} onClick={() => setExpandedId(expandedId === item.id ? null : item.id)}>
                    <td data-label="Product / service"><strong>{item.name}</strong></td>
                    <td data-label="Division">{item.category}</td><td data-label="Cost type">{item.costType}</td><td data-label="Unit">{item.unit}</td>
                    <td data-label="Cost"><strong>{item.typical === null ? "Live quote" : money(item.typical)}</strong></td>
                    <td data-label="Confidence"><span className={`confidence-chip ${item.confidence.toLowerCase().replace("-", "")}`}>{item.confidence}</span></td>
                    <td data-label="Rule">{item.liveQuote ? <span className="live-quote-chip">Live quote</span> : item.pricingBasis}</td>
                    <td data-label="Active" onClick={(event) => event.stopPropagation()}><label className="switch"><input type="checkbox" checked={item.active} onChange={() => toggleActive(item.id)} /><span /></label></td>
                    <td onClick={(event) => event.stopPropagation()}>
                      <div className="price-row-actions">
                        <button className={`row-caret price-edit-button ${expandedId === item.id ? "active" : ""}`} aria-label={`Edit ${item.name}`} aria-expanded={expandedId === item.id} onClick={() => setExpandedId(expandedId === item.id ? null : item.id)}>{expandedId === item.id ? "✓" : "✎"}</button>
                        <button className="price-delete-button" aria-label={`Delete ${item.name}`} title="Delete item" onClick={() => setPendingDeleteItem(item)}>×</button>
                      </div>
                    </td>
                  </tr>
                  {expandedId === item.id && (
                    <tr className="price-detail-row">
                      <td colSpan={9}>
                        <div className="price-edit-panel">
                          <div className="price-edit-heading"><div><span className="eyebrow">EDIT PRICE BOOK ITEM</span><h3>{item.name}</h3></div><span className="autosave-chip">● Saves automatically</span></div>
                          <div className="form-grid price-edit-grid">
                            <label className="field wide-field"><span>Product / service name</span><input value={item.name} onChange={(event) => updateItem(item.id, "name", event.target.value)} /></label>
                            <label className="field"><span>Division</span><select value={item.category} onChange={(event) => updateItem(item.id, "category", event.target.value)}>{!constructionDivisions.includes(item.category) && <option value={item.category}>{item.category}</option>}{constructionDivisions.map((division) => <option key={division}>{division}</option>)}</select></label>
                            <label className="field"><span>Cost type</span><select value={item.costType} onChange={(event) => updateItem(item.id, "costType", event.target.value as CostType)}>{costTypeOptions.map((type) => <option key={type}>{type}</option>)}</select></label>
                            <label className="field"><span>Unit pricing</span><select value={unitPricingChoice(item.unit)} onChange={(event) => updateItem(item.id, "unit", event.target.value === "__custom__" ? "" : event.target.value)}>{unitPricingOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}<option value="__custom__">Custom — Type your own unit</option></select></label>
                            {unitPricingChoice(item.unit) === "__custom__" && <label className="field"><span>Custom unit</span><input value={item.unit} onChange={(event) => updateItem(item.id, "unit", event.target.value)} placeholder="e.g. /hole, m³, /fixture" /></label>}
                            {item.costType === "Sub / Vendor" && <label className="field wide-field"><span>Default subcontractor</span><SearchablePicker value={state.vendors.find((vendor) => vendor.id === item.defaultVendorId)?.name ?? item.defaultVendorName ?? ""} options={activeSubcontractors(state.vendors).map((vendor) => ({ id: vendor.id, label: vendor.name, detail: vendor.trade || undefined }))} placeholder="Search or type a subcontractor" ariaLabel={`Default subcontractor for ${item.name}`} allowCustom onChange={(value) => updateDefaultVendor(item.id, value)} onSelect={(option) => updateDefaultVendor(item.id, option.label)} /></label>}
                            <label className="field"><span>Cost</span><div className="input-prefix"><span>$</span><input type="number" min="0" step="0.01" value={item.typical ?? ""} onChange={(event) => updateItem(item.id, "typical", event.target.value === "" ? null : Number(event.target.value))} placeholder={item.liveQuote ? "Live quote required" : "No default"} /></div></label>
                            <label className="field"><span>Default markup</span><div className="input-suffix"><input type="number" min="0" step="0.5" value={item.markup * 100} onChange={(event) => updateItem(item.id, "markup", Number(event.target.value) / 100)} /><span>%</span></div></label>
                            <label className="field"><span>Default proposal class</span><select value={item.defaultClass} onChange={(event) => updateItem(item.id, "defaultClass", event.target.value as QuoteClass)}><option>Required</option><option>Allowance</option><option>Optional</option></select></label>
                            <label className="field"><span>Pricing confidence</span><select value={item.confidence} onChange={(event) => updateItem(item.id, "confidence", event.target.value as PriceBookItem["confidence"])}><option>Low</option><option>Low-Medium</option><option>Medium</option><option>High</option><option>Project-specific</option></select></label>
                            <label className="field"><span>Pricing year</span><input type="number" min="2000" max="2100" value={item.pricingYear} onChange={(event) => updateItem(item.id, "pricingYear", Number(event.target.value))} /></label>
                            <label className="field"><span>Actual-cost verified?</span><select value={item.actualVerified} onChange={(event) => updateItem(item.id, "actualVerified", event.target.value)}><option>No</option><option>Partial</option><option>Yes</option></select></label>
                            <label className="check-field"><input type="checkbox" checked={item.liveQuote} onChange={(event) => updateItem(item.id, "liveQuote", event.target.checked)} /><span><strong>Require a current vendor quote</strong><small>Leave the reusable cost blank when this is project-specific.</small></span></label>
                            <label className="check-field"><input type="checkbox" checked={item.active} onChange={(event) => updateItem(item.id, "active", event.target.checked)} /><span><strong>Active in new estimates</strong><small>Inactive items remain in the library but do not appear in the quote picker.</small></span></label>
                            <label className="field full"><span>Pricing basis / rule</span><input value={item.pricingBasis} onChange={(event) => updateItem(item.id, "pricingBasis", event.target.value)} /></label>
                            <label className="field"><span>Recommended use</span><textarea rows={4} value={item.recommendedUse} onChange={(event) => updateItem(item.id, "recommendedUse", event.target.value)} /></label>
                            <label className="field"><span>Included components</span><textarea rows={4} value={item.includedComponents} onChange={(event) => updateItem(item.id, "includedComponents", event.target.value)} /></label>
                            <label className="field"><span>Adjust / exclude</span><textarea rows={4} value={item.adjustExclude} onChange={(event) => updateItem(item.id, "adjustExclude", event.target.value)} /></label>
                            <label className="field"><span>Evidence / internal note</span><textarea rows={4} value={item.note} onChange={(event) => updateItem(item.id, "note", event.target.value)} /></label>
                          </div>
                          {item.costType === "Labour & Materials" && <div className="blended-rate-guide"><strong>Blended installed rate</strong><span>For painting, enter the measured floor area as the quote quantity, use “Floor SF” as the unit, and enter one direct cost per square foot that includes labour, paint and materials.</span></div>}
                          <div className="price-edit-footnote"><strong>Existing quotes stay unchanged.</strong><span>These edits become the defaults only when this item is added to a future estimate.</span></div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <div className="evidence-banner"><span>i</span><div><strong>Defaults for future estimates.</strong><p>These services and installed rates include subcontract packages, labour, equipment and labour-and-material assemblies. Project overrides stay on the quote, and existing estimates never change.</p></div></div>
      </>}
      {priceBookSection === "materials" && <>
        <section className="panel toolbar-panel material-price-toolbar">
          <div className="search-field"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search material, supplier or supplier reference" /></div>
          <div className="material-price-toolbar-note"><strong>Material names drive future updates.</strong><span>Spreadsheet rows can move without breaking the pricing match.</span></div>
        </section>
        <SupplierCatalogSection search={search} divisions={constructionDivisions} refreshKey={supplierRefreshKey} onImport={onImport} />
      </>}
      {pendingDeleteItem && (
        <div className="modal-layer" role="presentation" onMouseDown={() => setPendingDeleteItem(null)}>
          <section className="modal-card confirm-card" role="dialog" aria-modal="true" aria-labelledby="delete-price-item-title" onMouseDown={(event) => event.stopPropagation()}>
            <header><div><span className="eyebrow danger-eyebrow">DELETE PRICE BOOK ITEM</span><h2 id="delete-price-item-title">Delete {pendingDeleteItem.name}?</h2></div><button aria-label="Cancel deletion" onClick={() => setPendingDeleteItem(null)}>×</button></header>
            <div className="confirm-content"><div className="confirm-line-name"><span>{pendingDeleteItem.category || "General"}</span><strong>{pendingDeleteItem.name}</strong></div><p>This removes the item from the Price Book and future quote selections. Existing quote descriptions, costs and prices will stay unchanged.</p></div>
            <footer className="confirm-actions"><button className="button secondary" onClick={() => setPendingDeleteItem(null)}>Keep item</button><button className="button danger-solid" onClick={() => deleteItem(pendingDeleteItem)}>Delete item</button></footer>
          </section>
        </div>
      )}
    </div>
  );
}

function VendorsPage({ state, setState, search, setSearch, onAdd }: {
  state: AppState;
  setState: React.Dispatch<React.SetStateAction<AppState>>;
  search: string;
  setSearch: (value: string) => void;
  onAdd: () => void;
}) {
  const [expandedVendorId, setExpandedVendorId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [newContacts, setNewContacts] = useState<Record<string, Partial<VendorContact>>>({});
  const normalized = search.toLowerCase();
  const vendors = state.vendors.filter((vendor) => isSubcontractor(vendor) && `${vendor.name} ${vendor.trade} ${vendor.contact} ${vendor.email} ${vendor.phone} ${(vendor.contacts ?? []).map((contact) => `${contact.name} ${contact.role} ${contact.email} ${contact.phone}`).join(" ")}`.toLowerCase().includes(normalized));
  const updateVendor = <K extends keyof Vendor>(vendorId: string, field: K, value: Vendor[K]) => {
    setState((current) => ({
      ...current,
      vendors: current.vendors.map((vendor) => vendor.id === vendorId ? { ...vendor, [field]: value } : vendor),
    }));
  };
  const updateContact = <K extends keyof VendorContact>(vendorId: string, contactId: string, field: K, value: VendorContact[K]) => {
    setState((current) => ({
      ...current,
      vendors: current.vendors.map((vendor) => vendor.id === vendorId ? ({
        ...vendor,
        contacts: (vendor.contacts ?? []).map((contact) => contact.id === contactId ? { ...contact, [field]: value } : contact),
      }) : vendor),
    }));
  };
  const syncRequest = async (path: string, method = "GET", body?: Record<string, unknown>) => {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(path, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
      const result = await response.json() as { vendors?: Vendor[]; error?: string };
      if (!response.ok || !result.vendors) throw new Error(result.error || "The shared vendor list could not be updated.");
      setState((current) => ({ ...current, vendors: result.vendors! }));
      setMessage("Shared Portal list updated.");
      return true;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The shared vendor list could not be updated.");
      return false;
    } finally {
      setBusy(false);
    }
  };
  const saveVendor = (vendor: Vendor) => syncRequest("/api/vendors", "PATCH", { portalRecordId: vendor.portalRecordId, name: vendor.name, trade: vendor.trade, contact: vendor.contact, email: vendor.email, phone: vendor.phone, notes: vendor.notes, status: vendor.status });
  const makeMainContact = async (vendor: Vendor, contact: VendorContact) => {
    const saved = await syncRequest("/api/vendors", "PATCH", { portalRecordId: vendor.portalRecordId, name: vendor.name, trade: vendor.trade, contact: contact.name, email: contact.email, phone: contact.phone, notes: vendor.notes, status: vendor.status });
    if (saved) setMessage(`${contact.name} is now the main contact for ${vendor.name}.`);
  };
  const saveContact = (vendor: Vendor, contact: VendorContact) => syncRequest("/api/vendor-contacts", "PATCH", { portalRecordId: contact.portalRecordId, companyId: vendor.portalRecordId, name: contact.name, role: contact.role, phone: contact.phone, email: contact.email, notes: contact.notes, active: contact.active });
  const removeContact = (contact: VendorContact) => syncRequest("/api/vendor-contacts", "DELETE", { portalRecordId: contact.portalRecordId });
  const addContact = async (vendor: Vendor) => {
    const draft = newContacts[vendor.id] ?? {};
    if (!String(draft.name ?? "").trim()) return setMessage("Enter the contact's name first.");
    const saved = await syncRequest("/api/vendor-contacts", "POST", { companyId: vendor.portalRecordId, name: draft.name, role: draft.role, phone: draft.phone, email: draft.email, notes: draft.notes, active: true });
    if (saved) setNewContacts((current) => ({ ...current, [vendor.id]: {} }));
  };
  return (
    <div className="page-stack">
      <PageHeading eyebrow="SUBCONTRACTOR PRICING" title="Vendors" description="The same subcontractor companies and contacts are shared with the Portal." actions={<div className="heading-actions"><button className="button secondary" onClick={() => void syncRequest("/api/vendors")} disabled={busy}>↻ Refresh</button><button className="button primary" onClick={onAdd}>＋ Add subcontractor</button></div>} />
      <div className="estimating-boundary-note"><strong>One shared list</strong><p>Edit companies and contacts here or on the Portal’s Subs/Suppliers page. Both screens use the same records.</p><a href="../admin.html?tab=adminTools&section=subcontractorsSuppliers">Open Subs/Suppliers in Portal →</a></div>
      {message && <div className={`vendor-sync-message ${message.includes("updated") ? "success" : "error"}`}>{message}</div>}
      <section className="panel toolbar-panel"><div className="search-field"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search subcontractor, trade or contact" /></div><span className="toolbar-note">{vendors.length} subcontractor{vendors.length === 1 ? "" : "s"}</span></section>
      <section className="vendor-grid">
        {vendors.map((vendor) => {
          const contacts = (vendor.contacts ?? []).filter((contact) => contact.active);
          const primaryContact = contacts.find((contact) => contact.id === vendor.mainContactId) ?? contacts.find((contact) => contact.name.trim().toLocaleLowerCase() === vendor.contact.trim().toLocaleLowerCase()) ?? contacts[0];
          const draft = newContacts[vendor.id] ?? {};
          return (
            <article className={`vendor-card ${expandedVendorId === vendor.id ? "is-editing" : ""}`} key={vendor.id}>
              <header><div className="vendor-icon">{vendor.trade.slice(0, 1).toUpperCase()}</div><div><h2>{vendor.name}</h2><span>{vendor.trade || "Trade not specified"}</span></div><span className={`vendor-status ${vendor.status.toLowerCase()}`}>{vendor.status}</span></header>
              <div className="vendor-contact"><strong>{contacts.length ? `${contacts.length} contact${contacts.length === 1 ? "" : "s"}` : "No contacts yet"}</strong><span>{primaryContact?.name || vendor.contact || "Add a contact in this card"}{(primaryContact?.role || primaryContact?.phone || primaryContact?.email) ? ` · ${primaryContact?.role || primaryContact?.phone || primaryContact?.email}` : ""}</span></div>
              <div className="vendor-card-actions"><button className="button secondary compact" onClick={() => setExpandedVendorId(expandedVendorId === vendor.id ? null : vendor.id)}>{expandedVendorId === vendor.id ? "Close" : "Edit company & contacts"}</button></div>
              {expandedVendorId === vendor.id && (
                <div className="vendor-edit-panel">
                  <div className="vendor-edit-heading"><div><span className="eyebrow">SHARED PORTAL COMPANY</span><h3>{vendor.name || "Unnamed vendor"}</h3></div><span className="autosave-chip">● Shared with Portal</span></div>
                  <div className="form-grid vendor-edit-grid">
                    <label className="field full"><span>Subcontractor company</span><input value={vendor.name} onChange={(event) => updateVendor(vendor.id, "name", event.target.value)} /></label>
                    <label className="field"><span>Trade</span><input value={vendor.trade} onChange={(event) => updateVendor(vendor.id, "trade", event.target.value)} placeholder="Painting, electrical, drywall…" /></label>
                    <label className="field"><span>Status</span><select value={vendor.status} onChange={(event) => updateVendor(vendor.id, "status", event.target.value as Vendor["status"])}><option>Active</option><option>Inactive</option></select></label>
                    <label className="field"><span>Contact person</span><input value={vendor.contact} onChange={(event) => updateVendor(vendor.id, "contact", event.target.value)} /></label>
                    <label className="field"><span>Phone</span><input value={vendor.phone} onChange={(event) => updateVendor(vendor.id, "phone", event.target.value)} inputMode="tel" /></label>
                    <label className="field full"><span>Email</span><input type="email" value={vendor.email} onChange={(event) => updateVendor(vendor.id, "email", event.target.value)} /></label>
                    <label className="field full"><span>Notes</span><textarea rows={4} value={vendor.notes} onChange={(event) => updateVendor(vendor.id, "notes", event.target.value)} /></label>
                    <div className="vendor-save-row full"><button className="button primary" onClick={() => void saveVendor(vendor)} disabled={busy}>Save company to Portal</button><small>Changes appear on the Portal Subs/Suppliers page immediately.</small></div>
                  </div>
                  <section className="vendor-contacts-section">
                    <div className="vendor-contact-heading"><span className="eyebrow">CONTACTS</span><h3>{contacts.length ? `${contacts.length} saved contact${contacts.length === 1 ? "" : "s"}` : "Add the first contact"}</h3></div>
                    <div className="vendor-contact-list">{contacts.map((contact) => { const isMain = primaryContact?.id === contact.id; return <div className={`vendor-contact-editor ${isMain ? "is-main" : ""}`} key={contact.id}>
                      <div className="vendor-main-contact-row"><span>{isMain ? "★ Main Contact" : "Contact"}</span>{!isMain && <button className="text-button" onClick={() => void makeMainContact(vendor, contact)} disabled={busy}>Make Main Contact</button>}</div>
                      <label className="field"><span>Name</span><input value={contact.name} onChange={(event) => updateContact(vendor.id, contact.id, "name", event.target.value)} /></label>
                      <label className="field"><span>Role / title</span><input value={contact.role} onChange={(event) => updateContact(vendor.id, contact.id, "role", event.target.value)} /></label>
                      <label className="field"><span>Phone</span><input value={contact.phone} onChange={(event) => updateContact(vendor.id, contact.id, "phone", event.target.value)} /></label>
                      <label className="field"><span>Email</span><input type="email" value={contact.email} onChange={(event) => updateContact(vendor.id, contact.id, "email", event.target.value)} /></label>
                      <label className="field vendor-contact-notes"><span>Notes</span><input value={contact.notes} onChange={(event) => updateContact(vendor.id, contact.id, "notes", event.target.value)} /></label>
                      <div className="vendor-contact-actions"><button className="button primary compact" onClick={() => void saveContact(vendor, contact)} disabled={busy}>Save</button><button className="button danger-ghost compact" onClick={() => void removeContact(contact)} disabled={busy}>Remove</button></div>
                    </div>; })}</div>
                    <div className="vendor-new-contact">
                      <label className="field"><span>New contact name</span><input value={String(draft.name ?? "")} onChange={(event) => setNewContacts((current) => ({ ...current, [vendor.id]: { ...current[vendor.id], name: event.target.value } }))} /></label>
                      <label className="field"><span>Role / title</span><input value={String(draft.role ?? "")} onChange={(event) => setNewContacts((current) => ({ ...current, [vendor.id]: { ...current[vendor.id], role: event.target.value } }))} placeholder="Owner, estimator, plumber…" /></label>
                      <label className="field"><span>Phone</span><input value={String(draft.phone ?? "")} onChange={(event) => setNewContacts((current) => ({ ...current, [vendor.id]: { ...current[vendor.id], phone: event.target.value } }))} /></label>
                      <label className="field"><span>Email</span><input type="email" value={String(draft.email ?? "")} onChange={(event) => setNewContacts((current) => ({ ...current, [vendor.id]: { ...current[vendor.id], email: event.target.value } }))} /></label>
                      <button className="button success" onClick={() => void addContact(vendor)} disabled={busy}>＋ Add contact</button>
                    </div>
                  </section>
                </div>
              )}
            </article>
          );
        })}
      </section>
      {!vendors.length && <section className="panel empty-state"><span>◇</span><h3>No subcontractors found</h3><p>Add an active company marked Subcontractor on the Portal’s Subs/Suppliers page.</p><a className="button primary" href="../admin.html?tab=adminTools&section=subcontractorsSuppliers">Open Subs/Suppliers</a></section>}
    </div>
  );
}

function jobTotals(job: Job) {
  const actual = job.costs.filter((entry) => entry.type !== "Commitment").reduce((sum, entry) => sum + entry.preTaxAmount, 0);
  const labourHours = job.costs.reduce((sum, entry) => sum + (entry.hours ?? 0), 0);
  const revisedRevenue = job.acceptedRevenue + job.approvedRevenueChanges;
  const revisedBudget = job.originalCostBudget + job.approvedCostChanges;
  const forecastCost = actual + job.estimateToComplete;
  const profit = revisedRevenue - forecastCost;
  const margin = revisedRevenue > 0 ? profit / revisedRevenue : 0;
  const variance = revisedBudget - forecastCost;
  return { actual, labourHours, revisedRevenue, revisedBudget, forecastCost, profit, margin, variance };
}

function JobsPage({ state, setState, job, onOpen, onBack, onAddCost, onOpenQuote, onCreatePurchaseOrder, onEditPurchaseOrder }: {
  state: AppState;
  setState: React.Dispatch<React.SetStateAction<AppState>>;
  job: Job | null;
  onOpen: (id: string) => void;
  onBack: () => void;
  onAddCost: (jobId: string) => void;
  onOpenQuote: (id: string, tab?: QuoteTab) => void;
  onCreatePurchaseOrder: (jobId: string, lineId: string) => void;
  onEditPurchaseOrder: (jobId: string, purchaseOrderId: string) => void;
}) {
  const [statusFilter, setStatusFilter] = useState<"Active" | "Archived">("Active");
  const [jobSearch, setJobSearch] = useState("");
  const [libraryPath, setLibraryPath] = useState<LibraryPathPart[]>([]);
  const setJobStatus = (jobId: string, status: "Active" | "Archived") => {
    setState((current) => ({
      ...current,
      jobs: current.jobs.map((item) => item.id === jobId ? { ...item, status, archivedAt: status === "Archived" ? new Date().toISOString() : "" } : item),
    }));
  };
  if (job) {
    const totals = jobTotals(job);
    const linkedQuote = state.quotes.find((quote) => quote.id === job.quoteId);
    const quoteReference = linkedQuote?.number ?? "Quote unavailable";
    const subcontractLines = linkedQuote?.lines.filter((line) => line.included && line.costType === "Sub / Vendor") ?? [];
    const purchaseOrders = job.purchaseOrders ?? [];
    const duplicateRefs = Array.from(new Set(job.costs.filter((entry) => entry.reference && job.costs.filter((other) => other.reference === entry.reference).length > 1).map((entry) => entry.reference)));
    return (
      <div className="page-stack job-detail-page">
        <div className="quote-topline job-topline">
          <button className="back-button" onClick={onBack}>← All jobs</button>
          <div className="quote-identity"><div><span className="eyebrow">JOB {job.jobNumber} · {quoteReference}</span><h1>{job.project}</h1><p>{clientName(state, job.clientId)} · {linkedQuote?.site || "No location"} · Created by {linkedQuote?.preparedBy || "Unassigned"}</p></div><StatusPill status={job.status} /></div>
          <div className="quote-primary-actions"><button className="button secondary" onClick={() => onOpenQuote(job.quoteId, "history")}>Open accepted quote</button><button className="button primary" onClick={() => onAddCost(job.id)}>＋ Add actual</button><button className="button secondary" onClick={() => setJobStatus(job.id, job.status === "Active" ? "Archived" : "Active")}>{job.status === "Active" ? "Move to archive" : "Restore active job"}</button></div>
        </div>
        <div className="estimating-boundary-note"><strong>Linked to the JGC Portal</strong><p>{job.portalJobId ? "This estimate follows the matching Portal job number and active/archive status." : "This older estimator job is not linked yet. Reconnect it from its accepted quote if needed."}</p></div>
        <section className="job-kpi-grid">
          <div><span>Accepted quote</span><strong>{money(totals.revisedRevenue)}</strong><small>Pre-tax estimate</small></div>
          <div><span>Actual cost</span><strong>{money(totals.actual)}</strong><small>Entered here</small></div>
          <div><span>Labour hours</span><strong>{numberFormatter.format(totals.labourHours)}</strong><small>Actual hours entered</small></div>
          <div className={totals.margin < 0.15 ? "unfavourable" : "favourable"}><span>Forecast margin</span><strong>{percent(totals.margin)}</strong><small>{money(totals.profit)} profit</small></div>
        </section>
        <section className="panel subcontract-po-panel">
          <div className="panel-heading"><div><span className="eyebrow">SUBCONTRACTOR PURCHASE ORDERS</span><h2>Create POs from accepted estimate lines</h2><p>Each PO uses the subcontractor's direct cost and quote number. Customer markup is never included.</p></div><span className="po-count-chip">{purchaseOrders.length} PO{purchaseOrders.length === 1 ? "" : "s"}</span></div>
          {subcontractLines.length ? (
            <div className="data-table-wrap">
              <table className="data-table po-source-table">
                <thead><tr><th>Subcontractor</th><th>Accepted estimate line</th><th>Vendor quote #</th><th>Direct cost</th><th>PO</th><th><span className="sr-only">Actions</span></th></tr></thead>
                <tbody>{subcontractLines.map((line) => {
                  const vendor = line.vendorId ? state.vendors.find((item) => item.id === line.vendorId) : null;
                  const vendorName = vendor?.name ?? line.vendorName?.trim() ?? "Subcontractor not selected";
                  const linkedPurchaseOrder = purchaseOrders.find((purchaseOrder) => purchaseOrder.lines.some((item) => item.quoteLineId === line.id) && purchaseOrder.status !== "Void");
                  return (
                    <tr key={line.id}>
                      <td data-label="Subcontractor"><strong>{vendorName}</strong><small>{vendor?.trade || "Subcontractor"}</small></td>
                      <td data-label="Accepted estimate line"><strong>{line.description}</strong><small>{line.quantity} {line.unit} · {line.division || line.section}</small></td>
                      <td data-label="Vendor quote #">{line.vendorReference ? <strong>{line.vendorReference}</strong> : <span className="po-missing-reference">Not entered</span>}</td>
                      <td data-label="Direct cost"><strong>{money(lineDirectCost(line))}</strong><small>Pre-tax</small></td>
                      <td data-label="PO">{linkedPurchaseOrder ? <><strong>{linkedPurchaseOrder.number}</strong><small className={`po-status po-${linkedPurchaseOrder.status.toLowerCase()}`}>{linkedPurchaseOrder.status}</small></> : <span className="po-not-created">Not created</span>}</td>
                      <td className="po-row-actions">
                        {linkedPurchaseOrder ? <><button className="button secondary compact" onClick={() => onEditPurchaseOrder(job.id, linkedPurchaseOrder.id)}>Edit PO</button><button className="button primary compact" onClick={() => void downloadPurchaseOrder(state, job, linkedPurchaseOrder)}>Download PDF</button></> : <button className="button success compact" onClick={() => onCreatePurchaseOrder(job.id, line.id)}>＋ Create PO</button>}
                      </td>
                    </tr>
                  );
                })}</tbody>
              </table>
            </div>
          ) : <div className="empty-state compact-empty"><span>PO</span><h3>No subcontractor lines on the accepted quote</h3><p>Estimate lines marked Sub / Vendor will appear here automatically after the quote becomes a job.</p></div>}
        </section>
        <div className="job-grid">
          <section className="panel job-ledger">
            <div className="panel-heading"><div><span className="eyebrow">ESTIMATE FOLLOW-UP</span><h2>Actual costs and hours</h2></div><button className="button secondary compact" onClick={() => onAddCost(job.id)}>＋ Add actual</button></div>
            {duplicateRefs.length > 0 && <div className="duplicate-warning"><span>!</span><div><strong>Check possible duplicate references</strong><p>{duplicateRefs.join(", ")}. Two entries use the same reference and should be reviewed.</p></div></div>}
            <div className="data-table-wrap">
              <table className="data-table">
                <thead><tr><th>Date</th><th>Type</th><th>Division / section</th><th>Vendor / person</th><th>Reference</th><th>Hours</th><th>Pre-tax cost</th></tr></thead>
                <tbody>{job.costs.map((entry) => <tr key={entry.id}><td data-label="Date">{shortDate(entry.date)}</td><td data-label="Type"><span className={`cost-type-chip ${entry.type.toLowerCase()}`}>{entry.type}</span></td><td data-label="Division / section">{entry.section || "General"}</td><td data-label="Vendor / person">{entry.vendor || "—"}</td><td data-label="Reference">{entry.reference || "—"}</td><td data-label="Hours">{entry.hours ? numberFormatter.format(entry.hours) : "—"}</td><td data-label="Pre-tax cost"><strong>{money(entry.preTaxAmount)}</strong></td></tr>)}</tbody>
              </table>
            </div>
            {!job.costs.length && <div className="empty-state compact-empty"><span>$</span><h3>No actuals entered</h3><p>Add supplier, material, labour, equipment or other actual costs and hours to compare against the estimate.</p></div>}
          </section>
          <aside className="panel forecast-panel">
            <div className="panel-heading"><div><span className="eyebrow">ESTIMATE CHECK</span><h2>Cost outlook</h2></div></div>
            <div className="forecast-lines">
              <div><span>Accepted estimate cost</span><strong>{money(job.originalCostBudget)}</strong></div>
              <div><span>Actual cost to date</span><strong>{money(totals.actual)}</strong></div>
              <div className="forecast-subtotal"><span>Estimate remaining</span><strong>{money(job.originalCostBudget - totals.actual)}</strong></div>
              <label><span>Estimated cost still to come</span><div className="input-prefix"><span>$</span><input type="number" value={job.estimateToComplete} onChange={(event) => setState((current) => ({ ...current, jobs: current.jobs.map((item) => item.id === job.id ? { ...item, estimateToComplete: Number(event.target.value) } : item) }))} /></div></label>
              <div className="forecast-grand"><span>Forecast final cost</span><strong>{money(totals.forecastCost)}</strong></div>
              <div className={totals.variance < 0 ? "text-danger" : "text-success"}><span>Estimate variance</span><strong>{money(totals.variance)}</strong></div>
            </div>
            <label className="field"><span>Estimate follow-up notes</span><textarea rows={4} value={job.notes} onChange={(event) => setState((current) => ({ ...current, jobs: current.jobs.map((item) => item.id === job.id ? { ...item, notes: event.target.value } : item) }))} /></label>
          </aside>
        </div>
      </div>
    );
  }

  const normalizedSearch = jobSearch.trim().toLocaleLowerCase();
  const visibleJobs = state.jobs.filter((item) => {
    if (item.status !== statusFilter) return false;
    const linkedQuote = state.quotes.find((quote) => quote.id === item.quoteId);
    const haystack = `${item.jobNumber} ${linkedQuote?.number ?? ""} ${linkedQuote?.preparedBy ?? ""} ${clientName(state, item.clientId)} ${linkedQuote?.site ?? ""} ${item.project}`.toLocaleLowerCase();
    return haystack.includes(normalizedSearch);
  });
  const jobRecords: LibraryRecord<Job>[] = visibleJobs.map((item) => {
    const linkedQuote = state.quotes.find((quote) => quote.id === item.quoteId);
    const creator = linkedQuote?.preparedBy.trim() || "Unassigned";
    const year = (linkedQuote?.quoteDate || item.acceptedAt).slice(0, 4) || "No year";
    const location = linkedQuote?.site.trim() || "No location";
    return {
      item,
      creator: { key: creator.toLocaleLowerCase(), label: creator },
      year: { key: year, label: year },
      client: { key: item.clientId || "__no_client__", label: clientName(state, item.clientId) },
      location: { key: location.toLocaleLowerCase(), label: location },
      value: jobTotals(item).revisedRevenue,
    };
  });
  const renderJobTable = (items: Job[]) => (
    <section className="panel table-panel">
      <div className="table-summary"><strong>{items.length} {statusFilter.toLocaleLowerCase()} job{items.length === 1 ? "" : "s"}</strong><span>{jobSearch.trim() ? "Search results across every folder." : "Open a job to review its accepted estimate and actuals."}</span></div>
      <div className="data-table-wrap"><table className="data-table jobs-table"><thead><tr><th>Job / quote</th><th>Client / location</th><th>Accepted price</th><th>Estimate cost</th><th>Actual cost</th><th>Labour hours</th><th>Forecast margin</th><th>Status</th></tr></thead><tbody>{items.map((item) => { const totals = jobTotals(item); const linkedQuote = state.quotes.find((quote) => quote.id === item.quoteId); return <tr key={item.id} onClick={() => onOpen(item.id)}><td data-label="Job / quote"><strong>{item.jobNumber}</strong><small>{linkedQuote?.number ?? "Quote unavailable"} · {linkedQuote?.preparedBy || "Unassigned"}</small></td><td data-label="Client / location"><strong>{clientName(state, item.clientId)}</strong><small>{linkedQuote?.site || "No location"} · {item.project}</small></td><td data-label="Accepted price">{money(totals.revisedRevenue)}</td><td data-label="Estimate cost">{money(item.originalCostBudget)}</td><td data-label="Actual cost">{money(totals.actual)}</td><td data-label="Labour hours">{numberFormatter.format(totals.labourHours)}</td><td data-label="Forecast margin">{percent(totals.margin)}</td><td data-label="Status"><StatusPill status={item.status} /></td></tr>; })}</tbody></table></div>
      {!items.length && <div className="empty-state"><span>✓</span><h3>No {statusFilter.toLocaleLowerCase()} jobs found</h3><p>{statusFilter === "Active" ? "Make a finished, accepted quote into a Portal-linked job." : "Archived jobs will remain available here for reference."}</p></div>}
    </section>
  );

  return (
    <div className="page-stack">
      <PageHeading eyebrow="ACCEPTED ESTIMATES" title="Jobs" description="Browse accepted work by estimator, year, client and work location." />
      <div className="estimating-boundary-note"><strong>Portal-connected job tracking</strong><p>Create Job links an accepted quote to an existing active Portal job. Inactive Portal jobs appear in the archived estimator view.</p></div>
      <section className="job-kpi-grid overview">
        <div><span>Active jobs</span><strong>{state.jobs.filter((item) => item.status === "Active").length}</strong><small>Accepted estimates</small></div>
        <div><span>Archived jobs</span><strong>{state.jobs.filter((item) => item.status === "Archived").length}</strong><small>Retained history</small></div>
        <div><span>Accepted price</span><strong>{compactMoney(state.jobs.reduce((sum, item) => sum + jobTotals(item).revisedRevenue, 0))}</strong><small>All jobs · pre-tax</small></div>
        <div><span>Actual costs</span><strong>{compactMoney(state.jobs.reduce((sum, item) => sum + jobTotals(item).actual, 0))}</strong><small>Entered here</small></div>
      </section>
      <section className="panel toolbar-panel">
        <div className="search-field"><span>⌕</span><input value={jobSearch} onChange={(event) => setJobSearch(event.target.value)} placeholder="Search job number, quote, estimator, client or location" aria-label="Search jobs" /></div>
        <div className="filter-tabs" role="group" aria-label="Filter jobs by status">
          {(["Active", "Archived"] as const).map((status) => <button key={status} className={statusFilter === status ? "active" : ""} onClick={() => { setStatusFilter(status); setLibraryPath([]); }}>{status}</button>)}
        </div>
      </section>
      {jobSearch.trim() ? renderJobTable(visibleJobs) : <LibraryFolders records={jobRecords} path={libraryPath} setPath={setLibraryPath} noun="job" renderItems={renderJobTable} />}
    </div>
  );
}

function SettingsPage({ state, setState }: { state: AppState; setState: React.Dispatch<React.SetStateAction<AppState>> }) {
  const update = <K extends keyof AppState["settings"]>(key: K, value: AppState["settings"][K]) => setState((current) => ({ ...current, settings: { ...current.settings, [key]: value } }));
  return (
    <div className="page-stack settings-page">
      <PageHeading eyebrow="WORKSPACE" title="Settings" description="Company defaults for new quotes. Existing quotes keep their own pricing snapshot." />
      <div className="settings-grid">
        <section className="panel form-panel"><div className="panel-heading"><div><span className="eyebrow">COMPANY</span><h2>Proposal identity</h2></div></div><div className="form-grid two-column"><label className="field full"><span>Company name</span><input value={state.settings.companyName} onChange={(event) => update("companyName", event.target.value)} /></label><label className="field full"><span>Application name</span><input value={state.settings.appName} onChange={(event) => update("appName", event.target.value)} /></label><label className="field"><span>Phone</span><input value={state.settings.companyPhone ?? "(613) 932-1293"} onChange={(event) => update("companyPhone", event.target.value)} /></label><label className="field"><span>Fax</span><input value={state.settings.companyFax ?? "(613) 937-3656"} onChange={(event) => update("companyFax", event.target.value)} /></label><label className="field full"><span>Street address</span><input value={state.settings.companyAddress ?? "830 Campbell St. Unit 3"} onChange={(event) => update("companyAddress", event.target.value)} /></label><label className="field"><span>City</span><input value={state.settings.companyCity ?? "Cornwall, Ontario"} onChange={(event) => update("companyCity", event.target.value)} /></label><label className="field"><span>Postal code</span><input value={state.settings.companyPostalCode ?? "K6H 6L7"} onChange={(event) => update("companyPostalCode", event.target.value)} /></label><label className="field full"><span>Proposal signatory</span><input value={state.settings.signatoryName ?? "Zeth Hummel"} onChange={(event) => update("signatoryName", event.target.value)} /></label><label className="field full"><span>Proposal introduction</span><textarea rows={4} value={state.settings.proposalIntro} onChange={(event) => update("proposalIntro", event.target.value)} /></label><label className="field full"><span>Default proposal terms</span><textarea rows={5} value={state.settings.proposalTerms} onChange={(event) => update("proposalTerms", event.target.value)} /></label></div></section>
        <section className="panel form-panel"><div className="panel-heading"><div><span className="eyebrow">NEW QUOTE DEFAULTS</span><h2>Pricing and numbering</h2></div></div><div className="form-grid two-column"><label className="field"><span>Quote prefix</span><input value={state.settings.quotePrefix} onChange={(event) => update("quotePrefix", event.target.value)} /></label><label className="field"><span>Next number</span><input type="number" min="1" value={state.settings.nextQuoteNumber} onChange={(event) => update("nextQuoteNumber", Number(event.target.value))} /></label><label className="field"><span>Default markup</span><div className="input-suffix"><input type="number" value={state.settings.defaultMarkup * 100} onChange={(event) => update("defaultMarkup", Number(event.target.value) / 100)} /><span>%</span></div></label><label className="field"><span>Target margin</span><div className="input-suffix"><input type="number" value={state.settings.targetMargin * 100} onChange={(event) => update("targetMargin", Number(event.target.value) / 100)} /><span>%</span></div></label><label className="field"><span>Tax name</span><input value={state.settings.taxName} onChange={(event) => update("taxName", event.target.value)} /></label><label className="field"><span>Tax rate</span><div className="input-suffix"><input type="number" value={state.settings.taxRate * 100} onChange={(event) => update("taxRate", Number(event.target.value) / 100)} /><span>%</span></div></label><label className="field"><span>Default validity</span><div className="input-suffix"><input type="number" min="1" value={state.settings.defaultValidityDays} onChange={(event) => update("defaultValidityDays", Number(event.target.value))} /><span>days</span></div></label></div><div className="settings-note"><strong>Customer proposals always use JGC Classic lump-sum pricing with HST extra.</strong><p>These defaults apply only to newly created quotes. Finished and accepted pricing does not change when workspace defaults are updated.</p></div></section>
        <section className="panel full-span architecture-card"><div><span className="architecture-icon">↗</span><div><span className="eyebrow">PORTAL CONNECTION</span><h2>Shared job list, separate estimating workspace</h2><p>Quotes and estimate costs stay here. Official job numbers and active/archive status come from the JGC Portal.</p></div></div><div className="architecture-status"><span>Current connection</span><strong>Connected</strong></div></section>
      </div>
    </div>
  );
}

function QuickModal({ modal, state, onClose, onSubmit }: { modal: Exclude<ModalState, null>; state: AppState; onClose: () => void; onSubmit: (state: AppState) => void }) {
  const titles = { client: "Add client", vendor: "Add subcontractor", pricebook: "Add service or installed rate", jobCost: "Add actual cost or hours" };
  const [priceBookCostType, setPriceBookCostType] = useState<CostType>("Labour");
  const [priceBookUnitChoice, setPriceBookUnitChoice] = useState("LS");
  const [priceBookVendorName, setPriceBookVendorName] = useState("");
  const [submitError, setSubmitError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitError("");
    const form = new FormData(event.currentTarget);
    if (modal.kind === "client") {
      const contactName = String(form.get("contact") || "").trim();
      const contactEmail = String(form.get("email") || "").trim();
      const contactPhone = String(form.get("phone") || "").trim();
      const client: Client = { id: uid("client"), name: String(form.get("name") || "").trim(), contact: contactName, email: contactEmail, phone: contactPhone, contacts: contactName ? [{ id: uid("client-contact"), name: contactName, role: String(form.get("contactRole") || "").trim(), email: contactEmail, phone: contactPhone }] : [], sites: String(form.get("siteLabel") || "").trim() ? [{ id: uid("site"), label: String(form.get("siteLabel") || "").trim(), address: String(form.get("address") || "").trim() }] : [], notes: "" };
      if (!client.name) return;
      onSubmit({ ...state, clients: [client, ...state.clients] });
      return;
    }
    if (modal.kind === "vendor") {
      const vendor: Vendor = { id: uid("vendor"), name: String(form.get("name") || "").trim(), trade: String(form.get("trade") || "").trim(), category: "Subcontractor", portalRecordId: null, portalActive: null, portalLastSyncedAt: "", contact: String(form.get("contact") || "").trim(), email: String(form.get("email") || "").trim(), phone: String(form.get("phone") || "").trim(), status: "Active", notes: String(form.get("notes") || "").trim() };
      if (!vendor.name) return;
      setSubmitting(true);
      try {
        const response = await fetch("/api/vendors", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(vendor) });
        const result = await response.json() as { vendors?: Vendor[]; error?: string };
        if (!response.ok || !result.vendors) throw new Error(result.error || "The subcontractor could not be added to the Portal.");
        onSubmit({ ...state, vendors: result.vendors });
      } catch (error) {
        setSubmitError(error instanceof Error ? error.message : "The subcontractor could not be added to the Portal.");
      } finally {
        setSubmitting(false);
      }
      return;
    }
    if (modal.kind === "pricebook") {
      const typicalValue = String(form.get("typical") || "");
      const name = String(form.get("name") || "").trim();
      const unitPreset = String(form.get("unitPreset") || "LS");
      const unit = unitPreset === "__custom__" ? String(form.get("customUnit") || "").trim() : unitPreset;
      const typedVendorName = String(form.get("defaultVendor") || "").trim();
      const matchedVendor = activeSubcontractors(state.vendors).find((vendor) => vendor.name.trim().toLocaleLowerCase() === typedVendorName.toLocaleLowerCase());
      const item: PriceBookItem = { id: uid("pb"), code: internalPriceBookCode(name, state.priceBook), name, category: String(form.get("division") || "Div 01 – General Requirements"), costType: priceBookCostType, unit: unit || "LS", low: null, typical: typicalValue === "" ? null : Number(typicalValue), high: null, markup: state.settings.defaultMarkup, defaultClass: String(form.get("classification") || "Required") as QuoteClass, liveQuote: form.get("liveQuote") === "on", confidence: "Project-specific", pricingBasis: String(form.get("basis") || "Project-specific price"), recommendedUse: String(form.get("use") || "Verify for each project."), includedComponents: "", adjustExclude: "", note: "Added in Estimate Desk; verify against completed-job costs.", pricingYear: Number(today().slice(0, 4)), actualVerified: "No", active: true, defaultVendorId: matchedVendor?.id ?? null, defaultVendorName: matchedVendor ? "" : typedVendorName };
      if (!item.name) return;
      onSubmit({ ...state, priceBook: [item, ...state.priceBook] });
      return;
    }
    const job = state.jobs.find((item) => item.id === modal.jobId);
    if (!job) return;
    const entry: JobCostEntry = { id: uid("cost"), date: String(form.get("date") || today()), type: String(form.get("type") || "Expense") as JobCostEntry["type"], section: String(form.get("section") || "General"), vendor: String(form.get("vendor") || ""), reference: String(form.get("reference") || ""), hours: Number(form.get("hours") || 0), preTaxAmount: Number(form.get("preTaxAmount") || 0), hstAmount: 0, paid: true, notes: String(form.get("notes") || "") };
    if (!(entry.preTaxAmount > 0) && !(entry.hours && entry.hours > 0)) return;
    onSubmit({ ...state, jobs: state.jobs.map((item) => item.id === job.id ? { ...item, costs: [entry, ...item.costs] } : item) });
  };
  return (
    <div className="modal-layer" role="presentation" onMouseDown={onClose}>
      <section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="modal-title" onMouseDown={(event) => event.stopPropagation()}>
        <header><div><span className="eyebrow">QUICK ADD</span><h2 id="modal-title">{titles[modal.kind]}</h2></div><button aria-label="Close" onClick={onClose}>×</button></header>
        <form onSubmit={handleSubmit}>
          {modal.kind === "client" && <div className="form-grid two-column"><label className="field full"><span>Client name <b>*</b></span><input name="name" autoFocus required autoComplete="off" /></label><label className="field"><span>First attention contact</span><input name="contact" autoComplete="off" /></label><label className="field"><span>Role / department</span><input name="contactRole" autoComplete="off" /></label><label className="field"><span>Phone</span><input name="phone" autoComplete="off" /></label><label className="field"><span>Email</span><input name="email" type="email" autoComplete="off" /></label><label className="field"><span>First site label</span><input name="siteLabel" autoComplete="off" placeholder="e.g. Cornwall Armouries" /></label><label className="field"><span>Address</span><input name="address" autoComplete="off" /></label></div>}
          {modal.kind === "vendor" && <div className="form-grid two-column"><div className="field full actual-entry-note"><strong>Subcontractor record</strong><small>When the portal is connected, this list will come from Subs/Suppliers records categorized as Subcontractor.</small></div><label className="field full"><span>Subcontractor company <b>*</b></span><input name="name" autoFocus required /></label><label className="field"><span>Trade / service type</span><input name="trade" placeholder="Painting, electrical…" /></label><label className="field"><span>Contact</span><input name="contact" /></label><label className="field"><span>Email</span><input name="email" type="email" /></label><label className="field"><span>Phone</span><input name="phone" /></label><label className="field full"><span>Notes</span><textarea name="notes" rows={3} /></label></div>}
          {modal.kind === "pricebook" && <div className="form-grid two-column">
            <label className="field full"><span>Product / service name <b>*</b></span><input name="name" autoFocus required placeholder="e.g. Interior painting" /></label>
            <label className="field"><span>Division</span><select name="division" defaultValue="Div 01 – General Requirements">{constructionDivisions.map((division) => <option key={division}>{division}</option>)}</select></label>
            <label className="field"><span>Cost type</span><select name="costType" value={priceBookCostType} onChange={(event) => setPriceBookCostType(event.target.value as CostType)}>{costTypeOptions.map((type) => <option key={type}>{type}</option>)}</select></label>
            {priceBookCostType === "Sub / Vendor" && <label className="field full"><span>Subcontractor name</span><input type="hidden" name="defaultVendor" value={priceBookVendorName} /><SearchablePicker value={priceBookVendorName} options={activeSubcontractors(state.vendors).map((vendor) => ({ id: vendor.id, label: vendor.name, detail: vendor.trade }))} placeholder="Search or type a subcontractor" ariaLabel="Default subcontractor" allowCustom onChange={setPriceBookVendorName} onSelect={(option) => setPriceBookVendorName(option.label)} /></label>}
            <label className="field"><span>Unit pricing</span><select name="unitPreset" value={priceBookUnitChoice} onChange={(event) => setPriceBookUnitChoice(event.target.value)}>{unitPricingOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}<option value="__custom__">Custom — Type your own unit</option></select></label>
            {priceBookUnitChoice === "__custom__" && <label className="field"><span>Custom unit</span><input name="customUnit" required placeholder="e.g. /hole, m³, /fixture" /></label>}
            <label className="field"><span>Cost</span><div className="input-prefix"><span>$</span><input name="typical" type="number" min="0" step="0.01" /></div></label>
            <label className="field"><span>Default class</span><select name="classification"><option>Required</option><option>Allowance</option><option>Optional</option></select></label>
            <label className="check-field full"><input name="liveQuote" type="checkbox" /><span><strong>Require a current vendor quote</strong><small>Leave the reusable cost blank for this package.</small></span></label>
            <label className="field full"><span>Pricing basis</span><input name="basis" placeholder="How this item should be priced" /></label>
            <label className="field full"><span>Recommended use</span><textarea name="use" rows={3} /></label>
          </div>}
          {modal.kind === "jobCost" && <div className="form-grid two-column"><div className="field full actual-entry-note"><strong>Estimate follow-up only</strong><small>Enter a cost, labour hours, or both. Purchase orders can be created from subcontractor lines above; official invoices and accounting records stay in the office system.</small></div><label className="field"><span>Date</span><input name="date" type="date" defaultValue={today()} /></label><label className="field"><span>Actual type</span><select name="type"><option>Subcontractor</option><option>Material</option><option>Labour</option><option>Equipment</option><option>Expense</option></select></label><label className="field"><span>Division / section</span><input name="section" defaultValue="General" /></label><label className="field"><span>Vendor / person</span><input name="vendor" /></label><label className="field full"><span>Invoice, receipt or timesheet reference</span><input name="reference" /></label><label className="field"><span>Pre-tax cost</span><div className="input-prefix"><span>$</span><input name="preTaxAmount" type="number" min="0" step="0.01" defaultValue="0" /></div></label><label className="field"><span>Labour hours</span><input name="hours" type="number" min="0" step="0.25" defaultValue="0" /></label><label className="field full"><span>Notes</span><textarea name="notes" rows={3} /></label></div>}
          {submitError && <p className="modal-error">{submitError}</p>}
          <footer><button type="button" className="button secondary" onClick={onClose}>Cancel</button><button type="submit" className="button primary" disabled={submitting}>{submitting ? "Saving…" : "Save"}</button></footer>
        </form>
      </section>
    </div>
  );
}
