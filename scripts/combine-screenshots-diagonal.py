#!/usr/bin/env python3
"""Combine `screenshot-light.png` and `screenshot-dark.png` along the top-left → bottom-right diagonal.

Above the diagonal (top-right triangle) shows the light screenshot; below the diagonal
(bottom-left triangle) shows the dark screenshot. The two source images must be the
same size. Output is written as `screenshot-combined.png` next to the inputs.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from PIL import Image, ImageDraw


def build_diagonal_mask(size: tuple[int, int]) -> Image.Image:
    """White above (and on) the top-left → bottom-right diagonal, black below."""
    w, h = size
    mask = Image.new("L", (w, h), 0)
    ImageDraw.Draw(mask).polygon([(0, 0), (w, 0), (w, h)], fill=255)
    return mask


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--source-dir",
        type=Path,
        default=Path(__file__).resolve().parent.parent / "source_images",
        help="Directory containing screenshot-light.png and screenshot-dark.png",
    )
    parser.add_argument(
        "--light",
        default="screenshot-light.png",
        help="Light screenshot filename within --source-dir",
    )
    parser.add_argument(
        "--dark",
        default="screenshot-dark.png",
        help="Dark screenshot filename within --source-dir",
    )
    parser.add_argument(
        "--output",
        default="screenshot-combined.png",
        help="Output filename written into --source-dir",
    )
    args = parser.parse_args()

    src = args.source_dir
    light_path = src / args.light
    dark_path = src / args.dark
    out_path = src / args.output

    for p in (light_path, dark_path):
        if not p.is_file():
            print(f"missing input: {p}", file=sys.stderr)
            sys.exit(1)

    light = Image.open(light_path).convert("RGBA")
    dark = Image.open(dark_path).convert("RGBA")

    if light.size != dark.size:
        print(
            f"size mismatch: light={light.size} dark={dark.size}; both screenshots must match",
            file=sys.stderr,
        )
        sys.exit(1)

    mask = build_diagonal_mask(light.size)
    combined = Image.composite(light, dark, mask)
    combined.save(out_path, "PNG")
    print(f"wrote {out_path}")


if __name__ == "__main__":
    main()
