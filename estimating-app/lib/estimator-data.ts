import { normalizeProposalScopeClosingLine } from "./proposal-rich-text";

export type ViewKey =
  | "dashboard"
  | "quotes"
  | "clients"
  | "pricebook"
  | "vendors"
  | "jobs"
  | "settings";

export type QuoteStatus = "Draft" | "Finished" | "Sent" | "Won" | "Lost";
export type QuoteClass = "Required" | "Allowance" | "Optional";
export type CostType = "Labour" | "Material" | "Labour & Materials" | "Sub / Vendor" | "Equipment / Other";
export type Confidence = "Low" | "Low-Medium" | "Medium" | "High" | "Project-specific";
export type ProposalStyle = "jgc-classic" | "section-summary" | "detailed";
export type ProposalTaxDisplay = "extra" | "breakdown";
export type CustomerQuoteType = "Proposal Quote" | "Budget Quote";
export type ProposalCostBreakdownCategory = "labour" | "materials" | "subcontractors" | "coordination";
export type ProposalSubcontractorBreakdownMode = "combined" | "individual";
export const defaultProposalCostBreakdownCategories: ProposalCostBreakdownCategory[] = ["labour", "materials", "subcontractors"];

export interface PriceBookItem {
  id: string;
  code: string;
  name: string;
  category: string;
  costType: CostType;
  unit: string;
  low: number | null;
  typical: number | null;
  high: number | null;
  markup: number;
  defaultClass: QuoteClass;
  liveQuote: boolean;
  confidence: Confidence;
  pricingBasis: string;
  recommendedUse: string;
  includedComponents: string;
  adjustExclude: string;
  note: string;
  pricingYear: number;
  actualVerified: string;
  active: boolean;
  defaultVendorId?: string | null;
  defaultVendorName?: string;
}

export interface SiteAddress {
  id: string;
  label: string;
  address: string;
}

export interface ClientContact {
  id: string;
  name: string;
  role: string;
  email: string;
  phone: string;
}

export interface Client {
  id: string;
  name: string;
  contact: string;
  email: string;
  phone: string;
  sites: SiteAddress[];
  contacts?: ClientContact[];
  notes: string;
  demo?: boolean;
}

export interface Vendor {
  id: string;
  name: string;
  trade: string;
  category?: "Subcontractor" | "Supplier" | "Rental";
  portalRecordId?: string | null;
  portalActive?: boolean | null;
  portalLastSyncedAt?: string;
  contact: string;
  email: string;
  phone: string;
  status: "Active" | "Inactive";
  notes: string;
  contacts?: VendorContact[];
  mainContactId?: string | null;
  demo?: boolean;
}

export interface VendorContact {
  id: string;
  portalRecordId?: string | null;
  name: string;
  role: string;
  phone: string;
  email: string;
  notes: string;
  active: boolean;
}

export type QuoteCostBuildUpKind = "Labour" | "Material" | "Subcontractor" | "Other";

export interface QuoteCostBuildUpItem {
  id: string;
  kind: QuoteCostBuildUpKind;
  description: string;
  quantity: number;
  unit: string;
  unitCost: number;
  source: string;
  priceSourceSnapshot?: {
    kind: "supplier";
    catalogItemId: string;
    importId: string;
    supplierId: string;
    supplierName: string;
    supplierSku: string;
    effectiveDate: string;
    validUntil: string;
    capturedAt: string;
    rawUnit: string;
    listUnitPrice: number | null;
    netUnitCost: number;
  };
}

export interface QuoteCostBuildUp {
  items: QuoteCostBuildUpItem[];
}

export interface QuoteLine {
  id: string;
  section: string;
  division?: string;
  divisionManual?: boolean;
  priceBookCode: string | null;
  description: string;
  internalScope: string;
  classification: QuoteClass;
  included: boolean;
  costType: CostType;
  quantity: number;
  unit: string;
  catalogCost: number | null;
  projectCost: number | null;
  markupOverride: number | null;
  priceOverride: number | null;
  vendorId: string | null;
  vendorName?: string;
  vendorReference: string;
  vendorQuoteDate: string;
  vendorQuoteExpiry: string;
  vendorPricingMode?: "Quoted" | "Budget";
  liveQuote: boolean;
  confidence: Confidence;
  low: number | null;
  high: number | null;
  sourceNote: string;
  customerNote: string;
  internalNote: string;
  costBuildUp?: QuoteCostBuildUp;
  priceSourceSnapshot?: {
    kind: "supplier";
    catalogItemId: string;
    importId: string;
    supplierId: string;
    supplierName: string;
    supplierSku: string;
    effectiveDate: string;
    validUntil: string;
    capturedAt: string;
    rawUnit: string;
    listUnitPrice: number | null;
    netUnitCost: number;
  };
}

export interface QuoteRevision {
  id: string;
  revision: number;
  status: QuoteStatus;
  issuedAt: string;
  total: number;
  snapshot: string;
}

