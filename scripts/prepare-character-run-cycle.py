from __future__ import annotations

import argparse
from collections import Counter, deque
from pathlib import Path

from PIL import Image


FRAME_SIZE = 256
CONTENT_SIZE = 236
BASELINE_MARGIN = 10


def alpha_bbox(image: Image.Image) -> tuple[int, int, int, int]:
    alpha = image.getchannel("A")
    bbox = alpha.point(lambda value: 255 if value > 8 else 0).getbbox()
    if bbox is None:
        raise ValueError("A sprite frame is completely transparent")
    return bbox


def remove_connected_white_border(image: Image.Image) -> Image.Image:
    """Remove generated sheet gutters without touching white fur inside a frame."""
    output = image.copy()
    pixels = output.load()
    width, height = output.size
    queue: deque[tuple[int, int]] = deque()
    visited: set[tuple[int, int]] = set()

    def is_border_white(x: int, y: int) -> bool:
        red, green, blue, alpha = pixels[x, y]
        return alpha > 0 and min(red, green, blue) >= 242 and max(red, green, blue) <= 255

    for x in range(width):
        queue.extend(((x, 0), (x, height - 1)))
    for y in range(height):
        queue.extend(((0, y), (width - 1, y)))

    while queue:
        x, y = queue.popleft()
        if (x, y) in visited:
            continue
        visited.add((x, y))
        if not is_border_white(x, y):
            continue
        red, green, blue, _ = pixels[x, y]
        pixels[x, y] = (red, green, blue, 0)
        if x > 0:
            queue.append((x - 1, y))
        if x + 1 < width:
            queue.append((x + 1, y))
        if y > 0:
            queue.append((x, y - 1))
        if y + 1 < height:
            queue.append((x, y + 1))

    return output


