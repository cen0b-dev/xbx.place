export type DownloadEntry = {
  filename: string;
  url: string;
  type?: string;
  label?: string;
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
