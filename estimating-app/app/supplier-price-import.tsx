"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { Vendor } from "../lib/estimator-data";
import type { SupplierCatalogItemRecord, SupplierCatalogSearchResponse, SupplierImportApplyMetadata } from "../lib/supplier-catalog-types";
import { normalizeMaterialName, parseMaterialPriceWorkbook } from "../lib/material-price-workbook";
import { finishEmardOcr, normalizeSupplierSku, parseBmrPdfTokens, parseEmardOcrTsv, type PdfTextToken, type SupplierParsedRow, type SupplierParseResult } from "../lib/supplier-price-parser";

type ReviewStatus = "new" | "changed" | "unchanged" | "review";
type ImportPhase = "choose" | "reading" | "review" | "applying" | "complete";

interface ReviewRow extends SupplierParsedRow {
  selected: boolean;
  status: ReviewStatus;
  oldCost: number | null;
}

const currency = new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", minimumFractionDigits: 2, maximumFractionDigits: 3 });

function money(value: number | null) {
  return value === null ? "—" : currency.format(value);
}

function supplierSlug(name: string) {
  return name.toLocaleLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "supplier";
}

function sameSupplier(left: string, right: string) {
  const normalize = (value: string) => value.toLocaleLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const a = normalize(left);
  const b = normalize(right);
  if (a === b) return true;
  if ((a.includes("bmr") || a.includes("rona")) && (b.includes("bmr") || b.includes("rona"))) return true;
  return a.includes("emard") && b.includes("emard");
}

