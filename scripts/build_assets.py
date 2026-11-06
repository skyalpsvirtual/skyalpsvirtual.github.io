"""Build web-optimised images for the SkyAlps Virtual site from the source files in Images/.

Usage:  python scripts/build_assets.py
Re-run whenever a source image changes. Source files are never modified.
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "Images"
OUT = ROOT / "site" / "assets" / "img"
OUT.mkdir(parents=True, exist_ok=True)


def save_jpg(img: Image.Image, name: str, width: int, quality: int = 80) -> None:
    ratio = width / img.width
    resized = img.resize((width, round(img.height * ratio)), Image.LANCZOS)
    resized.convert("RGB").save(OUT / name, "JPEG", quality=quality, optimize=True, progressive=True)


def crop_to_alpha(img: Image.Image, pad: int = 0) -> Image.Image:
    bbox = img.getchannel("A").getbbox()
    left, top, right, bottom = bbox
    return img.crop((max(left - pad, 0), max(top - pad, 0), min(right + pad, img.width), min(bottom + pad, img.height)))


# 1. Hero photo (Dash 8 over the Dolomites) in two widths for srcset.
banner = Image.open(SRC / "banner homepage 2888 x 1200 px.png").convert("RGB")
save_jpg(banner, "hero-2400.jpg", 2400, quality=78)
save_jpg(banner, "hero-1200.jpg", 1200, quality=78)

# 2. Close crop on the aircraft for the fleet card.
plane = banner.crop((820, 60, 2020, 660))  # 1200 x 600 around the Dash 8
save_jpg(plane, "fleet-q400.jpg", 1200, quality=82)

def glyph_components(img: Image.Image) -> list[tuple[int, int, int, int, list]]:
    """Connected groups of visible pixels: (x0, y0, x1, y1, pixels)."""
    alpha = img.getchannel("A").load()
    w, h = img.size
    seen = bytearray(w * h)
    found = []
    for y in range(h):
        for x in range(w):
            if alpha[x, y] == 0 or seen[y * w + x]:
                continue
            seen[y * w + x] = 1
            stack, pixels = [(x, y)], []
            while stack:
                cx, cy = stack.pop()
                pixels.append((cx, cy))
                for nx, ny in ((cx + 1, cy), (cx - 1, cy), (cx, cy + 1), (cx, cy - 1)):
                    if 0 <= nx < w and 0 <= ny < h and alpha[nx, ny] and not seen[ny * w + nx]:
                        seen[ny * w + nx] = 1
                        stack.append((nx, ny))
            xs, ys = [p[0] for p in pixels], [p[1] for p in pixels]
            found.append((min(xs), min(ys), max(xs), max(ys), pixels))
    return found


# 3. White "skyalps virtual" lockup, trimmed to its visible pixels, with the word "virtual"
#    in the mint of the Ban.png banner so the VA logo reads differently from the airline's.
MINT = (128, 255, 217)
lockup = crop_to_alpha(Image.open(SRC / "Ban-white.png").convert("RGBA"), pad=4)
lockup.thumbnail((900, 900), Image.LANCZOS)
pix = lockup.load()
# "virtual" = the small glyphs under "skyalps": they start in the lower 30 % and left of the round emblem.
groups = glyph_components(lockup)
alpha = lockup.getchannel("A")
letters = [c for c in groups
           if c[1] > lockup.height * 0.62 and c[2] < lockup.width * 0.69
           and max(alpha.getpixel(p) for p in c[4]) >= 128]  # skip faint resampling specks
assert 1 <= len(letters) <= 9, f"unexpected 'virtual' glyph count: {len(letters)}"
box = (min(c[0] for c in letters) - 3, min(c[1] for c in letters) - 3,
       max(c[2] for c in letters) + 3, max(c[3] for c in letters) + 3)
# Also take the faint anti-aliasing specks inside that box, so no white fringe is left.
virtual = [c for c in groups if c[0] >= box[0] and c[1] >= box[1] and c[2] <= box[2] and c[3] <= box[3]]
for *_, pixels in virtual:
    for x, y in pixels:
        pix[x, y] = (*MINT, pix[x, y][3])
lockup.save(OUT / "logo-virtual-white.png", optimize=True)

# 4. Favicons from the green emblem square.
emblem = Image.open(SRC / "Design sans titre(12).png").convert("RGBA")
emblem.resize((180, 180), Image.LANCZOS).save(OUT / "apple-touch-icon.png", optimize=True)
emblem.resize((64, 64), Image.LANCZOS).save(OUT / "favicon-64.png", optimize=True)
emblem.resize((32, 32), Image.LANCZOS).save(OUT / "favicon-32.png", optimize=True)

# 5. Open Graph / Discord preview card, 1200 x 630.
og_w, og_h = 1200, 630
scale = og_h / banner.height
bg = banner.resize((round(banner.width * scale), og_h), Image.LANCZOS)
left = (bg.width - og_w) // 2
og = bg.crop((left, 0, left + og_w, og_h)).convert("RGBA")
shade = Image.new("RGBA", (og_w, og_h), (0, 0, 0, 0))
draw = ImageDraw.Draw(shade)
for y in range(og_h):  # darken the lower half so the logo reads
    alpha = int(max(0, (y - og_h * 0.35) / (og_h * 0.65)) * 200)
    draw.line([(0, y), (og_w, y)], fill=(4, 20, 14, alpha))
og = Image.alpha_composite(og, shade)
logo = lockup.copy()
logo.thumbnail((620, 620), Image.LANCZOS)
glow = Image.new("RGBA", og.size, (0, 0, 0, 0))
glow.paste((0, 0, 0, 140), ((og_w - logo.width) // 2, og_h - logo.height - 70), logo)
glow = glow.filter(ImageFilter.GaussianBlur(14))
og = Image.alpha_composite(og, glow)
og.paste(logo, ((og_w - logo.width) // 2, og_h - logo.height - 70), logo)
og.convert("RGB").save(OUT / "og-image.jpg", "JPEG", quality=85, optimize=True, progressive=True)

for f in sorted(OUT.iterdir()):
    print(f"{f.name:28} {f.stat().st_size // 1024:>5} KB")
