import type { TitleEntry } from "./types";

const MARQUEE_TITLE_PATTERNS = [
  "Halo 3",
  "Mass Effect 2",
  "Dark Souls",
  "Grand Theft Auto V",
  "Gears of War 3",
  "Red Dead Redemption",
  "Forza Horizon 2"
];

function resolveMarqueeTitles(catalog: TitleEntry[]): TitleEntry[] {
  const used = new Set<string>();
  const results: TitleEntry[] = [];
  for (const pattern of MARQUEE_TITLE_PATTERNS) {
    const match = catalog.find(
      (entry) =>
        !used.has(entry.title_id) &&
        entry.name.toLowerCase().includes(pattern.toLowerCase()) &&
        !/demo|beta/i.test(entry.name)
    );
    if (match) {
      results.push(match);
      used.add(match.title_id);
    }
  }
  return results;
}

export function pickHeroVisualTitles(
  catalog: TitleEntry[],
  fallback: TitleEntry[]
): { covers: TitleEntry[]; backgrounds: TitleEntry[] } {
  const marquee = resolveMarqueeTitles(catalog);
  const covers = marquee.slice(0, 3);
  const backgrounds = marquee.slice(3, 7);
  const used = new Set([...covers, ...backgrounds].map((entry) => entry.title_id));

  for (const entry of fallback) {
    if (covers.length >= 3 && backgrounds.length >= 4) break;
    if (used.has(entry.title_id)) continue;
    if (covers.length < 3) covers.push(entry);
    else backgrounds.push(entry);
    used.add(entry.title_id);
  }

  return { covers, backgrounds };
}