def remove_chroma(image: Image.Image, tolerance: int) -> Image.Image:
    if tolerance <= 0:
        return image

    source_data = (
        image.get_flattened_data() if hasattr(image, "get_flattened_data") else image.getdata()
    )
    saturated_colors = Counter(
        ((red // 8) * 8, (green // 8) * 8, (blue // 8) * 8)
        for red, green, blue, alpha in source_data
        if alpha > 0 and max(red, green, blue) - min(red, green, blue) > 90
    )
    if not saturated_colors:
        return image
    key_red, key_green, key_blue = saturated_colors.most_common(1)[0][0]
    pixels = []
    feather = max(12, tolerance // 2)
    pixel_data = (
        image.get_flattened_data() if hasattr(image, "get_flattened_data") else image.getdata()
    )
    for red, green, blue, alpha in pixel_data:
        distance = max(abs(red - key_red), abs(green - key_green), abs(blue - key_blue))
        if distance <= tolerance:
            keyed_alpha = 0
        elif distance < tolerance + feather:
            keyed_alpha = round(alpha * (distance - tolerance) / feather)
        else:
            keyed_alpha = alpha
        pixels.append((red, green, blue, keyed_alpha))

    output = Image.new("RGBA", image.size)
    output.putdata(pixels)
    return output


def remove_magenta_fringe(image: Image.Image) -> Image.Image:
    """Drop chroma-key spill without eroding orange fur or blue accents."""
    output = image.copy()
    source = image.load()
    cleaned = output.load()
    width, height = image.size

    for y in range(height):
        for x in range(width):
            red, green, blue, alpha = source[x, y]
            is_strong_chroma = red > 145 and blue > 115 and green < 90
            is_magenta_spill = red - green > 25 and blue - green > 25
            if not is_magenta_spill or alpha == 0:
                continue
            if is_strong_chroma:
                cleaned[x, y] = (red, green, blue, 0)
                continue
            near_transparency = any(
                source[near_x, near_y][3] < 18
                for near_y in range(max(0, y - 4), min(height, y + 5))
                for near_x in range(max(0, x - 4), min(width, x + 5))
            )
            if near_transparency:
                cleaned[x, y] = (red, green, blue, 0)
    return output


def clear_transparent_rgb(image: Image.Image) -> Image.Image:
    """Prevent invisible chroma RGB values from bleeding during CSS scaling."""
    output = image.copy()
    pixels = output.load()
    for y in range(output.height):
        for x in range(output.width):
            red, green, blue, alpha = pixels[x, y]
            if alpha <= 3:
                pixels[x, y] = (0, 0, 0, 0)
    return output


def split_frames(sheet: Image.Image, columns: int, rows: int) -> list[Image.Image]:
    width, height = sheet.size
    x_boundaries = [round(index * width / columns) for index in range(columns + 1)]
    y_boundaries = [round(index * height / rows) for index in range(rows + 1)]
    frames: list[Image.Image] = []

    for row in range(rows):
        for column in range(columns):
            frame = sheet.crop(
                (
                    x_boundaries[column],
                    y_boundaries[row],
                    x_boundaries[column + 1],
                    y_boundaries[row + 1],
                )
            )
            frames.append(frame.crop(alpha_bbox(frame)))

    return frames


def split_horizontal_alpha_runs(sheet: Image.Image, expected_frames: int) -> list[Image.Image]:
    """Split isolated generated poses without assuming mathematically even spacing."""
    alpha = sheet.getchannel("A")
    occupied_columns = [
        alpha.crop((x, 0, x + 1, sheet.height)).point(lambda value: 255 if value > 8 else 0).getbbox()
        is not None
        for x in range(sheet.width)
    ]
    runs: list[tuple[int, int]] = []
    start: int | None = None

    for x, occupied in enumerate((*occupied_columns, False)):
        if occupied and start is None:
            start = x
        elif not occupied and start is not None:
            if x - start >= 2:
                runs.append((start, x))
            start = None

    if len(runs) != expected_frames:
        raise ValueError(
            f"Expected {expected_frames} isolated alpha runs, found {len(runs)}. "
            "Regenerate the strip with clear gaps or omit --auto-segment."
        )

    return [sheet.crop((left, 0, right, sheet.height)).crop(alpha_bbox(sheet.crop((left, 0, right, sheet.height)))) for left, right in runs]


def normalize_frames(frames: list[Image.Image]) -> list[Image.Image]:
    normalized: list[Image.Image] = []
    max_width = max(frame.width for frame in frames)
    max_height = max(frame.height for frame in frames)
    shared_scale = min(CONTENT_SIZE / max_width, CONTENT_SIZE / max_height)

    for frame in frames:
        resized = frame.resize(
            (
                max(1, round(frame.width * shared_scale)),
                max(1, round(frame.height * shared_scale)),
            ),
            Image.Resampling.LANCZOS,
        )
        canvas = Image.new("RGBA", (FRAME_SIZE, FRAME_SIZE), (0, 0, 0, 0))
        x = round((FRAME_SIZE - resized.width) / 2)
        y = FRAME_SIZE - BASELINE_MARGIN - resized.height
        canvas.alpha_composite(resized, (x, y))
        normalized.append(clear_transparent_rgb(remove_magenta_fringe(canvas)))

    return normalized


def save_sprite_strip(frames: list[Image.Image], output_path: Path) -> None:
    strip = Image.new("RGBA", (FRAME_SIZE * len(frames), FRAME_SIZE), (0, 0, 0, 0))
    for index, frame in enumerate(frames):
        strip.alpha_composite(frame, (index * FRAME_SIZE, 0))
    output_path.parent.mkdir(parents=True, exist_ok=True)
    strip.save(output_path, optimize=True)


def save_preview(frames: list[Image.Image], output_path: Path) -> None:
    preview_frames = []
    for frame in frames:
        background = Image.new("RGBA", frame.size, (236, 245, 255, 255))
        background.alpha_composite(frame)
        preview_frames.append(background.convert("RGB"))

    output_path.parent.mkdir(parents=True, exist_ok=True)
    preview_frames[0].save(
        output_path,
        save_all=True,
        append_images=preview_frames[1:],
        duration=64,
        loop=0,
        disposal=2,
        optimize=False,
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Normalize an eight-frame character run cycle")
    parser.add_argument("input", type=Path, help="Transparent horizontal source strip")
    parser.add_argument("output", type=Path, help="Normalized transparent PNG sprite strip")
    parser.add_argument("--preview", type=Path, help="Optional animated GIF preview")
    parser.add_argument("--columns", type=int, default=8, help="Source sheet column count")
    parser.add_argument("--rows", type=int, default=1, help="Source sheet row count")
    parser.add_argument(
        "--auto-segment",
        action="store_true",
        help="Detect isolated poses by alpha gaps instead of fixed equal-width cells",
    )
    parser.add_argument(
        "--chroma-tolerance",
        type=int,
        default=0,
        help="Remove the top-left background color within this RGB tolerance",
    )
    args = parser.parse_args()

    source = Image.open(args.input).convert("RGBA")
    if args.columns <= 0 or args.rows <= 0:
        raise ValueError("columns and rows must be positive")
    source = remove_connected_white_border(source)
    source = remove_chroma(source, args.chroma_tolerance)
    source = remove_magenta_fringe(source)
    if args.auto_segment:
        if args.rows != 1:
            raise ValueError("--auto-segment currently supports one-row strips only")
        source_frames = split_horizontal_alpha_runs(source, args.columns)
    else:
        source_frames = split_frames(source, args.columns, args.rows)
    frames = normalize_frames(source_frames)
    save_sprite_strip(frames, args.output)
    if args.preview:
        save_preview(frames, args.preview)


if __name__ == "__main__":
    main()