export interface Quote {
  id: string;
  number: string;
  revision: number;
  status: QuoteStatus;
  clientId: string;
  site: string;
  address?: string;
  project: string;
  reference: string;
  preparedBy: string;
  ownerUserId?: string;
  ownerName?: string;
  quoteDate: string;
  validUntil: string;
  quoteType: "Fixed Price" | "Unit Price" | "Budgetary";
  customerQuoteType?: CustomerQuoteType;
  taxName: string;
  taxRate: number;
  defaultMarkup: number;
  targetMargin: number;
  depositPercent: number;
  proposalStyle?: ProposalStyle;
  proposalTaxDisplay?: ProposalTaxDisplay;
  proposalScope?: string;
  proposalClosingScopeRemoved?: boolean;
  proposalNotes?: string;
  proposalAttention?: string;
  proposalAttentionContactId?: string;
  proposalShowCostBreakdown?: boolean;
  proposalBreakdownCategories?: ProposalCostBreakdownCategory[];
  proposalBreakdownLineIds?: string[];
  proposalSubcontractorBreakdownMode?: ProposalSubcontractorBreakdownMode;
  /** Retained for older saved quotes. Customer breakdown amounts now always include markup. */
  proposalBreakdownIncludesMarkup?: boolean;
  scopeSummary: string;
  inclusions: string;
  exclusions: string;
  terms: string;
  internalNotes: string;
  lines: QuoteLine[];
  acknowledgedWarnings: Record<string, string>;
  revisions: QuoteRevision[];
  createdAt: string;
  updatedAt: string;
  sentAt: string;
  wonAt: string;
  acceptedBy: string;
  customerPo: string;
  lostReason: string;
  demo?: boolean;
}

export interface JobCostEntry {
  id: string;
  date: string;
  type: "Subcontractor" | "Material" | "Labour" | "Equipment" | "Expense" | "Invoice" | "Commitment";
  section: string;
  vendor: string;
  reference: string;
  hours?: number;
  preTaxAmount: number;
  hstAmount: number;
  paid: boolean;
  notes: string;
}

export type PurchaseOrderStatus = "Draft" | "Issued" | "Void";

export interface PurchaseOrderLine {
  id: string;
  quoteLineId: string;
  description: string;
  quantity: number;
  unit: string;
  unitCost: number;
  amount: number;
  sourceReference: string;
}

export interface PurchaseOrder {
  id: string;
  number: string;
  status: PurchaseOrderStatus;
  vendorId: string | null;
  vendorName: string;
  vendorContact: string;
  vendorEmail: string;
  vendorPhone: string;
  vendorQuoteNumber: string;
  issueDate: string;
  shipBy: string;
  shipVia: string;
  fob: string;
  shipTo: string;
  authorizedBy: string;
  taxRate: number;
  notes: string;
  lines: PurchaseOrderLine[];
  createdAt: string;
  updatedAt: string;
}

export interface Job {
  id: string;
  jobNumber: string;
  quoteId: string;
  clientId: string;
  project: string;
  status: "Active" | "Archived";
  portalJobId?: string | null;
  portalActive?: boolean | null;
  portalLastSyncedAt?: string;
  archivedAt?: string;
  acceptedRevenue: number;
  originalCostBudget: number;
  approvedRevenueChanges: number;
  approvedCostChanges: number;
  estimateToComplete: number;
  acceptedAt: string;
  costs: JobCostEntry[];
  purchaseOrders?: PurchaseOrder[];
  notes: string;
}

export interface ActivityEntry {
  id: string;
  quoteId: string | null;
  title: string;
  detail: string;
  createdAt: string;
}

export interface AppSettings {
  companyName: string;
  appName: string;
  defaultMarkup: number;
  targetMargin: number;
  taxName: string;
  taxRate: number;
  quotePrefix: string;
  nextQuoteNumber: number;
  defaultValidityDays: number;
  defaultProposalStyle?: ProposalStyle;
  defaultProposalTaxDisplay?: ProposalTaxDisplay;
  companyPhone?: string;
  companyFax?: string;
  companyAddress?: string;
  companyCity?: string;
  companyPostalCode?: string;
  signatoryName?: string;
  proposalIntro: string;
  proposalTerms: string;
}

export interface AppState {
  version: number;
  settings: AppSettings;
  clients: Client[];
  vendors: Vendor[];
  priceBook: PriceBookItem[];
  quotes: Quote[];
  jobs: Job[];
  activity: ActivityEntry[];
}

const jgcProposalIntro = "We are pleased to submit our quotation for supplying the work and materials described below, subject to the terms and conditions stated.";
const jgcProposalTerms = "This proposal is based on current material and labour costs. Acceptance after 30 days requires review and re-dating. Any change in the work and price must be made in writing. Invoices are due on receipt; a 2% monthly service charge applies after 30 days.";
const jgcProposalNotes = "Price based on easy access to the job site for labour, materials and equipment\nAll work to be completed during regular business hours\nAll inspections and permits by others";

function constructionDivision(category: string) {
  if (category.startsWith("Division ")) return category;
  const divisions: Record<string, string> = {
    "General": "Div 01 – General Requirements",
    "General Conditions": "Div 01 – General Requirements",
    "Temporary Work": "Div 01 – General Requirements",
    "Travel": "Div 01 – General Requirements",
    "Labour": "Div 01 – General Requirements",
    "Administrative Costs": "Div 01 – General Requirements",
    "Investigation": "Division 02 – Existing Conditions/Demo",
    "Selective Demolition": "Division 02 – Existing Conditions/Demo",
    "Environmental": "Division 02 – Existing Conditions/Demo",
    "Concrete": "Division 03 – Concrete",
    "Carpentry": "Division 06 – Wood, Plastics and Composites",
    "Doors & Hardware": "Division 08 – Openings",
    "Painting": "Division 09 – Finishes",
    "Drywall": "Division 09 – Finishes",
    "Flooring": "Division 09 – Finishes",
    "Mechanical / Plumbing": "Division 23 – Heating, Ventilating and Air-Conditioning (HVAC)",
    "Electrical": "Division 26 – Electrical",
  };
  return divisions[category] ?? category;
}

