import type { AppState, Quote } from "./estimator-data";

function regularQuote(quote: Quote) {
  return quote.documentKind !== "Change Notice";
}

function numberKey(number: string) {
  return number.trim().toUpperCase();
}

function findAvailableNumber(stem: string, start: number, used: Set<string>) {
  let sequence = Number.isSafeInteger(start) && start > 0 ? start : 1;
  let number = stem + String(sequence).padStart(4, "0");
  while (used.has(numberKey(number))) {
    sequence += 1;
    number = stem + String(sequence).padStart(4, "0");
  }
  return { number, next: sequence + 1 };
}

export function nextAvailableQuoteNumber(state: AppState, date: string) {
  const used = new Set(state.quotes.filter(regularQuote).map(quote => numberKey(quote.number)));
  const stem = state.settings.quotePrefix + "-" + date.slice(0, 4) + "-";
  return findAvailableNumber(stem, state.settings.nextQuoteNumber, used);
}

// Published numbers belong to their saved records. Only new, unissued drafts can move.
export function resolveNewDraftQuoteNumbers(saved: AppState, incoming: AppState): AppState {
  const savedIds = new Set(saved.quotes.map(quote => quote.id));
  const newDrafts = incoming.quotes.filter(quote => regularQuote(quote) && !savedIds.has(quote.id)
    && quote.status === "Draft" && !quote.sentAt && !quote.revisions.length);
  const draftIds = new Set(newDrafts.map(quote => quote.id));
  const used = new Set(incoming.quotes.filter(quote => regularQuote(quote) && !draftIds.has(quote.id))
    .map(quote => numberKey(quote.number)));
  const assigned = new Map<string, { previous: string; number: string }>();
  let next = Math.max(saved.settings.nextQuoteNumber, incoming.settings.nextQuoteNumber);

  for (const quote of newDrafts) {
    const key = numberKey(quote.number);
    if (!used.has(key)) {
      used.add(key);
      continue;
    }

    const stem = /^(.*-\d{4}-)\d+$/.exec(quote.number.trim())?.[1];
    if (!stem) continue;
    const replacement = findAvailableNumber(stem, next, used);
    used.add(numberKey(replacement.number));
    next = replacement.next;
    assigned.set(quote.id, { previous: quote.number, number: replacement.number });
  }

  if (!assigned.size) return incoming;
  return {
    ...incoming,
    settings: { ...incoming.settings, nextQuoteNumber: next },
    quotes: incoming.quotes.map(quote => {
      const assignment = assigned.get(quote.id);
      return assignment ? { ...quote, number: assignment.number } : quote;
    }),
    activity: incoming.activity.map(item => {
      const assignment = item.quoteId ? assigned.get(item.quoteId) : undefined;
      if (!assignment || !["Quote created", "Quote duplicated"].includes(item.title)) return item;
      return { ...item, detail: item.detail.replace(assignment.previous, assignment.number) };
    }),
  };
}
