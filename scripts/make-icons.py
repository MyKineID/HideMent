"""Generate the Raphael Guard toolbar icons (black base, Rimuru-blue ring, Diablo-red core)."""
import math
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

OUT = Path(sys.argv[1] if len(sys.argv) > 1 else "static/assets")
S = 512


def render() -> Image.Image:
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((8, 8, S - 8, S - 8), radius=110, fill=(10, 11, 16, 255), outline=(31, 36, 51, 255), width=8)

    glow = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    g = ImageDraw.Draw(glow)
    g.ellipse((96, 96, S - 96, S - 96), outline=(63, 169, 245, 255), width=44)
    glow = glow.filter(ImageFilter.GaussianBlur(22))
    img.alpha_composite(glow)

    d.ellipse((110, 110, S - 110, S - 110), outline=(92, 225, 230, 255), width=26)
    for i in range(8):
        a = math.radians(i * 45 + 22.5)
        r1, r2 = 150, 186
        c = S / 2
        d.line((c + r1 * math.cos(a), c + r1 * math.sin(a), c + r2 * math.cos(a), c + r2 * math.sin(a)), fill=(63, 169, 245, 255), width=14)

    red = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    r = ImageDraw.Draw(red)
    c = S / 2
    diamond = [(c, c - 92), (c + 62, c), (c, c + 92), (c - 62, c)]
    r.polygon(diamond, fill=(255, 59, 59, 255))
    red_glow = red.filter(ImageFilter.GaussianBlur(18))
    img.alpha_composite(red_glow)
    img.alpha_composite(red)
    d.polygon([(c, c - 52), (c + 30, c), (c, c + 52), (c - 30, c)], fill=(193, 18, 31, 255))
    d.ellipse((c - 12, c - 12, c + 12, c + 12), fill=(255, 214, 214, 255))
    return img


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    base = render()
    for size in (16, 32, 48, 128):
        base.resize((size, size), Image.LANCZOS).save(OUT / f"icon-{size}.png")
    print(f"icons written to {OUT}")


if __name__ == "__main__":
    main()