function commonUnit(unit: string) {
  const units: Record<string, string> = {
    SF: "Sq.Ft.",
    LF: "Ln.Ft.",
    ea: "Each",
    hr: "Hour",
    day: "Day",
    "person-day": "Person-day",
    sheet: "Sheet",
  };
  return units[unit] ?? unit;
}

const priceBook: PriceBookItem[] = [
  {
    id: "pb-allow-001",
    code: "ALLOW-001",
    name: "Coordination / project administration allowance",
    category: "General Conditions",
    costType: "Equipment / Other",
    unit: "LS",
    low: 150,
    typical: 250,
    high: 250,
    markup: 0.2,
    defaultClass: "Allowance",
    liveQuote: false,
    confidence: "Low-Medium",
    pricingBasis: "Per small project allowance",
    recommendedUse: "Starting allowance for small projects; increase for submittals, meetings or long schedules.",
    includedComponents: "Basic coordination and administration.",
    adjustExclude: "Site supervision and full project-management time are separate.",
    note: "Historical quote evidence only; verify against completed-job costs.",
    pricingYear: 2026,
    actualVerified: "No",
    active: true,
  },
  {
    id: "pb-allow-002",
    code: "ALLOW-002",
    name: "Utility locates / scanning allowance",
    category: "Investigation",
    costType: "Sub / Vendor",
    unit: "LS",
    low: 1000,
    typical: 1000,
    high: 1000,
    markup: 0.2,
    defaultClass: "Allowance",
    liveQuote: false,
    confidence: "Medium",
    pricingBasis: "Per visit / small scope allowance",
    recommendedUse: "Early allowance; replace with the current specialist quote.",
    includedComponents: "Typical small-scope locating or scanning visit.",
    adjustExclude: "Complex GPR, X-ray, travel, reporting, escorts and repeat visits may be extra.",
    note: "A useful benchmark, but a live quote is still preferred.",
    pricingYear: 2026,
    actualVerified: "No",
    active: true,
  },
  {
    id: "pb-allow-003",
    code: "ALLOW-003",
    name: "Concrete cutting / coring subcontract allowance",
    category: "Selective Demolition",
    costType: "Sub / Vendor",
    unit: "LS",
    low: 1725,
    typical: 3400,
    high: 8750,
    markup: 0.2,
    defaultClass: "Allowance",
    liveQuote: false,
    confidence: "Low",
    pricingBasis: "Per small lump-sum subcontract",
    recommendedUse: "Concept pricing only; replace with a current specialist quote.",
    includedComponents: "Historical subcontract allowance.",
    adjustExclude: "Diameter, depth, reinforcement, access, scanning, slurry and mobilization change the price.",
    note: "Placeholder, not a measured unit assembly.",
    pricingYear: 2026,
    actualVerified: "No",
    active: true,
  },
  {
    id: "pb-allow-004",
    code: "ALLOW-004",
    name: "Temporary hoarding / protection allowance",
    category: "Temporary Work",
    costType: "Equipment / Other",
    unit: "LS",
    low: 2330,
    typical: 3500,
    high: 18050,
    markup: 0.2,
    defaultClass: "Allowance",
    liveQuote: false,
    confidence: "Low",
    pricingBasis: "Per small lump-sum setup",
    recommendedUse: "Preliminary budgeting; replace with measured labour and material.",
    includedComponents: "Temporary protection allowance.",
    adjustExclude: "Height, length, fire rating, negative air, finish and duration are scope dependent.",
    note: "Use the typical value only as a small-job placeholder.",
    pricingYear: 2026,
    actualVerified: "No",
    active: true,
  },
  {
    id: "pb-allow-005",
    code: "ALLOW-005",
    name: "Per diem allowance",
    category: "Travel",
    costType: "Equipment / Other",
    unit: "person-day",
    low: 150,
    typical: 150,
    high: 150,
    markup: 0.2,
    defaultClass: "Allowance",
    liveQuote: false,
    confidence: "Low",
    pricingBasis: "Per person-day",
    recommendedUse: "Planning allowance for remote work.",
    includedComponents: "Meals and incidentals.",
    adjustExclude: "Confirm company policy, tax treatment, location and duration.",
    note: "Limited evidence; verify before use.",
    pricingYear: 2026,
    actualVerified: "No",
    active: true,
  },
  {
    id: "pb-allow-006",
    code: "ALLOW-006",
    name: "Round-trip airfare allowance",
    category: "Travel",
    costType: "Equipment / Other",
    unit: "person",
    low: 1000,
    typical: 1000,
    high: 1000,
    markup: 0.2,
    defaultClass: "Allowance",
    liveQuote: false,
    confidence: "Low",
    pricingBasis: "Per traveller",
    recommendedUse: "Early budgeting only.",
    includedComponents: "Round-trip airfare allowance.",
    adjustExclude: "Baggage, vehicle, changes, remote routing and booking timing are extra.",
    note: "Replace with current travel pricing.",
    pricingYear: 2026,
    actualVerified: "No",
    active: true,
  },
  {
    id: "pb-allow-007",
    code: "ALLOW-007",
    name: "Hotel allowance",
    category: "Travel",
    costType: "Equipment / Other",
    unit: "room-night",
    low: 800,
    typical: 800,
    high: 800,
    markup: 0.2,
    defaultClass: "Allowance",
    liveQuote: false,
    confidence: "Low",
    pricingBasis: "Per room-night",
    recommendedUse: "Early budgeting only.",
    includedComponents: "Accommodation allowance.",
    adjustExclude: "Taxes, parking, season, rooms and cancellation terms may differ.",
    note: "Very limited evidence; replace with a current booking allowance.",
    pricingYear: 2026,
    actualVerified: "No",
    active: true,
  },
  {
    id: "pb-mat-001",
    code: "MAT-001",
    name: "Ready-mix concrete — normal-load material",
    category: "Concrete",
    costType: "Material",
    unit: "m³",
    low: 293.75,
    typical: 300,
    high: 306.25,
    markup: 0.2,
    defaultClass: "Required",
    liveQuote: false,
    confidence: "Low-Medium",
    pricingBasis: "Per cubic metre material",
    recommendedUse: "Material only when the measured quantity is genuinely cubic metres.",
    includedComponents: "Concrete material benchmark only.",
    adjustExclude: "Delivery, small-load fees, pump, forming, rebar, placing, finishing and winter conditions are extra.",
    note: "Confirm current supplier pricing.",
    pricingYear: 2025,
    actualVerified: "No",
    active: true,
  },
  {
    id: "pb-mat-002",
    code: "MAT-002",
    name: "Ready-mix concrete — small-load allowance",
    category: "Concrete",
    costType: "Material",
    unit: "m³",
    low: 800,
    typical: 850,
    high: 900,
    markup: 0.2,
    defaultClass: "Required",
    liveQuote: false,
    confidence: "Low",
    pricingBasis: "Per cubic metre / minimum-load allowance",
    recommendedUse: "Placeholder for very small concrete orders.",
    includedComponents: "Historical small-load material allowance.",
    adjustExclude: "Confirm minimum, delivery, standby, pump and seasonal surcharges.",
    note: "A live supplier quote should replace this allowance.",
    pricingYear: 2025,
    actualVerified: "No",
    active: true,
  },
  {
    id: "pb-mat-003",
    code: "MAT-003",
    name: "Plywood sheet allowance",
    category: "Carpentry",
    costType: "Material",
    unit: "sheet",
    low: 60,
    typical: 60,
    high: 75,
    markup: 0.2,
    defaultClass: "Required",
    liveQuote: false,
    confidence: "Low",
    pricingBasis: "Per sheet",
    recommendedUse: "Rough material allowance; select the grade and thickness for the project.",
    includedComponents: "Sheet material only.",
    adjustExclude: "Grade, thickness, treatment, delivery, waste, fasteners and labour are extra.",
    note: "Verify the exact specification.",
    pricingYear: 2026,
    actualVerified: "No",
    active: true,
  },
  ...[
    ["QUOTE-001", "Painting subcontract package", "Painting", "Confirm protection, preparation, coats, premium hours, access and patching."],
    ["QUOTE-002", "Drywall / patching subcontract package", "Drywall", "Confirm demolition, framing, board type, finish level, height, access and painting."],
    ["QUOTE-003", "Electrical subcontract package", "Electrical", "Permits, shutdowns, controls, fire alarm, communications and testing may be separate."],
    ["QUOTE-004", "Mechanical / plumbing subcontract package", "Mechanical / Plumbing", "Controls, balancing, commissioning, insulation, permits and shutdowns may be separate."],
    ["QUOTE-005", "Flooring subcontract package", "Flooring", "Substrate repair, moisture mitigation, abatement, transitions and furniture moves may be extra."],
    ["QUOTE-006", "Door / frame / hardware supply package", "Doors & Hardware", "Ratings, glazing, electrified hardware, access control, freight and field dimensions matter."],
    ["QUOTE-007", "Hazardous-material / environmental subcontract package", "Environmental", "Testing, monitoring, disposal, permits, premium hours and reinstatement may be separate."],
  ].map(([code, name, category, exclusions], index): PriceBookItem => ({
    id: `pb-quote-${String(index + 1).padStart(3, "0")}`,
    code,
    name,
    category,
    costType: "Sub / Vendor",
    unit: "LS",
    low: null,
    typical: null,
    high: null,
    markup: 0.2,
    defaultClass: "Required",
    liveQuote: true,
    confidence: "Medium",
    pricingBasis: "Current vendor quote × project markup",
    recommendedUse: "Obtain a current quote and retain the vendor reference with the estimate.",
    includedComponents: "Current supplier or subcontractor quotation carried as direct cost.",
    adjustExclude: exclusions,
    note:
      code === "QUOTE-007"
        ? "One 2025 Elite invoice matched its estimate at $4,295. This supports quote pass-through, not a reusable rate."
        : "Historical lump sums are not comparable without measured scope; use a live quote.",
    pricingYear: 2026,
    actualVerified: code === "QUOTE-007" ? "Yes — one invoice matched" : "No",
    active: true,
  })),
  {
    id: "pb-rate-001",
    code: "RATE-001",
    name: "Regular field labour estimating rate",
    category: "Labour",
    costType: "Labour",
    unit: "hr",
    low: 110,
    typical: 120,
    high: 120,
    markup: 0.2,
    defaultClass: "Required",
    liveQuote: false,
    confidence: "Medium",
    pricingBasis: "Per labour hour",
    recommendedUse: "Self-performed work when production hours are known.",
    includedComponents: "Loaded estimating labour rate used in historical cost sheets.",
    adjustExclude: "Confirm payroll burden and actual production cost annually.",
    note: "Use the current rate, then apply the project markup.",
    pricingYear: 2026,
    actualVerified: "No",
    active: true,
  },
  {
    id: "pb-rate-002",
    code: "RATE-002",
    name: "After-hours / night-shift labour estimating rate",
    category: "Labour",
    costType: "Labour",
    unit: "hr",
    low: 175,
    typical: 175,
    high: 175,
    markup: 0.2,
    defaultClass: "Required",
    liveQuote: false,
    confidence: "Low",
    pricingBasis: "Per labour hour",
    recommendedUse: "Evening, weekend or overtime work only.",
    includedComponents: "Historical after-hours estimating rate.",
    adjustExclude: "Premium rules, minimum call-outs, supervision and access restrictions may be extra.",
    note: "Verify the premium and payroll treatment before every issue.",
    pricingYear: 2026,
    actualVerified: "No",
    active: true,
  },
  {
    id: "pb-rate-003",
    code: "RATE-003",
    name: "Site supervision",
    category: "Labour",
    costType: "Labour",
    unit: "hr",
    low: 65,
    typical: 75,
    high: 82,
    markup: 0.2,
    defaultClass: "Required",
    liveQuote: false,
    confidence: "Low-Medium",
    pricingBasis: "Per supervision hour",
    recommendedUse: "Use when expected supervision hours can be estimated.",
    includedComponents: "Supervisor time only.",
    adjustExclude: "Travel, coordination, site office, reporting and after-hours premiums may be extra.",
    note: "Price hours explicitly instead of hiding supervision inside another line.",
    pricingYear: 2026,
    actualVerified: "No",
    active: true,
  },
];

