import { waybackDownloadUrl } from "./wayback";

export type DownloadProgress = {
  loaded: number;
  total: number;
};

function triggerDownload(url: string): void {
  const frame = document.createElement("iframe");
  frame.hidden = true;
  frame.src = url;
  document.body.appendChild(frame);
  window.setTimeout(() => frame.remove(), 120_000);
}

export function startDownload(sourceUrl: string, _filename: string): void {
  triggerDownload(waybackDownloadUrl(sourceUrl));
}

export function formatDownloadProgress(_progress: DownloadProgress): string {
  return "Download started. Open your browser downloads (Chrome: ⌘+Shift+J). Large X360 files can take a while to appear.";
}