function normalizeShortDate(value: string) {
  const match = value.match(/(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
  if (!match) return "";
  const year = Number(match[3]) < 100 ? 2000 + Number(match[3]) : Number(match[3]);
  const month = Number(match[1]);
  const day = Number(match[2]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return "";
  return date.toISOString().slice(0, 10);
}

function addDays(value: string, days: number) {
  if (!value) return "";
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function readEmardDocumentMetadata(text: string) {
  const date = normalizeShortDate(text);
  const subtotalMatch = text.match(/SUB\s*[- ]?\s*TOTAL\s*\$?\s*([\d,]+\.\d{2})/i);
  return {
    detectedDate: date,
    validUntil: date && /14\s*(?:CALENDAR\s*)?DAYS?/i.test(text) ? addDays(date, 14) : "",
    sourceSubtotal: subtotalMatch ? Number(subtotalMatch[1].replace(/,/g, "")) : null,
  };
}

function selectedSupplier(name: string, vendors: Vendor[]) {
  const existing = vendors.find((vendor) => (vendor.category ?? (vendor.trade === "Material Supplier" ? "Supplier" : "Subcontractor")) !== "Subcontractor" && sameSupplier(vendor.name, name));
  return { id: existing?.id ?? `supplier-${supplierSlug(name)}`, name: existing?.name ?? name, existing };
}

async function sha256(file: File) {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function readSupplierPdf(file: File, onProgress: (value: number, message: string) => void, cancelled: { current: boolean }) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = "./supplier-import/pdf.worker.min.mjs";
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const pdf = await loadingTask.promise;
  const textPages: PdfTextToken[][] = [];
  let embeddedCharacters = 0;
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    if (cancelled.current) throw new Error("Import cancelled.");
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const tokens = content.items.filter((item): item is typeof item & { str: string; transform: number[]; width: number } => "str" in item).map((item) => ({ text: item.str, x: item.transform[4], y: item.transform[5], width: item.width }));
    embeddedCharacters += tokens.reduce((sum, token) => sum + token.text.length, 0);
    textPages.push(tokens);
    onProgress((pageNumber / pdf.numPages) * 0.25, `Checking page ${pageNumber} of ${pdf.numPages}`);
  }
  const firstText = textPages.slice(0, 2).flat().map((token) => token.text).join(" ").toLocaleUpperCase();
  if (embeddedCharacters > 500) {
    if (!firstText.includes("BMR") && !firstText.includes("PERKINS")) throw new Error("This text price-list format is not supported yet. BMR/RONA and scanned Emard lists are supported.");
    onProgress(0.85, "Reading BMR/RONA products and customer discounts");
    const result = parseBmrPdfTokens(textPages);
    await loadingTask.destroy();
    if (!result.rows.length) throw new Error("No supplier products could be read from this PDF.");
    onProgress(1, `${result.rows.length} products ready to review`);
    return result;
  }

  const tesseract = await import("tesseract.js");
  let currentPage = 1;
  const worker = await tesseract.createWorker("eng", tesseract.OEM.LSTM_ONLY, {
    workerPath: "./supplier-import/worker.min.js",
    corePath: "./supplier-import/core",
    langPath: "./supplier-import/lang",
    logger: (message) => {
      if (message.status === "recognizing text") {
        const pageShare = 0.7 / pdf.numPages;
        onProgress(0.25 + (currentPage - 1) * pageShare + message.progress * pageShare, `Scanning Emard page ${currentPage} of ${pdf.numPages}`);
      }
    },
  });
  await worker.setParameters({ tessedit_pageseg_mode: tesseract.PSM.SPARSE_TEXT, preserve_interword_spaces: "1", user_defined_dpi: "216" });
  const rows: SupplierParsedRow[] = [];
  let emardMetadata = { detectedDate: "", validUntil: "", sourceSubtotal: null as number | null };
  try {
    for (currentPage = 1; currentPage <= pdf.numPages; currentPage += 1) {
      if (cancelled.current) throw new Error("Import cancelled.");
      const page = await pdf.getPage(currentPage);
      const viewport = page.getViewport({ scale: 3 });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) throw new Error("This browser cannot prepare scanned PDF pages.");
      await page.render({ canvasContext: context, viewport, canvas }).promise;
      const output = await worker.recognize(canvas, {
        rotateAuto: true,
        rectangle: { left: 0, top: Math.round(canvas.height * 0.23), width: canvas.width, height: Math.round(canvas.height * 0.58) },
      }, { text: true, tsv: true });
      if (output.data.tsv) rows.push(...parseEmardOcrTsv(output.data.tsv, currentPage, canvas.width));
      if (currentPage === 1) {
        const header = await worker.recognize(canvas, { rectangle: { left: 0, top: 0, width: canvas.width, height: Math.round(canvas.height * 0.24) } }, { text: true });
        emardMetadata = { ...emardMetadata, ...readEmardDocumentMetadata(header.data.text || "") };
      }
      if (currentPage === pdf.numPages) {
        const footer = await worker.recognize(canvas, { rectangle: { left: 0, top: Math.round(canvas.height * 0.70), width: canvas.width, height: Math.round(canvas.height * 0.30) } }, { text: true });
        const footerMetadata = readEmardDocumentMetadata(footer.data.text || "");
        emardMetadata = {
          detectedDate: emardMetadata.detectedDate || footerMetadata.detectedDate,
          validUntil: emardMetadata.validUntil || footerMetadata.validUntil,
          sourceSubtotal: footerMetadata.sourceSubtotal ?? emardMetadata.sourceSubtotal,
        };
        if (!emardMetadata.validUntil && emardMetadata.detectedDate && /14\s*(?:CALENDAR\s*)?DAYS?/i.test(footer.data.text || "")) {
          emardMetadata.validUntil = addDays(emardMetadata.detectedDate, 14);
        }
      }
      page.cleanup();
      canvas.width = 0;
      canvas.height = 0;
    }
  } finally {
    await worker.terminate();
    await loadingTask.destroy();
  }
  const result = finishEmardOcr(rows, emardMetadata);
  if (!result.rows.length) throw new Error("The scanned products could not be read. Try a clearer Emard PDF.");
  onProgress(1, `${result.rows.length} scanned products ready to review`);
  return result;
}

function compareRows(parsed: SupplierParseResult, existing: SupplierCatalogItemRecord[]) {
  const existingBySku = new Map(existing.map((item) => [normalizeSupplierSku(item.supplierSku), item]));
  const existingByName = new Map(existing.map((item) => [normalizeMaterialName(item.productName), item]));
  return parsed.rows.map((row): ReviewRow => {
    const current = parsed.parser === "material-xlsx"
      ? existingByName.get(normalizeMaterialName(row.productName))
      : existingBySku.get(normalizeSupplierSku(row.sku));
    const needsReview = row.warnings.length > 0;
    const changed = current && (parsed.parser === "material-xlsx"
      ? Math.abs(current.netCost - row.netCost) > 0.001 || !current.active
      : Math.abs(current.netCost - row.netCost) > 0.001 || current.rawUnit !== row.rawUnit || current.rawDescription !== row.description);
    const status: ReviewStatus = needsReview ? "review" : !current ? "new" : changed ? "changed" : "unchanged";
    return {
      ...row,
      productName: current?.productName ?? row.productName,
      division: current?.division ?? row.division,
      unit: current?.unit ?? row.unit,
      status,
      oldCost: current?.netCost ?? null,
      selected: status === "new" || status === "changed",
    };
  });
}

export function SupplierPriceImportModal({ vendors, divisions, onClose, onApplied }: {
  vendors: Vendor[];
  divisions: string[];
  onClose: () => void;
  onApplied: (supplier: Vendor) => void;
}) {
  const [phase, setPhase] = useState<ImportPhase>("choose");
  const [file, setFile] = useState<File | null>(null);
  const [supplierName, setSupplierName] = useState("");
  const [supplierPickerOpen, setSupplierPickerOpen] = useState(false);
  const [fileHash, setFileHash] = useState("");
  const [parsed, setParsed] = useState<SupplierParseResult | null>(null);
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [effectiveDate, setEffectiveDate] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [progress, setProgress] = useState(0);
  const [progressMessage, setProgressMessage] = useState("");
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<ReviewStatus | "all">("all");
  const [warningsConfirmed, setWarningsConfirmed] = useState(false);
  const [appliedMessage, setAppliedMessage] = useState("");
  const supplierOptions = vendors
    .filter((vendor) => (vendor.category ?? (vendor.trade === "Material Supplier" ? "Supplier" : "Subcontractor")) !== "Subcontractor")
    .filter((vendor) => vendor.name.toLocaleLowerCase().includes(supplierName.trim().toLocaleLowerCase()))
    .slice(0, 30);
  const cancelled = useRef(false);

  const counts = useMemo(() => rows.reduce((result, row) => ({ ...result, [row.status]: result[row.status] + 1 }), { new: 0, changed: 0, unchanged: 0, review: 0 } as Record<ReviewStatus, number>), [rows]);
  const selectedCount = rows.filter((row) => row.selected).length;
  const hasDateWarning = Boolean(effectiveDate && (effectiveDate < new Date(new Date().setFullYear(new Date().getFullYear() - 1)).toISOString().slice(0, 10) || (validUntil && validUntil < new Date().toISOString().slice(0, 10))));
  const hasImportWarnings = Boolean(parsed?.warnings.length || counts.review || hasDateWarning);
  const visibleRows = rows.filter((row) => {
    const matchesStatus = statusFilter === "all" || row.status === statusFilter;
    const normalized = search.toLocaleLowerCase();
    return matchesStatus && `${row.productName} ${row.description} ${row.sku} ${row.division}`.toLocaleLowerCase().includes(normalized);
  });

  const updateRow = (sku: string, patch: Partial<ReviewRow>) => setRows((current) => current.map((row) => row.sku === sku ? { ...row, ...patch } : row));

  const startReading = async () => {
    if (!file) return setError("Choose a supplier PDF or completed Excel price sheet first.");
    if (file.size > 15_000_000) return setError("This file is larger than the 15 MB import limit.");
    setError("");
    setPhase("reading");
    cancelled.current = false;
    try {
      const isWorkbook = file.name.toLocaleLowerCase().endsWith(".xlsx");
      const [hash, result] = await Promise.all([
        sha256(file),
        isWorkbook
          ? file.arrayBuffer().then((buffer) => {
              setProgress(0.7);
              setProgressMessage("Matching material names to their prices");
              return parseMaterialPriceWorkbook(new Uint8Array(buffer)).result;
            })
          : readSupplierPdf(file, (value, message) => { setProgress(value); setProgressMessage(message); }, cancelled),
      ]);
      const chosenName = supplierName.trim() || result.supplierName;
      const chosen = selectedSupplier(chosenName, vendors);
      const response = await fetch(`/api/supplier-catalog?mode=supplier&supplierId=${encodeURIComponent(chosen.id)}&limit=5000`, { cache: "no-store" });
      if (!response.ok) throw new Error("Existing supplier prices could not be loaded for comparison.");
      const existing = await response.json() as SupplierCatalogSearchResponse;
      setSupplierName(chosen.name);
      setFileHash(hash);
      setParsed(result);
      setEffectiveDate(result.detectedDate || new Date().toISOString().slice(0, 10));
      setValidUntil(result.validUntil);
      setRows(compareRows(result, existing.items));
      setPhase("review");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The supplier price file could not be read.");
      setPhase("choose");
    }
  };

  const applyImport = async () => {
    if (!file || !parsed || !supplierName.trim() || !effectiveDate || !selectedCount) return;
    if (hasImportWarnings && !warningsConfirmed) return setError("Confirm that you reviewed the stale date or flagged rows before applying this import.");
    setError("");
    setPhase("applying");
    try {
      const chosen = selectedSupplier(supplierName, vendors);
      const metadata: SupplierImportApplyMetadata = {
        supplierId: chosen.id,
        supplierName: chosen.name,
        filename: file.name,
        fileHash,
        detectedDate: parsed.detectedDate,
        effectiveDate,
        validUntil,
        parserType: parsed.parser,
        sourceSubtotal: parsed.sourceSubtotal,
        extractedSubtotal: parsed.extractedSubtotal,
        reviewCount: counts.review,
        rows: rows.filter((row) => row.selected).map((row) => ({ sku: row.sku, productName: row.productName.trim(), description: row.description.trim(), rawUnit: row.rawUnit, unit: row.unit, division: row.division, listPrice: row.listPrice, netCost: row.netCost })),
      };
      const body = new FormData();
      body.set("file", file);
      body.set("metadata", JSON.stringify(metadata));
      const response = await fetch("/api/supplier-catalog", { method: "POST", body });
      const result = await response.json() as { error?: string; newCount?: number; changedCount?: number; unchangedCount?: number };
      if (!response.ok) throw new Error(result.error || "The supplier update could not be applied.");
      const vendor = chosen.existing ?? { id: chosen.id, name: chosen.name, trade: "Material Supplier", category: "Supplier" as const, portalRecordId: null, portalActive: null, portalLastSyncedAt: "", contact: "", email: "", phone: "", status: "Active" as const, notes: "Supplier Price Book import source." };
      onApplied(vendor);
      setAppliedMessage(`${result.newCount ?? 0} new and ${result.changedCount ?? 0} updated supplier prices were added. Existing quotes stayed unchanged.`);
      setPhase("complete");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The supplier update could not be applied.");
      setPhase("review");
    }
  };

  return (
    <div className="modal-layer supplier-import-layer" role="presentation">
      <section className="modal-card supplier-import-modal" role="dialog" aria-modal="true" aria-labelledby="supplier-import-title">
        <header><div><span className="eyebrow">SUPPLIER PRICE BOOK</span><h2 id="supplier-import-title">Import supplier price list</h2></div><button aria-label="Close" disabled={phase === "reading" || phase === "applying"} onClick={onClose}>×</button></header>

        {phase === "choose" && <div className="supplier-import-content">
          <div className="import-explainer"><strong>Upload a supplier PDF or the completed JGC Excel price sheet.</strong><span>Excel prices are matched to the material name beside them—not the row number—so rows can be sorted, inserted or removed safely. Old quotes never change.</span></div>
          <div className="form-grid two-column">
            <label className="field full"><span>Supplier name</span><div className="saved-data-picker" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setSupplierPickerOpen(false); }}><input role="combobox" aria-label="Supplier name" aria-expanded={supplierPickerOpen} aria-autocomplete="list" autoComplete="off" value={supplierName} onFocus={() => setSupplierPickerOpen(true)} onChange={(event) => { setSupplierName(event.target.value); setSupplierPickerOpen(true); }} placeholder="Search saved suppliers or type a new name" />{supplierPickerOpen && <div className="saved-data-results" role="listbox">{supplierOptions.map((vendor) => <button key={vendor.id} type="button" role="option" aria-selected={supplierName === vendor.name} onMouseDown={(event) => event.preventDefault()} onClick={() => { setSupplierName(vendor.name); setSupplierPickerOpen(false); }}><strong>{vendor.name}</strong>{vendor.trade && <small>{vendor.trade}</small>}</button>)}{!supplierOptions.length && <div className="saved-data-empty">No saved supplier matches. Keep typing to use a new supplier name.</div>}</div>}</div></label>
            <label className="supplier-file-field full"><input type="file" accept="application/pdf,.pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,.xlsx" onChange={(event) => setFile(event.target.files?.[0] ?? null)} /><span className="supplier-file-icon">{file?.name.toLocaleLowerCase().endsWith(".xlsx") ? "XLSX" : "PDF"}</span><strong>{file?.name ?? "Choose supplier PDF or completed JGC Excel sheet"}</strong><small>{file ? `${(file.size / 1_000_000).toFixed(1)} MB` : "Excel matches Material Name to Price; BMR/RONA and scanned Emard PDFs are also supported"}</small></label>
          </div>
          <div className="supported-imports"><div><b>JGC Excel sheet</b><span>Finds the Material Name and Price headings wherever they are and matches every price by name.</span></div><div><b>BMR / RONA PDF</b><span>Reads product number, net JGC cost and discounts automatically.</span></div><div><b>Emard PDF</b><span>Scans each image page with OCR and flags anything uncertain.</span></div></div>
          {error && <div className="import-error">{error}</div>}
          <footer><button className="button secondary" onClick={onClose}>Cancel</button><button className="button primary" disabled={!file} onClick={startReading}>Read price list</button></footer>
        </div>}

        {phase === "reading" && <div className="supplier-progress"><div className="progress-ring">{Math.round(progress * 100)}%</div><h3>{progressMessage || "Preparing supplier price list"}</h3><p>{file?.name.toLocaleLowerCase().endsWith(".xlsx") ? "Reading material names and their corresponding prices. Row positions are ignored." : "Scanned Emard lists can take several minutes. Keep this page open while each page is checked."}</p><div className="progress-track"><span style={{ width: `${Math.max(3, progress * 100)}%` }} /></div><button className="button secondary" onClick={() => { cancelled.current = true; setProgressMessage("Stopping after this page…"); }}>Cancel import</button></div>}

        {phase === "review" && parsed && <div className="supplier-review">
          <div className="supplier-import-settings form-grid">
            <label className="field"><span>Supplier</span><input value={supplierName} onChange={(event) => setSupplierName(event.target.value)} /></label>
            <label className="field"><span>Effective date</span><input type="date" value={effectiveDate} onChange={(event) => setEffectiveDate(event.target.value)} /></label>
            <label className="field"><span>Valid until</span><input type="date" value={validUntil} onChange={(event) => setValidUntil(event.target.value)} /></label>
            {parsed.parser === "material-xlsx"
              ? <div className="reconciliation-card good"><span>Excel name matches</span><strong>{parsed.rows.length}</strong><small>priced materials found by heading and name</small></div>
              : <div className={`reconciliation-card ${parsed.sourceSubtotal !== null && Math.abs(parsed.sourceSubtotal - parsed.extractedSubtotal) <= 0.05 ? "good" : "warning"}`}><span>PDF reconciliation</span><strong>{money(parsed.extractedSubtotal)}</strong><small>Printed subtotal {money(parsed.sourceSubtotal)}</small></div>}
          </div>
          {(hasDateWarning || parsed.warnings.length > 0) && <div className="import-warning"><strong>Review required before applying</strong><span>{hasDateWarning ? `The detected pricing date or expiry is old (${effectiveDate}${validUntil ? ` to ${validUntil}` : ""}). ` : ""}{parsed.warnings.join(" ")}</span></div>}
          <div className="import-counts"><button className={statusFilter === "new" ? "active" : ""} onClick={() => setStatusFilter("new")}><span>New</span><strong>{counts.new}</strong></button><button className={statusFilter === "changed" ? "active" : ""} onClick={() => setStatusFilter("changed")}><span>Price changed</span><strong>{counts.changed}</strong></button><button className={statusFilter === "unchanged" ? "active" : ""} onClick={() => setStatusFilter("unchanged")}><span>Unchanged</span><strong>{counts.unchanged}</strong></button><button className={statusFilter === "review" ? "active" : ""} onClick={() => setStatusFilter("review")}><span>Needs review</span><strong>{counts.review}</strong></button></div>
          <div className="supplier-review-toolbar"><div className="search-field"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search cleaned name, supplier wording or SKU" /></div><button className="button secondary compact" onClick={() => setStatusFilter("all")}>Show all</button><span>{selectedCount} selected</span></div>
          <div className="supplier-review-table-wrap"><table className="supplier-review-table"><thead><tr><th>Use</th><th>Status</th><th>Clean product name</th><th>{parsed.parser === "material-xlsx" ? "Matched by" : "Supplier reference"}</th><th>Unit</th><th>Cost</th><th>Division</th></tr></thead><tbody>{visibleRows.map((row) => <tr key={row.sku} className={row.status === "review" ? "needs-review" : ""}><td data-label="Use"><input type="checkbox" checked={row.selected} onChange={(event) => updateRow(row.sku, { selected: event.target.checked })} /></td><td data-label="Status"><span className={`import-status ${row.status}`}>{row.status === "changed" ? "Changed" : row.status === "review" ? "Review" : row.status.charAt(0).toUpperCase() + row.status.slice(1)}</span>{row.oldCost !== null && row.status === "changed" && <small>{money(row.oldCost)} → {money(row.netCost)}</small>}</td><td data-label="Product"><input value={row.productName} onChange={(event) => updateRow(row.sku, { productName: event.target.value })} /><small>Original: {row.description}</small>{row.warnings.map((warning) => <em key={warning}>{warning}</em>)}</td><td data-label="Reference">{parsed.parser === "material-xlsx" ? <><strong>Material name</strong><small>Spreadsheet row {row.page} is informational only</small></> : <><strong>{row.sku}</strong><small>{supplierName || parsed.supplierName}</small></>}</td><td data-label="Unit"><input value={row.unit} onChange={(event) => updateRow(row.sku, { unit: event.target.value })} /><small>Supplier: {row.rawUnit}</small></td><td data-label="Cost"><div className="input-prefix"><span>$</span><input type="number" min="0" step="0.001" value={row.netCost} onChange={(event) => updateRow(row.sku, { netCost: Number(event.target.value) })} /></div></td><td data-label="Division"><select value={row.division} onChange={(event) => updateRow(row.sku, { division: event.target.value })}>{divisions.map((division) => <option key={division}>{division}</option>)}</select></td></tr>)}</tbody></table></div>
          <div className="update-policy"><strong>{parsed.parser === "material-xlsx" ? "Matched by material name—not row number" : "Update listed items only"}</strong><span>{parsed.parser === "material-xlsx" ? "Rows may be inserted, deleted or sorted. The app reads each material name and the price beside it. Materials missing from the spreadsheet remain unchanged." : "Products missing from this PDF will remain in the Price Book. Nothing is automatically deleted."}</span></div>
          {hasImportWarnings && <div className="warning-confirm"><input id="confirm-supplier-warnings" type="checkbox" checked={warningsConfirmed} onChange={(event) => setWarningsConfirmed(event.target.checked)} /><label htmlFor="confirm-supplier-warnings"><strong>I reviewed the date and flagged rows.</strong><small>Only the checked products above will be applied.</small></label></div>}
          {error && <div className="import-error">{error}</div>}
          <footer><button className="button secondary" onClick={() => setPhase("choose")}>Back</button><button className="button primary" disabled={!selectedCount || !supplierName.trim() || !effectiveDate || (hasImportWarnings && !warningsConfirmed)} onClick={applyImport}>Apply {selectedCount} prices</button></footer>
        </div>}

        {phase === "applying" && <div className="supplier-progress"><div className="progress-ring saving">✓</div><h3>Saving supplier prices</h3><p>The import history and approved product costs are being saved to the shared estimator.</p></div>}
        {phase === "complete" && <div className="supplier-complete"><div>✓</div><h3>Supplier Price Book updated</h3><p>{appliedMessage}</p><button className="button primary" onClick={onClose}>Done</button></div>}
      </section>
    </div>
  );
}

