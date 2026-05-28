export type DownloadStartResult = { ok: true } | { ok: false; error: string };

export function startDownload(sourceUrl: string, _filename: string): DownloadStartResult {
  const url = sourceUrl.trim();
  if (!url) {
    return { ok: false, error: "No download URL for this file." };
  }

  const opened = window.open(url, "_blank", "noopener,noreferrer");
  if (!opened) {
    return {
      ok: false,
      error: "Pop-up blocked. Allow pop-ups for this site and try again."
    };
  }
  return { ok: true };
}

export function formatDownloadNotice(): string {
  return "Download started.";
}
