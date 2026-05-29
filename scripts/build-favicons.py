#!/usr/bin/env python3
"""Generate square favicons from public/logo.png without stretching or a visible box."""

from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / "public"
LOGO = PUBLIC / "logo.png"
# Pixels at or below this value are treated as background (logo uses black).
BG_CUTOFF = 32


def logo_mark(logo: Image.Image) -> Image.Image:
    """Crop to the mark and drop baked-in black so the favicon has no square backdrop."""
    rgba = logo.convert("RGBA")
    px = rgba.load()
    for y in range(rgba.height):
        for x in range(rgba.width):
            r, g, b, _a = px[x, y]
            if r <= BG_CUTOFF and g <= BG_CUTOFF and b <= BG_CUTOFF:
                px[x, y] = (0, 0, 0, 0)

    bbox = rgba.getbbox()
    if not bbox:
        return rgba
    return rgba.crop(bbox)


def fit_on_square(mark: Image.Image, size: int, padding: int) -> Image.Image:
    inner = max(1, size - padding * 2)
    scale = min(inner / mark.width, inner / mark.height)
    w = max(1, round(mark.width * scale))
    h = max(1, round(mark.height * scale))
    resized = mark.resize((w, h), Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    x = (size - w) // 2
    y = (size - h) // 2
    canvas.paste(resized, (x, y), resized)
    return canvas


def main() -> None:
    if not LOGO.is_file():
        raise SystemExit(f"Missing {LOGO}")

    mark = logo_mark(Image.open(LOGO))
    fit_on_square(mark, 32, padding=2).save(PUBLIC / "favicon-32.png", optimize=True)
    fit_on_square(mark, 180, padding=12).save(PUBLIC / "apple-touch-icon.png", optimize=True)
    print(f"Wrote {PUBLIC / 'favicon-32.png'} and {PUBLIC / 'apple-touch-icon.png'}")


if __name__ == "__main__":
    main()