export function SupplierCatalogSection({ search, divisions, refreshKey, onImport }: { search: string; divisions: string[]; refreshKey: number; onImport: () => void }) {
  const [data, setData] = useState<SupplierCatalogSearchResponse>({ items: [], total: 0, imports: [] });
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<SupplierCatalogItemRecord | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualSaving, setManualSaving] = useState(false);
  const [manualDraft, setManualDraft] = useState({
    productName: "",
    supplierName: "",
    division: divisions[0] ?? "",
    unit: "Each",
    netCost: 0,
    effectiveDate: new Date().toISOString().slice(0, 10),
  });
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLoading(true);
      fetch(`/api/supplier-catalog?q=${encodeURIComponent(search)}&limit=200`, { cache: "no-store", signal: controller.signal })
        .then(async (response) => {
          if (!response.ok) throw new Error("Supplier catalogue unavailable.");
          return response.json() as Promise<SupplierCatalogSearchResponse>;
        })
        .then((result) => { setData(result); setError(""); setLoading(false); })
        .catch((caught) => { if (caught instanceof DOMException && caught.name === "AbortError") return; setError("Supplier catalogue could not be loaded."); setLoading(false); });
    }, 180);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [search, refreshKey]);

  const editItem = (item: SupplierCatalogItemRecord) => { setExpandedId(item.id); setDraft({ ...item }); };
  const saveItem = async () => {
    if (!draft) return;
    const response = await fetch("/api/supplier-catalog", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: draft.id, productName: draft.productName, division: draft.division, unit: draft.unit, netCost: draft.netCost, effectiveDate: draft.effectiveDate, active: draft.active }) });
    const result = await response.json() as { error?: string };
    if (!response.ok) return setError(result.error || "Supplier item could not be saved.");
    setData((current) => ({ ...current, items: current.items.map((item) => item.id === draft.id ? draft : item) }));
    setExpandedId(null);
    setDraft(null);
  };

  const saveManualMaterial = async () => {
    if (!manualDraft.productName.trim()) return setError("Enter the material name before saving.");
    if (!manualDraft.unit.trim()) return setError("Enter how this material is priced, such as Each, Sheet or Ln.Ft.");
    setManualSaving(true);
    const response = await fetch("/api/supplier-catalog", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(manualDraft),
    });
    const result = await response.json() as { item?: SupplierCatalogItemRecord; error?: string };
    setManualSaving(false);
    if (!response.ok || !result.item) return setError(result.error || "Manual material could not be saved.");
    setData((current) => ({ ...current, items: [result.item!, ...current.items], total: current.total + 1 }));
    setManualDraft({ productName: "", supplierName: "", division: divisions[0] ?? "", unit: "Each", netCost: 0, effectiveDate: new Date().toISOString().slice(0, 10) });
    setManualOpen(false);
    setError("");
  };

  return <section className="supplier-catalog-block">
    <div className="supplier-catalog-heading"><div><span className="eyebrow">MATERIAL PRICE BOOK</span><h2>Material pricing</h2><p>Add one material directly or import a completed supplier spreadsheet. Both use the same searchable material catalogue.</p></div><div className="supplier-catalog-heading-actions"><button className="button secondary" onClick={() => { setManualOpen((current) => !current); setError(""); }}>＋ Add material manually</button><button className="button primary" onClick={onImport}>⇧ Import or update prices</button></div></div>
    {manualOpen && <section className="panel manual-material-card" aria-label="Add material manually">
      <div className="panel-heading"><div><span className="eyebrow">NEW MATERIAL</span><h3>Add a material directly</h3><p>This material will be available in estimate search as soon as it is saved.</p></div><button className="icon-button" aria-label="Close manual material form" onClick={() => setManualOpen(false)}>×</button></div>
      <div className="manual-material-grid">
        <label className="field"><span>Material name</span><input autoFocus value={manualDraft.productName} placeholder="Example: 2x4x8 SPF" onChange={(event) => setManualDraft({ ...manualDraft, productName: event.target.value })} /></label>
        <label className="field"><span>Supplier / source <small>Optional</small></span><input value={manualDraft.supplierName} placeholder="Leave blank if not needed" onChange={(event) => setManualDraft({ ...manualDraft, supplierName: event.target.value })} /></label>
        <label className="field"><span>Division</span><select value={manualDraft.division} onChange={(event) => setManualDraft({ ...manualDraft, division: event.target.value })}>{divisions.map((division) => <option key={division}>{division}</option>)}</select></label>
        <label className="field"><span>Unit</span><input list="manual-material-units" value={manualDraft.unit} placeholder="Each, Sheet, Ln.Ft., m³…" onChange={(event) => setManualDraft({ ...manualDraft, unit: event.target.value })} /><datalist id="manual-material-units"><option value="Each" /><option value="Piece" /><option value="Sheet" /><option value="Ln.Ft." /><option value="Sq.Ft." /><option value="m" /><option value="m²" /><option value="m³" /><option value="kg" /><option value="L" /></datalist></label>
        <label className="field"><span>Cost</span><div className="input-prefix"><span>$</span><input type="number" min="0" step="0.001" value={manualDraft.netCost} onChange={(event) => setManualDraft({ ...manualDraft, netCost: Number(event.target.value) })} /></div></label>
        <label className="field"><span>Price date</span><input type="date" value={manualDraft.effectiveDate} onChange={(event) => setManualDraft({ ...manualDraft, effectiveDate: event.target.value })} /></label>
      </div>
      <footer className="manual-material-actions"><button className="button secondary" onClick={() => setManualOpen(false)}>Cancel</button><button className="button primary" disabled={manualSaving || !manualDraft.productName.trim() || !manualDraft.unit.trim()} onClick={() => void saveManualMaterial()}>{manualSaving ? "Saving…" : "Save material"}</button></footer>
    </section>}
    <div className="supplier-catalog-summary"><div><span>Products</span><strong>{data.total}</strong></div><div><span>Suppliers</span><strong>{new Set(data.items.map((item) => item.supplierId)).size}</strong></div><div><span>Price-list updates</span><strong>{data.imports.length}</strong></div></div>
    {error && <div className="import-error">{error}</div>}
    <div className="panel table-panel"><div className="data-table-wrap"><table className="data-table supplier-catalog-table"><thead><tr><th>Product</th><th>Supplier</th><th>Division</th><th>Unit</th><th>Cost</th><th>Price date</th><th>Status</th><th /></tr></thead><tbody>{data.items.map((item) => <Fragment key={item.id}><tr className={!item.active ? "inactive-row" : ""}><td data-label="Product"><strong>{item.productName}</strong></td><td data-label="Supplier"><strong>{item.supplierName}</strong></td><td data-label="Division">{item.division}</td><td data-label="Unit">{item.unit}</td><td data-label="Cost"><strong>{money(item.netCost)}</strong></td><td data-label="Price date">{item.effectiveDate || "—"}<small>{item.validUntil ? `Valid until ${item.validUntil}` : "No expiry recorded"}</small></td><td data-label="Status"><span className={`supplier-validity ${item.validUntil && item.validUntil < new Date().toISOString().slice(0, 10) ? "expired" : "current"}`}>{item.active ? item.validUntil && item.validUntil < new Date().toISOString().slice(0, 10) ? "Expired source" : "Active" : "Inactive"}</span></td><td className="mobile-card-actions"><button className="row-caret" aria-label={`Edit ${item.productName}`} onClick={() => expandedId === item.id ? setExpandedId(null) : editItem(item)}>✎</button></td></tr>{expandedId === item.id && draft?.id === item.id && <tr className="supplier-edit-row"><td colSpan={8}><div className="supplier-edit-grid"><label className="field"><span>Clean product name</span><input value={draft.productName} onChange={(event) => setDraft({ ...draft, productName: event.target.value })} /></label><label className="field"><span>Division</span><select value={draft.division} onChange={(event) => setDraft({ ...draft, division: event.target.value })}>{divisions.map((division) => <option key={division}>{division}</option>)}</select></label><label className="field"><span>Unit</span><input value={draft.unit} onChange={(event) => setDraft({ ...draft, unit: event.target.value })} /></label><label className="field"><span>Cost</span><div className="input-prefix"><span>$</span><input type="number" min="0" step="0.001" value={draft.netCost} onChange={(event) => setDraft({ ...draft, netCost: Number(event.target.value) })} /></div></label><label className="field"><span>Price date</span><input type="date" value={draft.effectiveDate} onChange={(event) => setDraft({ ...draft, effectiveDate: event.target.value })} /></label><div className="supplier-source-note"><span>Supplier reference (used only for future updates)</span><strong>{item.supplierName} · {item.supplierSku}</strong><small>{item.rawDescription}</small></div><div className="check-field"><input id={`supplier-active-${item.id}`} type="checkbox" checked={draft.active} onChange={(event) => setDraft({ ...draft, active: event.target.checked })} /><label htmlFor={`supplier-active-${item.id}`}><strong>Active in estimates</strong><small>Inactive products keep their history.</small></label></div><div className="supplier-edit-actions"><button className="button secondary" onClick={() => { setExpandedId(null); setDraft(null); }}>Cancel</button><button className="button primary" onClick={saveItem}>Save changes</button></div></div></td></tr>}</Fragment>)}</tbody></table></div>{loading && <div className="supplier-loading">Loading supplier prices…</div>}{!loading && !data.items.length && <div className="empty-state compact-empty"><span>⇧</span><h3>No supplier prices yet</h3><p>Import a completed JGC Excel price sheet, BMR/RONA PDF or Emard PDF to build the supplier material catalogue.</p><button className="button primary" onClick={onImport}>Import price list</button></div>}</div>
    {!!data.imports.length && <div className="import-history"><div><span className="eyebrow">UPDATE HISTORY</span><h3>Supplier price-list imports</h3></div><div className="import-history-list">{data.imports.slice(0, 6).map((item) => <article key={item.id}><div><strong>{item.supplierName}</strong><span>{item.filename}</span></div><div><b>{item.effectiveDate}</b><span>{item.newCount} new · {item.changedCount} changed · {item.unchangedCount} unchanged</span></div></article>)}</div></div>}
  </section>;
}
