"""Turn the Raphael illustration into a small pixel-art portrait (nearest-neighbour scaled in CSS)."""
import sys
from pathlib import Path

from PIL import Image

src = Path(sys.argv[1])
out = Path(sys.argv[2] if len(sys.argv) > 2 else "static/assets/raphael-pixel.png")
width = int(sys.argv[3]) if len(sys.argv) > 3 else 72

im = Image.open(src).convert("RGB")
w, h = im.size
left, right = int(w * 0.08), int(w * 0.84)
top = int(h * 0.07)
crop = im.crop((left, top, right, top + int((right - left) * 1.15)))
small = crop.resize((width, round(width * 1.15)), Image.LANCZOS)
pixel = small.quantize(colors=32, method=Image.Quantize.MAXCOVERAGE, dither=Image.Dither.NONE).convert("RGB")
pixel.save(out, optimize=True)
print(f"{out} {pixel.size}")
