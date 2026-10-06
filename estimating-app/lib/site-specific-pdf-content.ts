import type { SafetyBlock, SafetyPage, SiteSpecificPlan } from './site-specific';
import { structuredSafetyPages } from './site-specific-structure';

const filled = (value: string) => Boolean(value.trim());

// A default contact role or map legend label is a prompt, not a completed row.
// Reusable procedure/responsibility text is real plan content and stays in the PDF.
const tablePrompts = new Map<string, Set<string>>();
for (const page of structuredSafetyPages()) {
  for (const block of page.blocks || []) {
    if (block.type !== 'table') continue;
    const prompts = new Set<string>();
    for (const row of block.rows) {
      const values = block.columns.filter(column => filled(row.cells[column.id] || ''));
      if (values.length === 1) {
        const column = values[0];
        prompts.add(JSON.stringify([column.id, row.cells[column.id].trim()]));
      }
    }
    if (prompts.size) tablePrompts.set(block.id, prompts);
  }
}

function pdfBlock(block: SafetyBlock): SafetyBlock | undefined {
  if (block.type === 'table') {
    const rows = block.rows.filter(row => {
      const values = block.columns.filter(column => filled(row.cells[column.id] || ''));
      if (!values.length) return false;
      if (values.length !== 1) return true;
      const column = values[0];
      return !tablePrompts.get(block.id)?.has(JSON.stringify([column.id, row.cells[column.id].trim()]));
    });
    if (!rows.length) return;
    const columns = block.columns.filter(column => rows.some(row => filled(row.cells[column.id] || '')));
    return { ...block, columns, rows };
  }
  if (block.type === 'steps') {
    const rows = block.rows.filter(row => filled(row.body));
    return rows.length ? { ...block, rows } : undefined;
  }
  if (block.type === 'questions') {
    const rows = block.rows.filter(row => filled(row.value) || filled(row.notes));
    return rows.length ? { ...block, rows } : undefined;
  }
  const rows = block.rows.filter(row => filled(row.value) || filled(row.notes));
  return rows.length ? { ...block, rows } : undefined;
}

// Build an output-only view. Blank fields and inclusion choices remain saved
// exactly as entered so the next editor session can fill them in.
export function siteSpecificPdfPages(plan: SiteSpecificPlan): SafetyPage[] {
  return plan.pages.filter(page => page.included).map(page => ({
    ...page,
    fields: page.fields.filter(field => filled(field.value)),
    blocks: (page.blocks || []).map(pdfBlock).filter((block): block is SafetyBlock => Boolean(block)),
    illustrations: (page.illustrations || []).filter(item => item.included),
  })).filter(page => page.fields.length || page.blocks.length || page.illustrations.length ||
    (page.id === 'emergency' && plan.hospitalMap?.included));
}
