import type { PurchaseOrder, Vendor } from "./estimator-data";

// A saved PO address (including an intentional blank) belongs to that revision.
// Older POs can use a uniquely matched company, never a fuzzy contact/name match.
export function purchaseOrderVendorAddress(vendors: Vendor[], po: Pick<PurchaseOrder, "vendorName" | "vendorId" | "vendorAddress">) {
  if (typeof po.vendorAddress === "string") return po.vendorAddress;
  const name = po.vendorName.trim().toLocaleLowerCase();
  if (!name) return "";
  const matches = vendors.filter((vendor) => vendor.name.trim().toLocaleLowerCase() === name);
  const linked = matches.find((vendor) => vendor.id === po.vendorId);
  return (linked ?? (matches.length === 1 ? matches[0] : undefined))?.address?.trim() ?? "";
}
