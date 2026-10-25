"""Ikon Tempest: perisai (melindungi) berisi gelembung komentar dengan tanda bahaya merah.
Digambar sebagai pixel art 16x16 lalu diperbesar nearest-neighbour agar tetap tajam di semua ukuran."""
import sys
from pathlib import Path

from PIL import Image

OUT = Path(sys.argv[1] if len(sys.argv) > 1 else "static/assets")

PALETTE = {
    ".": (0, 0, 0, 0),
    "K": (7, 8, 13, 255),       # garis luar
    "B": (63, 169, 245, 255),   # biru Rimuru
    "D": (28, 93, 143, 255),    # biru gelap
    "C": (92, 225, 230, 255),   # cyan highlight
    "W": (232, 236, 245, 255),  # gelembung komentar
    "R": (224, 40, 58, 255),    # merah Diablo
    "S": (16, 19, 28, 255),     # isi perisai
}

ICON = [
    "..KKKKKKKKKKKK..",
    ".KCCBBBBBBBBBBK.",
    ".KCDSSSSSSSSDBK.",
    ".KBSWWWWWWWWSBK.",
    ".KBSWKKKKWRWSBK.",
    ".KBSWWWWWWRWSBK.",
    ".KBSWKKKWWWWSBK.",
    ".KBSWWWWWWRWSBK.",
    ".KBSSWWSSSSSSBK.",
    ".KBDSWSSSSSSDBK.",
    "..KBDSSSSSSDBK..",
    "..KBBDSSSSDBBK..",
    "...KBBDSSDBBK...",
    "....KKBDDBKK....",
    "......KBBK......",
    ".......KK.......",
]


def render() -> Image.Image:
    img = Image.new("RGBA", (16, 16))
    for y, row in enumerate(ICON):
        assert len(row) == 16, (y, row)
        for x, ch in enumerate(row):
            img.putpixel((x, y), PALETTE[ch])
    return img


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    base = render()
    for size in (16, 32, 48, 128):
        base.resize((size, size), Image.NEAREST).save(OUT / f"icon-{size}.png")
    print(f"icons written to {OUT}")


if __name__ == "__main__":
    main()
