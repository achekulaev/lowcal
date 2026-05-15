#!/usr/bin/env python3
"""Apply a rounded-rectangle alpha mask to a square app icon (transparent corners)."""

from __future__ import annotations

import argparse
import sys

from PIL import Image, ImageChops, ImageDraw


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("input", help="Source PNG")
    parser.add_argument("output", help="Output PNG (RGBA)")
    parser.add_argument(
        "--radius-ratio",
        type=float,
        default=0.22,
        help="Corner radius as a fraction of min(width, height); ~0.22 matches common app-icon rounding",
    )
    args = parser.parse_args()

    img = Image.open(args.input).convert("RGBA")
    w, h = img.size
    radius = int(min(w, h) * args.radius_ratio)
    if radius < 1:
        print("radius too small", file=sys.stderr)
        sys.exit(1)

    mask = Image.new("L", (w, h), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, w, h), radius=radius, fill=255)

    r, g, b, a = img.split()
    new_a = ImageChops.multiply(a, mask)
    out = Image.merge("RGBA", (r, g, b, new_a))
    out.save(args.output, "PNG")


if __name__ == "__main__":
    main()
