// Display/search aliases only. Never use these names to rewrite account IDs,
// imported job assignments, quote ownership or historical records.
const jobManagerAliases = [
  { label: "Zeth Hummel", initials: "ZH" },
  { label: "Jeff Vandrish", initials: "JV" },
] as const;

export function jobManagerIdentity(value: string | undefined | null) {
  const name = (value ?? "").trim();
  const normalized = name.replace(/\s+/g, " ").toLocaleLowerCase();
  const alias = jobManagerAliases.find(({ label, initials }) =>
    normalized === label.toLocaleLowerCase() || normalized === initials.toLocaleLowerCase());
  const label = alias?.label ?? name;
  return {
    key: label.toLocaleLowerCase(),
    label,
    searchText: alias ? `${alias.label} ${alias.initials}`.toLocaleLowerCase() : normalized,
  };
}
