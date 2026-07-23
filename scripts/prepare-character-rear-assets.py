from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image


CANVAS_SIZE = 512
CONTENT_SIZE = 480
BASELINE_MARGIN = 8


def alpha_bbox(image: Image.Image) -> tuple[int, int, int, int]:
    alpha = image.getchannel("A")
    bbox = alpha.point(lambda value: 255 if value > 8 else 0).getbbox()
    if bbox is None:
        raise ValueError("A rear character asset is completely transparent")
    return bbox


def clear_transparent_rgb(image: Image.Image) -> Image.Image:
    output = image.copy()
    pixels = output.load()
    for y in range(output.height):
        for x in range(output.width):
            red, green, blue, alpha = pixels[x, y]
            if alpha <= 3:
                pixels[x, y] = (0, 0, 0, 0)
    return output


def parse_asset(value: str) -> tuple[str, Path]:
    name, separator, path = value.partition("=")
    if not separator or not name or not path:
        raise argparse.ArgumentTypeError("assets must use name=path")
    return name, Path(path)


def main() -> None:
    parser = argparse.ArgumentParser(description="Normalize rear-facing character assets")
    parser.add_argument("--asset", action="append", required=True, type=parse_asset)
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()

    cropped_assets: list[tuple[str, Image.Image]] = []
    for name, path in args.asset:
        source = Image.open(path).convert("RGBA")
        cropped_assets.append((name, source.crop(alpha_bbox(source))))

    max_width = max(image.width for _, image in cropped_assets)
    max_height = max(image.height for _, image in cropped_assets)
    shared_scale = min(CONTENT_SIZE / max_width, CONTENT_SIZE / max_height)
    args.output_dir.mkdir(parents=True, exist_ok=True)

    for name, image in cropped_assets:
        resized = image.resize(
            (
                max(1, round(image.width * shared_scale)),
                max(1, round(image.height * shared_scale)),
            ),
            Image.Resampling.LANCZOS,
        )
        canvas = Image.new("RGBA", (CANVAS_SIZE, CANVAS_SIZE), (0, 0, 0, 0))
        x = round((CANVAS_SIZE - resized.width) / 2)
        y = CANVAS_SIZE - BASELINE_MARGIN - resized.height
        canvas.alpha_composite(resized, (x, y))
        clear_transparent_rgb(canvas).save(args.output_dir / f"{name}-rear.png", optimize=True)


if __name__ == "__main__":
    main()
