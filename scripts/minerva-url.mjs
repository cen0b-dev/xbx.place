/** MiNERVA Archive rom page for a Redump-style Xbox 360 filename. */
export function minervaRomUrl(filename) {
  const rel = `./Redump/Microsoft - Xbox 360/${filename}`;
  return `https://minerva-archive.org/rom/?name=${encodeURIComponent(rel)}`;
}
