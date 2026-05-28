const MINERVA_ORIGIN = "https://minerva-archive.org";

export function minervaRomPath(filename: string): string {
  return `./Redump/Microsoft - Xbox 360/${filename}`;
}

export function minervaRomUrl(filename: string): string {
  return `${MINERVA_ORIGIN}/rom/?name=${encodeURIComponent(minervaRomPath(filename))}`;
}
