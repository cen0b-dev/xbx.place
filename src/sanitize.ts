const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim() ?? "";

const PROFILE_IMAGE_PATH =
  /^\/storage\/v1\/object\/public\/(gamerpics|profile-banners)\/[0-9a-f-]{36}\/(avatar|banner)\.webp$/i;

export function stripControlChars(value: string): string {
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
}

export function stripHtml(value: string): string {
  return stripControlChars(value.replace(/<[^>]*>/g, ""));
}

export function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function sanitizeGamertag(value: string): string {
  const cleaned = collapseWhitespace(stripHtml(value).replace(/[^\w -]/g, ""));
  if (!cleaned) return "New Player";
  return cleaned.slice(0, 32);
}

export function sanitizeBio(value: string | null | undefined): string | null {
  if (!value) return null;
  const cleaned = collapseWhitespace(stripHtml(value));
  if (!cleaned) return null;
  return cleaned.slice(0, 180);
}

export function sanitizeCollectionName(value: string): string {
  return collapseWhitespace(stripHtml(value).replace(/[^\w .,'!?&+()-]/g, "")).slice(0, 64);
}

export function sanitizeCollectionDescription(value: string | null | undefined): string | null {
  if (!value) return null;
  const cleaned = collapseWhitespace(stripHtml(value));
  if (!cleaned) return null;
  return cleaned.slice(0, 280);
}

export function sanitizeReportDetails(value: string | null | undefined): string | null {
  if (!value) return null;
  const cleaned = collapseWhitespace(stripHtml(value));
  if (!cleaned) return null;
  return cleaned.slice(0, 500);
}

export function sanitizeCommentBody(value: string | null | undefined): string | null {
  if (!value) return null;
  const cleaned = collapseWhitespace(stripHtml(value));
  if (!cleaned) return null;
  return cleaned.slice(0, 500);
}

export function supabaseOrigin(): string | null {
  if (!SUPABASE_URL) return null;
  try {
    return new URL(SUPABASE_URL).origin;
  } catch {
    return null;
  }
}

export function isUploadedProfileImageUrl(url: string | null | undefined, userId?: string): boolean {
  const raw = url?.trim();
  if (!raw) return false;

  const origin = supabaseOrigin();
  if (!origin) return false;

  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "https:") return false;
    if (parsed.origin !== origin) return false;
    if (!PROFILE_IMAGE_PATH.test(parsed.pathname)) return false;
    if (userId) {
      const pathUserId = parsed.pathname.split("/")[6];
      if (!pathUserId || pathUserId.toLowerCase() !== userId.toLowerCase()) return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function sanitizeProfileImageUrl(
  url: string | null | undefined,
  userId: string,
  kind: "gamerpic" | "banner"
): string | null {
  if (!isUploadedProfileImageUrl(url, userId)) return null;
  const raw = url!.trim();
  try {
    const parsed = new URL(raw);
    const bucket = kind === "gamerpic" ? "gamerpics" : "profile-banners";
    const file = kind === "gamerpic" ? "avatar.webp" : "banner.webp";
    const expected = `/storage/v1/object/public/${bucket}/${userId}/${file}`;
    if (!parsed.pathname.toLowerCase().endsWith(expected.toLowerCase())) return null;
    return `${parsed.origin}${parsed.pathname}${parsed.search}`;
  } catch {
    return null;
  }
}

export function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/'/g, "&#39;");
}