const demoLines: QuoteLine[] = [
  ["line-1", "General", "QUOTE-001", "Painting subcontract package", "Painting contractor quote", "Sub / Vendor", 1, "LS", null, 15000, "vendor-paint", "PAINT-DEMO", true, "Medium"],
  ["line-2", "General", null, "Painting materials allowance", "Project-specific materials", "Material", 1, "LS", null, 1000, null, "Supplier allowance", false, "Project-specific"],
  ["line-3", "General", "RATE-001", "Miscellaneous field labour", "Sixteen estimated field hours", "Labour", 16, "hr", 120, null, null, "Historical JGC rate", false, "Medium"],
  ["line-4", "Room Demo", "QUOTE-002", "Drywall and patching subcontract", "Current demo subcontract quote", "Sub / Vendor", 1, "LS", null, 1400, "vendor-drywall", "DRYWALL-DEMO", true, "Medium"],
  ["line-5", "Room Demo", "QUOTE-003", "Electrical disconnection allowance", "Current demo subcontract quote", "Sub / Vendor", 1, "LS", null, 800, "vendor-electrical", "ELEC-DEMO", true, "Medium"],
  ["line-6", "Room Demo", null, "Selective demolition", "Labour and consumables", "Labour", 1, "LS", null, 490, null, "Project takeoff", false, "Project-specific"],
  ["line-7", "Room Demo", null, "Painting and touch-ups", "Self-performed labour and materials", "Labour", 1, "LS", null, 1300, null, "Project takeoff", false, "Project-specific"],
  ["line-8", "Room Demo", null, "Patching and making good", "Self-performed labour and materials", "Labour", 1, "LS", null, 490, null, "Project takeoff", false, "Project-specific"],
  ["line-9", "General", null, "Site setup and miscellaneous materials", "Project allowance", "Equipment / Other", 1, "LS", null, 500, null, "Project allowance", false, "Project-specific"],
].map((row) => {
  const [id, section, priceBookCode, description, internalScope, costType, quantity, unit, catalogCost, projectCost, vendorId, vendorReference, liveQuote, confidence] = row as [
    string,
    string,
    string | null,
    string,
    string,
    CostType,
    number,
    string,
    number | null,
    number | null,
    string | null,
    string,
    boolean,
    Confidence,
  ];
  return {
    id,
    section,
    priceBookCode,
    description,
    internalScope,
    classification: "Required",
    included: true,
    costType,
    quantity,
    unit,
    catalogCost,
    projectCost,
    markupOverride: null,
    priceOverride: null,
    vendorId,
    vendorReference,
    vendorQuoteDate: "2026-08-07",
    vendorQuoteExpiry: "2026-09-06",
    liveQuote,
    confidence,
    low: null,
    high: null,
    sourceNote: vendorReference,
    customerNote: "",
    internalNote: "Demo only — verify all scope and pricing.",
  };
});

