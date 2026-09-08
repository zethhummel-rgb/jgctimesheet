/** JGC job numbers encode their year in the first two digits, e.g. 26128 = 2026. */
export function jobNumberYear(jobNumber: string): number | null {
  const match = /^(\d{2})\d/.exec(jobNumber.trim());
  return match ? 2000 + Number(match[1]) : null;
}
