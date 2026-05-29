import { minervaMagnetTrackers } from "./minerva-constants";
import { minervaRomPath, minervaRomUrl } from "./minerva-download";

const MINERVA_ORIGIN = "https://minerva-archive.org";
const HASHES_DB = `${MINERVA_ORIGIN}/assets/hashes.db`;

type MinervaFileRow = {
  torrents?: string;
  magnet?: string;
  so_id?: string | number;
};

type SqlWorker = {
  db: {
    query: (sql: string, params?: unknown[]) => Promise<MinervaFileRow[]>;
  };
};

let workerPromise: Promise<SqlWorker | null> | null = null;
const rowCache = new Map<string, MinervaFileRow | null>();

async function loadSqlWorker(): Promise<SqlWorker | null> {
  try {
    const mod = await import(
      /* @vite-ignore */
      "https://esm.sh/sql.js-httpvfs@0.8.12"
    );
    const createDbWorker = mod.createDbWorker ?? mod.default?.createDbWorker;
    if (typeof createDbWorker !== "function") return null;

    const workerUrl = `${MINERVA_ORIGIN}/js/sqlite.worker.js`;
    const wasmUrl = `${MINERVA_ORIGIN}/js/sql-wasm.wasm`;
    return (await createDbWorker(
      [
        {
          from: "inline",
          config: {
            serverMode: "full",
            url: HASHES_DB,
            requestChunkSize: 4096
          }
        }
      ],
      workerUrl,
      wasmUrl
    )) as SqlWorker;
  } catch {
    return null;
  }
}

async function getWorker(): Promise<SqlWorker | null> {
  if (!workerPromise) workerPromise = loadSqlWorker();
  return workerPromise;
}

async function lookupMinervaFile(filename: string): Promise<MinervaFileRow | null> {
  const path = minervaRomPath(filename);
  if (rowCache.has(path)) return rowCache.get(path) ?? null;

  const worker = await getWorker();
  if (!worker) {
    rowCache.set(path, null);
    return null;
  }

  try {
    const rows = await worker.db.query(
      "SELECT torrents, magnet, so_id FROM files WHERE full_path = ?",
      [path]
    );
    const row = rows[0] ?? null;
    rowCache.set(path, row);
    return row;
  } catch {
    rowCache.set(path, null);
    return null;
  }
}

function minervaTorrentAssetUrl(torrents: string): string {
  const rel = torrents.replace(/^\//, "");
  return `${MINERVA_ORIGIN}/assets/${rel}`;
}

async function buildPerFileMagnet(row: MinervaFileRow): Promise<string | null> {
  if (typeof row.magnet !== "string" || !row.magnet.startsWith("magnet:")) return null;
  const trackers = await minervaMagnetTrackers();
  const so =
    row.so_id != null && row.so_id !== "" ? `&so=${encodeURIComponent(String(row.so_id))}` : "";
  return `${row.magnet}${trackers}${so}`;
}

function openMagnet(magnet: string): boolean {
  try {
    window.location.assign(magnet);
    return true;
  } catch {
    const opened = window.open(magnet, "_self");
    return Boolean(opened);
  }
}

export type MinervaTorrentResult =
  | { ok: true; mode: "magnet" }
  | { ok: true; mode: "torrent" }
  | { ok: true; mode: "rom-page" }
  | { ok: false; error: string };

/** Per-game fast path: magnet (preferred) → .torrent file → MiNERVA rom page. */
export async function startMinervaTorrentDownload(
  filename: string,
  romPageUrl?: string
): Promise<MinervaTorrentResult> {
  const row = await lookupMinervaFile(filename);

  if (row) {
    const magnet = await buildPerFileMagnet(row);
    if (magnet && openMagnet(magnet)) {
      return { ok: true, mode: "magnet" };
    }

    const torrents = row.torrents;
    if (typeof torrents === "string" && torrents) {
      const url = minervaTorrentAssetUrl(torrents);
      const opened = window.open(url, "_blank", "noopener,noreferrer");
      if (!opened) {
        return { ok: false, error: "Pop-up blocked. Allow pop-ups for this site and try again." };
      }
      return { ok: true, mode: "torrent" };
    }
  }

  const romUrl = romPageUrl?.trim() || minervaRomUrl(filename);
  const opened = window.open(romUrl, "_blank", "noopener,noreferrer");
  if (!opened) {
    return { ok: false, error: "Pop-up blocked. Allow pop-ups for this site and try again." };
  }
  return { ok: true, mode: "rom-page" };
}
