// Strip administrative labels, keeping actual areas and villages distinct.
export function locationKey(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-IN")
    .replace(/^(district|dist\.?|taluka|tal\.?)[\s.:-]+/u, "")
    .replace(/(?:,\s*|\s+)gujarat$/u, "")
    .replace(/\s+district$/u, "")
    .replace(/^(lodhika|kotda sangani)\s*\(rajkot\)$/u, "$1").trim();
}

export const isDistrictOnly = (name: string) =>
  /^(district|dist\.?)[\s.:-]+/iu.test(name.trim()) || /\s+district$/iu.test(name.trim());

export const formatLocationName = (name: string) => {
  const key = locationKey(name);
  const base = key.replace(/(^|[\s,(])(\p{L})/gu, (_, space: string, letter: string) => space + letter.toLocaleUpperCase("en-IN"));
  return /^(lodhika|kotda sangani)$/u.test(key) && /\(rajkot\)\s*$/iu.test(name) ? `${base} (Rajkot)` : base;
};

export const siteCityKey = (name: string) => `${isDistrictOnly(name) ? "district:" : "city:"}${locationKey(name)}`;
export const formatSiteCityName = (name: string) => `${isDistrictOnly(name) ? "Dist. " : ""}${formatLocationName(name)}`;

export function siteCityOptions(values: Array<string | null | undefined>): string[] {
  const names = new Map<string, string>();
  for (const value of values) {
    if (!value?.trim()) continue;
    const key = siteCityKey(value);
    const label = formatSiteCityName(value);
    if (!names.has(key) || /\(Rajkot\)$/.test(label)) names.set(key, label);
  }
  return [...names.values()].sort((a,b) => a.localeCompare(b));
}

export const companyNameKey = (name: string) => name.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-IN");

export function companyCityMap(sites: Array<{ name: string; company_name?: string | null; city: string | null }>): Map<string, string | null> {
  const result = new Map<string, string | null>();
  for (const site of sites) {
    if (!site.city) continue;
    const city = formatSiteCityName(site.city);
    for (const name of [site.name, site.company_name]) {
      if (!name) continue;
      const key = companyNameKey(name);
      if (!result.has(key)) result.set(key, city);
      else if (result.get(key) !== null && siteCityKey(result.get(key)!) !== siteCityKey(city)) result.set(key, null);
    }
  }
  return result;
}
