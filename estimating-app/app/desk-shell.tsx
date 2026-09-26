import React, { createContext, useContext, useEffect } from "react";
import type { ViewKey } from "../lib/estimator-data";

// The Portal's page tiles (common.js JGC_PAGE_BAR_ICONS and JGC_PAGE_TILE_TONES), so each Estimate Desk
// section wears the same kind of coloured tile as the Portal pages. Where a section matches a Portal page
// it takes that page's colour: Overview green like Summary, Vendors indigo like Subs/Suppliers, Jobs teal
// like Job Lookup, Settings slate like Admin Tools. Neighbours in the sidebar and tab bar never share a
// look-alike colour (teal/cyan, violet/indigo), so Clients is violet.
const ICONS = {
  dashboard: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
  quote: '<path d="M6 3h9l4 4v14H6z"/><path d="M15 3v4h4"/><path d="M14 10.5h-2.8a1.6 1.6 0 0 0 0 3.2h1.6a1.6 1.6 0 0 1 0 3.2H10M12.4 9v1.5M12.4 16.9v1.5"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.5-3.5 3.3-5.5 6.5-5.5s6 2 6.5 5.5M16 4.5a3.5 3.5 0 0 1 0 7M18 14.5c2 .6 3.3 2.5 3.5 5.5"/>',
  book: '<path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H20v15H6.5A1.5 1.5 0 0 0 5 19.5z"/><path d="M5 19.5A1.5 1.5 0 0 0 6.5 21H20M9 7h7"/>',
  building: '<path d="M4 21V5l8-2v18M12 21h8V9l-8-2M2 21h20"/><path d="M8 8h.01M8 12h.01M8 16h.01M16 12h.01M16 16h.01"/>',
  hardhat: '<path d="M10 10V5.5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1V10"/><path d="M14 6.5a6 6 0 0 1 6 6V15M4 15v-2.5a6 6 0 0 1 6-6"/><rect x="2.5" y="15" width="19" height="4" rx="1"/>',
  sliders: '<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
};

const TILES: Record<ViewKey, { icon: keyof typeof ICONS; tone: string }> = {
  dashboard: { icon: "dashboard", tone: "green" },
  quotes: { icon: "quote", tone: "blue" },
  clients: { icon: "users", tone: "violet" },
  pricebook: { icon: "book", tone: "gold" },
  vendors: { icon: "building", tone: "indigo" },
  jobs: { icon: "hardhat", tone: "teal" },
  settings: { icon: "sliders", tone: "slate" },
};

export function DeskTile({ view, className = "" }: { view: ViewKey; className?: string }) {
  const tile = TILES[view];
  return (
    <span className={`desk-tile ${className}`.trim()} data-tone={tile.tone} aria-hidden="true">
      <svg viewBox="0 0 24 24" focusable="false" dangerouslySetInnerHTML={{ __html: ICONS[tile.icon] }} />
    </span>
  );
}

// Pages name themselves in the header row: each page (PageHeading, the Overview) reports its title and
// description, and the header shows them beside the section tile.
export type DeskHeader = { title: string; description?: string };
export const DeskHeaderContext = createContext<(header: DeskHeader | null) => void>(() => {});

export function useDeskHeader(title: string, description?: string) {
  const setHeader = useContext(DeskHeaderContext);
  useEffect(() => {
    setHeader({ title, description });
    return () => setHeader(null);
  }, [setHeader, title, description]);
}