demoLines.push({
  id: "line-10",
  section: "Optional Work",
  priceBookCode: "ALLOW-002",
  description: "Utility locates / scanning allowance",
  internalScope: "Optional early investigation allowance",
  classification: "Optional",
  included: false,
  costType: "Sub / Vendor",
  quantity: 1,
  unit: "LS",
  catalogCost: 1000,
  projectCost: null,
  markupOverride: null,
  priceOverride: null,
  vendorId: null,
  vendorReference: "Historical allowance",
  vendorQuoteDate: "",
  vendorQuoteExpiry: "",
  liveQuote: false,
  confidence: "Medium",
  low: 1000,
  high: 1000,
  sourceNote: "Historical allowance — replace with live quote.",
  customerNote: "Available if requested before construction begins.",
  internalNote: "Demo optional item; not included in base total.",
});

export function createDefaultState(): AppState {
  return {
    version: 10,
    settings: {
      companyName: "John Gordon Construction Inc.",
      appName: "JGC Estimate Desk",
      defaultMarkup: 0.2,
      targetMargin: 0.15,
      taxName: "HST",
      taxRate: 0.13,
      quotePrefix: "JGC-Q",
      nextQuoteNumber: 2,
      defaultValidityDays: 30,
      defaultProposalStyle: "jgc-classic",
      defaultProposalTaxDisplay: "extra",
      companyPhone: "(613) 932-1293",
      companyFax: "(613) 937-3656",
      companyAddress: "830 Campbell St. Unit 3",
      companyCity: "Cornwall, Ontario",
      companyPostalCode: "K6H 6L7",
      signatoryName: "Zeth Hummel",
      proposalIntro: jgcProposalIntro,
      proposalTerms: jgcProposalTerms,
    },
    clients: [
      {
        id: "client-bgis-demo",
        name: "BGIS — demo only",
        contact: "",
        email: "",
        phone: "",
        sites: [
          { id: "site-lancaster-demo", label: "Lancaster MTO — demo", address: "Lancaster, Ontario" },
        ],
        notes: "Demo only — duplicate or delete before production use.",
        demo: true,
      },
    ],
    vendors: [
      { id: "vendor-paint", name: "Demo Painting Vendor", trade: "Painting", category: "Subcontractor", portalRecordId: null, portalActive: null, portalLastSyncedAt: "", contact: "", email: "", phone: "", status: "Active", notes: "Demo only", demo: true },
      { id: "vendor-drywall", name: "Demo Drywall Vendor", trade: "Drywall", category: "Subcontractor", portalRecordId: null, portalActive: null, portalLastSyncedAt: "", contact: "", email: "", phone: "", status: "Active", notes: "Demo only", demo: true },
      { id: "vendor-electrical", name: "Demo Electrical Vendor", trade: "Electrical", category: "Subcontractor", portalRecordId: null, portalActive: null, portalLastSyncedAt: "", contact: "", email: "", phone: "", status: "Active", notes: "Demo only", demo: true },
    ],
    priceBook: priceBook.map((item) => ({
      ...item,
      category: constructionDivision(item.category),
      unit: commonUnit(item.unit),
      defaultVendorId: null,
      defaultVendorName: "",
    })),
    quotes: [
      {
        id: "quote-demo-lancaster",
        number: "JGC-Q-2026-0001",
        revision: 0,
        status: "Draft",
        clientId: "client-bgis-demo",
        site: "Lancaster MTO — demo",
        project: "IONP005920 — Lancaster TIS (demo)",
        reference: "IONP005920",
        preparedBy: "Zeth",
        quoteDate: "2026-08-13",
        validUntil: "2026-09-12",
        quoteType: "Fixed Price",
        taxName: "HST",
        taxRate: 0.13,
        defaultMarkup: 0.2,
        targetMargin: 0.15,
        depositPercent: 0,
        proposalStyle: "jgc-classic",
        proposalTaxDisplay: "extra",
        proposalScope: "Painting and finish work as described in the estimate\nSelective demolition, patching and making good\nDemobilize and leave site in a clean fashion",
        proposalClosingScopeRemoved: false,
        proposalNotes: jgcProposalNotes,
        proposalAttention: "",
        scopeSummary: "Demo estimate showing the intended JGC workflow. Verify every description, quantity and price before use.",
        inclusions: "Labour, materials and subcontract work specifically listed in the proposal.",
        exclusions: "Permits, hazardous materials, concealed conditions and work not specifically identified.",
        terms: "Demo only. Pricing is valid for 14 days and subject to final scope confirmation.",
        internalNotes: "Demo only — duplicate or delete. Direct cost $22,900; sell $27,480 at 20% markup.",
        lines: demoLines,
        acknowledgedWarnings: {},
        revisions: [],
        createdAt: "2026-08-13T09:00:00.000Z",
        updatedAt: "2026-08-13T09:00:00.000Z",
        sentAt: "",
        wonAt: "",
        acceptedBy: "",
        customerPo: "",
        lostReason: "",
        demo: true,
      },
    ],
    jobs: [],
    activity: [
      {
        id: "activity-1",
        quoteId: "quote-demo-lancaster",
        title: "Demo quote created",
        detail: "A sample estimate was loaded so the complete workflow can be explored.",
        createdAt: "2026-08-13T09:00:00.000Z",
      },
      {
        id: "activity-2",
        quoteId: null,
        title: "Price Book imported",
        detail: "20 researched JGC pricing rules and allowances were added as a starting library.",
        createdAt: "2026-08-13T08:50:00.000Z",
      },
    ],
  };
}

