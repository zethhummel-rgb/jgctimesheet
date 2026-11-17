import type { SafetyAttachment, SiteSpecificPlan } from './site-specific';
import { siteSpecificDocumentOrder } from './site-specific-pdf-content';

// Reapply keys to the latest plan, never a snapshot of its editable content.
// Keep dormant keys so excluding a file does not discard its saved position.
export function applySiteSpecificOrder(plan: SiteSpecificPlan, keys: string[]): SiteSpecificPlan {
  const live = siteSpecificDocumentOrder(plan, plan.pages).map(item => item.key);
  const order = [...new Set([...keys, ...(plan.documentOrder || []), ...live])];
  const rank = new Map(order.map((key, index) => [key, index]));
  return { ...plan, documentOrder: order, pages: [...plan.pages].sort((a, b) => rank.get('page:' + a.id)! - rank.get('page:' + b.id)!) };
}

export function reorderSiteSpecific(plan: SiteSpecificPlan, key: string, target: string, after: boolean): SiteSpecificPlan {
  const live = siteSpecificDocumentOrder(plan, plan.pages).map(item => item.key);
  if (key === target || !live.includes(key) || !live.includes(target)) return plan;
  const order = [...new Set([...(plan.documentOrder || []), ...live])].filter(item => item !== key);
  order.splice(order.indexOf(target) + (after ? 1 : 0), 0, key);
  return applySiteSpecificOrder(plan, order);
}

export const documentCategories = [
  { id: 'certificates', title: 'Certificates', description: 'Worker training and qualifications' },
  { id: 'jsa', title: 'Job safety analyses', description: 'Job and task safety documents' },
  { id: 'policy', title: 'Company policies', description: 'Complete policies and manuals' },
  { id: 'sds', title: 'Safety data sheets', description: 'Product and material information' },
  { id: 'plans', title: 'Project plans & reports', description: 'Site plans, forms and project records' },
  { id: 'other', title: 'Other documents', description: 'Additional supporting files' },
] as const;
export type DocumentCategory = typeof documentCategories[number]['id'];

export const boardDocumentCategories = [
  { id: 'notice-of-project', title: 'Notice of Project' },
  { id: 'site-specific', title: 'Site Specific' },
  { id: 'daily-report', title: 'Daily Reports' },
  { id: 'jsa', title: 'Daily Reports — JSA' },
  { id: 'toolbox-talk', title: 'Daily Reports — Toolbox Talk' },
  { id: 'inspection', title: 'Daily Inspections' },
  { id: 'permit', title: 'Daily Permits' },
  { id: 'sds', title: 'SDS Sheets' },
  { id: 'jgc-policy', title: 'JGC Policy' },
  { id: 'other', title: 'Daily Reports — Other' },
] as const;
export type BoardDocumentCategory = typeof boardDocumentCategories[number]['id'];
export function defaultBoardCategory(item: SafetyAttachment): BoardDocumentCategory {
  const selected = documentCategory(item);
  return selected === 'sds' ? 'sds' : selected === 'jsa' ? 'jsa' : selected === 'policy' ? 'jgc-policy' : 'site-specific';
}

export function documentCategory(item: SafetyAttachment): DocumentCategory {
  // Certificate identity comes from the protected Portal source, not a UI label.
  if (item.kind === 'certificate') return 'certificates';
  if (item.libraryCategory && documentCategories.some(c => c.id === item.libraryCategory)) return item.libraryCategory;
  if (item.category === 'jsa') return 'jsa';
  if (item.category === 'jgc-policy') return 'policy';
  if (item.category === 'sds') return 'sds';
  if (['site-specific', 'inspection', 'daily-report', 'report'].includes(item.category || '')) return 'plans';
  return 'other';
}

export function certificateType(item: SafetyAttachment): string {
  const name = item.title.split(/\s+[—–]\s+/).slice(1).join(' — ').trim();
  const value = name || item.title;
  if (/\bWAH\b|working\s+at\s+heights?/i.test(value)) return 'WAH';
  if (/\bTNPI\b|trans\s*northern/i.test(value)) return 'TNPI';
  return name || 'Other certificates';
}
