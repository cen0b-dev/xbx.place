#!/usr/bin/env python3
"""Generate a 1200x630 Open Graph share image for xbx.place."""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / "public"
LOGO = PUBLIC / "logo.png"
OUT = PUBLIC / "og-image.png"

W, H = 1200, 630
GREEN = (16, 124, 16)
BG = (16, 16, 16)
TEXT = (255, 255, 255)
MUTED = (170, 170, 170)


def load_font(size: int, bold: bool = False):
    candidates = (
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf" if bold else "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf"
        if bold
        else "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
    )
    for path in candidates:
        if Path(path).is_file():
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def main() -> None:
    if not LOGO.is_file():
        raise SystemExit(f"Missing {LOGO}")

    canvas = Image.new("RGB", (W, H), BG)
    draw = ImageDraw.Draw(canvas)

    draw.rectangle((0, H - 8, W, H), fill=GREEN)
    draw.ellipse((820, -120, 1180, 240), fill=(16, 124, 16, 40))
    draw.rectangle((0, 0, W, H), outline=(40, 40, 40), width=1)

    logo = Image.open(LOGO).convert("RGBA")
    logo.thumbnail((140, 140), Image.Resampling.LANCZOS)
    canvas.paste(logo, (72, 72), logo)

    title_font = load_font(58, bold=True)
    sub_font = load_font(30)
    tag_font = load_font(24)

    draw.text((240, 88), "xbx.place", font=title_font, fill=TEXT)
    draw.text((240, 168), "Xbox 360 ROMs & ISO Downloads", font=sub_font, fill=MUTED)
    draw.text((240, 228), "1,800+ games · DLC · title updates · Redump-aligned", font=tag_font, fill=GREEN)

    draw.text((72, 360), "Searchable catalog with cover art, ratings,", font=tag_font, fill=MUTED)
    draw.text((72, 398), "and Xenia-compatible ISO / XEX formats.", font=tag_font, fill=MUTED)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(OUT, optimize=True)
    print(f"Wrote {OUT}")


if __name__ == "__main__":
    main()