export function normalizeAppState(state: AppState): AppState {
  const oldIntro = "Thank you for the opportunity to provide pricing for the work described below.";
  const oldTerms = "Pricing is valid for the period shown and is subject to the listed inclusions, exclusions and clarifications.";
  return {
    ...state,
    version: 10,
    settings: {
      ...state.settings,
      defaultValidityDays: state.version < 2 && state.settings.defaultValidityDays === 14 ? 30 : state.settings.defaultValidityDays,
      defaultProposalStyle: state.settings.defaultProposalStyle ?? "jgc-classic",
      defaultProposalTaxDisplay: state.settings.defaultProposalTaxDisplay ?? "extra",
      companyPhone: state.settings.companyPhone ?? "(613) 932-1293",
      companyFax: state.settings.companyFax ?? "(613) 937-3656",
      companyAddress: state.settings.companyAddress ?? "830 Campbell St. Unit 3",
      companyCity: state.settings.companyCity ?? "Cornwall, Ontario",
      companyPostalCode: state.settings.companyPostalCode ?? "K6H 6L7",
      signatoryName: state.settings.signatoryName ?? "Zeth Hummel",
      proposalIntro: state.settings.proposalIntro === oldIntro ? jgcProposalIntro : state.settings.proposalIntro,
      proposalTerms: state.settings.proposalTerms === oldTerms ? jgcProposalTerms : state.settings.proposalTerms,
    },
    clients: state.clients.map((client) => ({
      ...client,
      sites: Array.isArray(client.sites) ? client.sites : [],
      contacts: Array.isArray(client.contacts)
        ? client.contacts.map((contact) => ({ ...contact, role: contact.role ?? "", email: contact.email ?? "", phone: contact.phone ?? "" }))
        : client.contact?.trim()
          ? [{ id: `contact-${client.id}-legacy`, name: client.contact.trim(), role: "", email: client.email ?? "", phone: client.phone ?? "" }]
          : [],
    })),
    vendors: state.vendors.map((vendor) => ({
      ...vendor,
      category: vendor.category ?? (vendor.trade === "Material Supplier" ? "Supplier" : "Subcontractor"),
      portalRecordId: vendor.portalRecordId ?? null,
      portalActive: vendor.portalActive ?? null,
      portalLastSyncedAt: vendor.portalLastSyncedAt ?? "",
      contacts: Array.isArray(vendor.contacts) ? vendor.contacts.map((contact) => ({
        ...contact,
        portalRecordId: contact.portalRecordId ?? null,
        name: contact.name ?? "",
        role: contact.role ?? "",
        phone: contact.phone ?? "",
        email: contact.email ?? "",
        notes: contact.notes ?? "",
        active: contact.active !== false,
      })) : [],
      mainContactId: vendor.mainContactId ?? null,
    })),
    quotes: state.quotes.map((quote) => ({
      ...quote,
      status: quote.status === "Sent" ? "Finished" : quote.status,
      proposalStyle: quote.proposalStyle ?? "jgc-classic",
      proposalTaxDisplay: quote.proposalTaxDisplay ?? "extra",
      proposalScope: normalizeProposalScopeClosingLine(quote.proposalScope, quote.proposalClosingScopeRemoved === true),
      proposalClosingScopeRemoved: quote.proposalClosingScopeRemoved === true,
      proposalNotes: quote.proposalNotes ?? jgcProposalNotes,
      proposalAttention: quote.proposalAttention ?? "",
      proposalAttentionContactId: quote.proposalAttentionContactId ?? "",
      address: quote.address ?? "",
      ownerUserId: quote.ownerUserId ?? "",
      ownerName: quote.ownerName ?? quote.preparedBy ?? "",
      customerQuoteType: quote.customerQuoteType ?? (quote.quoteType === "Budgetary" ? "Budget Quote" : "Proposal Quote"),
      proposalShowCostBreakdown: quote.proposalShowCostBreakdown ?? false,
      proposalBreakdownCategories: Array.isArray(quote.proposalBreakdownCategories)
        ? [...new Set(quote.proposalBreakdownCategories.filter((category): category is ProposalCostBreakdownCategory => defaultProposalCostBreakdownCategories.includes(category as ProposalCostBreakdownCategory)))]
        : [...defaultProposalCostBreakdownCategories],
      proposalBreakdownLineIds: Array.isArray(quote.proposalBreakdownLineIds)
        ? [...new Set(quote.proposalBreakdownLineIds.filter((lineId): lineId is string => typeof lineId === "string" && quote.lines.some((line) => line.id === lineId)))]
        : undefined,
      proposalSubcontractorBreakdownMode: quote.proposalSubcontractorBreakdownMode === "individual" ? "individual" : "combined",
      proposalBreakdownIncludesMarkup: true,
      lines: quote.lines.map((line) => {
        const priceBookItem = state.priceBook.find((item) => item.code === line.priceBookCode);
        const subcontractorName = line.vendorName?.trim()
          || state.vendors.find((vendor) => vendor.id === line.vendorId)?.name.trim()
          || "";
        return {
          ...line,
          description: line.costType === "Sub / Vendor" && !line.description?.trim()
            ? subcontractorName
            : line.description,
          division: line.division ?? (priceBookItem ? constructionDivision(priceBookItem.category) : "Div 01 – General Requirements"),
          vendorPricingMode: line.vendorPricingMode ?? (line.vendorReference?.trim() ? "Quoted" : "Budget"),
          costBuildUp: line.costBuildUp
            ? {
                items: Array.isArray(line.costBuildUp.items)
                  ? line.costBuildUp.items.map((item) => ({
                      ...item,
                      kind: item.kind === "Material" || item.kind === "Subcontractor" || item.kind === "Other" ? item.kind : "Labour",
                      description: item.description ?? "",
                      quantity: Number(item.quantity) || 0,
                      unit: item.unit ?? "",
                      unitCost: Number(item.unitCost) || 0,
                      source: item.source ?? "",
                    }))
                  : [],
              }
            : undefined,
        };
      }),
    })),
    jobs: state.jobs.map((job) => ({
      ...job,
      status: (job.status as string) === "Complete" ? "Archived" : job.status,
      portalJobId: job.portalJobId ?? null,
      portalActive: job.portalActive ?? null,
      portalLastSyncedAt: job.portalLastSyncedAt ?? "",
      archivedAt: job.archivedAt ?? "",
      purchaseOrders: Array.isArray(job.purchaseOrders)
        ? job.purchaseOrders.map((purchaseOrder) => ({
            ...purchaseOrder,
            status: purchaseOrder.status === "Issued" || purchaseOrder.status === "Void" ? purchaseOrder.status : "Draft",
            vendorId: purchaseOrder.vendorId ?? null,
            vendorName: purchaseOrder.vendorName ?? "",
            vendorContact: purchaseOrder.vendorContact ?? "",
            vendorEmail: purchaseOrder.vendorEmail ?? "",
            vendorPhone: purchaseOrder.vendorPhone ?? "",
            vendorQuoteNumber: purchaseOrder.vendorQuoteNumber ?? "",
            shipBy: purchaseOrder.shipBy ?? "Your Means",
            shipVia: purchaseOrder.shipVia ?? "Your Means",
            fob: purchaseOrder.fob ?? "Job Site",
            shipTo: purchaseOrder.shipTo ?? "Job Site",
            authorizedBy: purchaseOrder.authorizedBy ?? state.settings.signatoryName ?? "Zeth Hummel",
            taxRate: Number.isFinite(purchaseOrder.taxRate) ? purchaseOrder.taxRate : state.settings.taxRate,
            notes: purchaseOrder.notes ?? "The purchase order number must appear on all invoices and documents relating to this order.",
            lines: Array.isArray(purchaseOrder.lines)
              ? purchaseOrder.lines.map((line) => ({
                  ...line,
                  quoteLineId: line.quoteLineId ?? "",
                  description: line.description ?? "",
                  quantity: Number(line.quantity) || 0,
                  unit: line.unit ?? "LS",
                  unitCost: Number(line.unitCost) || 0,
                  amount: Number(line.amount) || 0,
                  sourceReference: line.sourceReference ?? "",
                }))
              : [],
            createdAt: purchaseOrder.createdAt ?? new Date().toISOString(),
            updatedAt: purchaseOrder.updatedAt ?? purchaseOrder.createdAt ?? new Date().toISOString(),
          }))
        : [],
    })),
    priceBook: state.priceBook.map((item) => ({
      ...item,
      category: state.version < 4 ? constructionDivision(item.category) : item.category,
      unit: state.version < 3 ? commonUnit(item.unit) : item.unit,
      defaultVendorId: item.defaultVendorId ?? null,
      defaultVendorName: item.defaultVendorName ?? "",
    })),
  };
}

