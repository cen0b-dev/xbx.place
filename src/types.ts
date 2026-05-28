export type DownloadEntry = {
  filename: string;
  url: string;
  type?: string;
  label?: string;
  sizeBytes?: number;
  /** Where the file is hosted, e.g. archive.org */
  source?: string;
  /** Faster mirror (MiNERVA rom page with torrent + magnet). */
  fastUrl?: string;
  fastSource?: string;
};

export type TitleEntry = {
  title_id: string;
  name: string;
  description?: string;
  developer?: string;
  publisher?: string;
  release_date?: string | null;
  rating?: number | null;
  genre?: string[];
  regions?: string[];
  artwork?: {
    gallery?: string[];
  };
  metadata?: {
    source?: string;
    languageTags?: string[];
  };
  downloads: DownloadEntry[];
};
