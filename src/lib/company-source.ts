export type CompanySource = "npc" | "lead";

export const COMPANY_SOURCES = [
  { value: "npc", label: "NPC", description: "Companies assigned through the National Productivity Council portal." },
  { value: "lead", label: "Lead", description: "Companies found by your sales team." },
] as const;

// Older records and cached responses belong to the existing NPC workflow.
export function companySource(site: { company_source?: string | null }): CompanySource {
  return site.company_source === "lead" ? "lead" : "npc";
}

export function filterCompanySource<T extends { company_source?: string | null }>(
  sites: readonly T[],
  source: CompanySource,
): T[] {
  return sites.filter((site) => companySource(site) === source);
}