export function buildUpItemTotal(item: QuoteCostBuildUpItem): number {
  return roundMoney(Math.max(0, item.quantity || 0) * Math.max(0, item.unitCost || 0));
}

export function lineBuildUpTotals(line: QuoteLine) {
  const items = line.costBuildUp?.items ?? [];
  const labour = roundMoney(items.filter((item) => item.kind === "Labour").reduce((sum, item) => sum + buildUpItemTotal(item), 0));
  const materials = roundMoney(items.filter((item) => item.kind === "Material").reduce((sum, item) => sum + buildUpItemTotal(item), 0));
  const subcontractors = roundMoney(items.filter((item) => item.kind === "Subcontractor").reduce((sum, item) => sum + buildUpItemTotal(item), 0));
  const other = roundMoney(items.filter((item) => item.kind === "Other").reduce((sum, item) => sum + buildUpItemTotal(item), 0));
  return { labour, materials, subcontractors, other, total: roundMoney(labour + materials + subcontractors + other) };
}

export function effectiveUnitCost(line: QuoteLine): number {
  if (line.costBuildUp) return lineBuildUpTotals(line).total;
  return line.projectCost ?? line.catalogCost ?? 0;
}

export function preciseLineDirectCost(line: QuoteLine): number {
  return roundMoney(Math.max(0, line.quantity || 0) * effectiveUnitCost(line));
}

