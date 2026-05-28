import { formatUpdateVersion } from "./update-version";

export type DownloadDisplay = {
  title: string;
  meta: string | null;
};

const EXT_RE = /\.(zip|iso|7z)$/i;
const BRACKET_RE = /\[.*?\]/gi;
const REGION_RE = /\((USA|Europe(?:[^)]*)?|Japan|World|Australia(?:[^)]*)?|Region Free)\)/i;
const LANG_RE = /\(([A-Za-z]{2}(?:,[A-Za-z]{2})+)\)/;
const UPDATE_VERSION_RE = /\(v\d+(?:\.\d+)?(?:\s+\d+)?[a-z]?\)/gi;
const UPDATE_ALT_RE = /\((Alt(?:\s+\d+)?|UK)\)/gi;

function normalizeRegion(raw: string): string {
  const value = raw.trim();
  if (/^usa$/i.test(value)) return "USA";
  if (/^japan$/i.test(value)) return "Japan";
  if (/^world$/i.test(value)) return "World";
  if (/^region free$/i.test(value)) return "Region Free";
  if (/^europe/i.test(value)) return "Europe";
  if (/^australia/i.test(value)) return "Australia";
  return value;
}

function parseRegion(filename: string): string | null {
  const match = filename.match(REGION_RE);
  if (!match?.[1]) return null;
  return normalizeRegion(match[1]);
}

function parseLanguages(filename: string): string | null {
  for (const match of filename.matchAll(/\(([^)]+)\)/g)) {
    const chunk = match[1];
    if (!chunk) continue;
    const value = chunk.replace(/\s+/g, "");
    if (/^[A-Za-z]{2}(?:,[A-Za-z]{2})+$/.test(value)) {
      return chunk
        .split(",")
        .map((code) => code.trim())
        .join(", ");
    }
  }
  return null;
}

export function formatDownloadDisplay(raw: string): DownloadDisplay {
  const region = parseRegion(raw);
  const languages = parseLanguages(raw);
  const updateVersion = formatUpdateVersion(raw);
  const title = raw
    .replace(EXT_RE, "")
    .replace(BRACKET_RE, "")
    .replace(REGION_RE, "")
    .replace(LANG_RE, "")
    .replace(UPDATE_VERSION_RE, "")
    .replace(UPDATE_ALT_RE, "")
    .replace(/\(Addon\)|\(DLC\)|\(Update\)/gi, "")
    .replace(/\s+/g, " ")
    .trim();

  const metaParts: string[] = [];
  if (updateVersion) metaParts.push(updateVersion);
  if (region) metaParts.push(region);
  if (languages) metaParts.push(languages);

  return {
    title,
    meta: metaParts.length ? metaParts.join(" · ") : null
  };
}
