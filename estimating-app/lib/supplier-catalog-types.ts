export interface SupplierCatalogItemRecord {
  id: string;
  supplierId: string;
  supplierName: string;
  supplierSku: string;
  productName: string;
  rawDescription: string;
  rawUnit: string;
  unit: string;
  division: string;
  listPrice: number | null;
  netCost: number;
  effectiveDate: string;
  validUntil: string;
  active: boolean;
  latestImportId: string;
  lastSeenAt: string;
}

export interface SupplierImportHistoryRecord {
  id: string;
  supplierId: string;
  supplierName: string;
  filename: string;
  detectedDate: string;
  effectiveDate: string;
  validUntil: string;
  parserType: string;
  rowCount: number;
  newCount: number;
  changedCount: number;
  unchangedCount: number;
  reviewCount: number;
  createdAt: string;
}

export interface SupplierImportApplyRow {
  sku: string;
  productName: string;
  description: string;
  rawUnit: string;
  unit: string;
  division: string;
  listPrice: number | null;
  netCost: number;
}

export interface SupplierImportApplyMetadata {
  supplierId: string;
  supplierName: string;
  filename: string;
  fileHash: string;
  detectedDate: string;
  effectiveDate: string;
  validUntil: string;
  parserType: string;
  sourceSubtotal: number | null;
  extractedSubtotal: number;
  reviewCount: number;
  rows: SupplierImportApplyRow[];
}

export interface SupplierCatalogSearchResponse {
  items: SupplierCatalogItemRecord[];
  total: number;
  imports: SupplierImportHistoryRecord[];
}