export function lineDirectCost(line: QuoteLine): number {
  return Math.ceil(preciseLineDirectCost(line));
}

export function lineSellPrice(line: QuoteLine, defaultMarkup: number): number {
  if (line.priceOverride !== null) return roundMoney(line.priceOverride);
  const markup = line.markupOverride ?? defaultMarkup;
  return roundMoney(lineDirectCost(line) * (1 + markup));
}

export function quoteTotals(quote: Quote) {
  const includedLines = quote.lines.filter((line) => line.included);
  const directCost = roundMoney(includedLines.reduce((sum, line) => sum + lineDirectCost(line), 0));
  const subtotal = roundMoney(includedLines.reduce((sum, line) => sum + lineSellPrice(line, quote.defaultMarkup), 0));
  const tax = roundMoney(subtotal * quote.taxRate);
  const total = roundMoney(subtotal + tax);
  const profit = roundMoney(subtotal - directCost);
  const margin = subtotal > 0 ? profit / subtotal : 0;
  const markup = directCost > 0 ? profit / directCost : 0;
  const deposit = roundMoney(total * quote.depositPercent);
  const optional = roundMoney(
    quote.lines
      .filter((line) => line.classification === "Optional" && !line.included)
      .reduce((sum, line) => sum + lineSellPrice(line, quote.defaultMarkup), 0),
  );
  return { directCost, subtotal, tax, total, profit, margin, markup, deposit, optional };
}

export function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
