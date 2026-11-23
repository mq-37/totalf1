#!/usr/bin/env python3
"""
Freeware-style bitmap → dotted SVG (no Inkscape required).

Reads a line-art PNG, thresholds it, samples a pixel grid, and emits one
circle (or square) per dark cell. Useful as a structural scaffold that
aligns to the composition viewBox (default 272×160).

Usage:
  python scripts/png_to_dot_svg.py INPUT.png OUTPUT.svg
  python scripts/png_to_dot_svg.py INPUT.png OUTPUT.svg --cols 272 --rows 160 --dot-scale 0.85
"""
from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image, ImageOps


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Convert line-art PNG to dotted SVG scaffold")
    p.add_argument("input", type=Path)
    p.add_argument("output", type=Path)
    p.add_argument("--cols", type=int, default=272, help="Sample grid width (viewBox width)")
    p.add_argument("--rows", type=int, default=160, help="Sample grid height (viewBox height)")
    p.add_argument("--threshold", type=int, default=200, help="0–255; darker than this → ink")
    p.add_argument("--dot-scale", type=float, default=0.82, help="Dot diameter as fraction of cell")
    p.add_argument("--shape", choices=("circle", "square"), default="circle")
    p.add_argument(
        "--mask-centre-text",
        action="store_true",
        help="Clear a centre band (logo/URL) so it is not traced",
    )
    p.add_argument("--fill", default="#111111")
    p.add_argument("--no-autocrop", action="store_true",
                   help="Do not trim white margins before sampling")
    p.add_argument("--pad", type=int, default=6, help="Padding around ink bbox when autocropping")
    return p.parse_args()


def main() -> None:
    args = parse_args()
    im = Image.open(args.input).convert("L")
    im = ImageOps.autocontrast(im)
    if not args.no_autocrop:
        ink = im.point(lambda p: 255 if p < args.threshold else 0)
        bbox = ink.getbbox()
        if bbox:
            x0, y0, x1, y1 = bbox
            pad = args.pad
            x0, y0 = max(0, x0 - pad), max(0, y0 - pad)
            x1, y1 = min(im.width, x1 + pad), min(im.height, y1 + pad)
            im = im.crop((x0, y0, x1, y1))
    # Fit into sample grid (nearest keeps line crisp)
    sample = im.resize((args.cols, args.rows), Image.Resampling.NEAREST)
    pixels = sample.load()

    if args.mask_centre_text:
        # Rough nose-logo band in front-view car art (fraction of frame)
        x0, x1 = int(args.cols * 0.38), int(args.cols * 0.62)
        y0, y1 = int(args.rows * 0.42), int(args.rows * 0.62)
        for y in range(y0, y1):
            for x in range(x0, x1):
                pixels[x, y] = 255

    r = args.dot_scale * 0.5  # radius in cell units
    side = args.dot_scale
    parts: list[str] = [
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {args.cols} {args.rows}" '
        f'width="100%" height="100%" preserveAspectRatio="none">',
        f"  <!-- dotted scaffold from {args.input.name}; threshold={args.threshold} -->",
        f'  <rect width="100%" height="100%" fill="#ffffff"/>',
        f'  <g id="dots" fill="{args.fill}">',
    ]

    count = 0
    for y in range(args.rows):
        for x in range(args.cols):
            if pixels[x, y] < args.threshold:
                cx, cy = x + 0.5, y + 0.5
                if args.shape == "circle":
                    parts.append(f'    <circle cx="{cx:.2f}" cy="{cy:.2f}" r="{r:.3f}"/>')
                else:
                    parts.append(
                        f'    <rect x="{x + (1 - side) / 2:.3f}" y="{y + (1 - side) / 2:.3f}" '
                        f'width="{side:.3f}" height="{side:.3f}"/>'
                    )
                count += 1

    parts.append("  </g>")
    parts.append("</svg>")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text("\n".join(parts) + "\n", encoding="utf-8")
    print(f"Wrote {args.output} ({count} dots, {args.cols}×{args.rows})")


if __name__ == "__main__":
    main()
