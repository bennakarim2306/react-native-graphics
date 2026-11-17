"""Generates the synthetic sprite sheets used by the example app (no third-party art).

Run: python3 scripts/generate-demo-sprites.py
Outputs example/assets/coin-sheet.png (8 frames, 64x64) and example/assets/slime-sheet.png
(6 frames, 64x64). Each frame has its number in a corner so frame playback is visible.
"""
import math
from pathlib import Path
from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "example" / "assets"
S = 64  # frame size
SS = 4  # supersampling for smooth edges


def digit(draw: ImageDraw.ImageDraw, n: int, x: int, y: int, scale: int, fill) -> None:
    """Tiny seven-segment digit so we don't depend on fonts."""
    segs = {0: "abcedf", 1: "bc", 2: "abged", 3: "abgcd", 4: "fgbc", 5: "afgcd", 6: "afgedc", 7: "abc", 8: "abcdefg", 9: "abfgcd"}[n]
    w, h, t = 4 * scale, 7 * scale, scale
    rects = {
        "a": (x, y, x + w, y + t), "g": (x, y + h // 2 - t // 2, x + w, y + h // 2 + t // 2), "d": (x, y + h - t, x + w, y + h),
        "f": (x, y, x + t, y + h // 2), "b": (x + w - t, y, x + w, y + h // 2),
        "e": (x, y + h // 2, x + t, y + h), "c": (x + w - t, y + h // 2, x + w, y + h),
    }
    for s in segs:
        draw.rectangle(rects[s], fill=fill)


def coin_sheet() -> Image.Image:
    frames = 8
    sheet = Image.new("RGBA", (S * frames, S), (0, 0, 0, 0))
    for i in range(frames):
        big = Image.new("RGBA", (S * SS, S * SS), (0, 0, 0, 0))
        d = ImageDraw.Draw(big)
        # A coin seen while spinning: the ellipse width follows |cos|.
        k = abs(math.cos(i / frames * math.pi))
        rx = max(3, int(26 * SS * k))
        ry = 26 * SS
        cx = cy = S * SS // 2
        edge = (176, 112, 20, 255)
        face = (255, 200, 40, 255) if math.cos(i / frames * math.pi) >= 0 else (240, 170, 30, 255)
        d.ellipse((cx - rx - 2 * SS, cy - ry, cx + rx + 2 * SS, cy + ry), fill=edge)
        d.ellipse((cx - rx, cy - ry + 2 * SS, cx + rx, cy + ry - 2 * SS), fill=face)
        if rx > 10 * SS:
            d.ellipse((cx - rx // 2, cy - ry // 2, cx + rx // 2, cy + ry // 2), outline=edge, width=3 * SS)
        # Highlight
        d.ellipse((cx - rx // 2, cy - ry + 6 * SS, cx - rx // 4 + SS, cy - ry // 2), fill=(255, 245, 200, 200))
        frame = big.resize((S, S), Image.LANCZOS)
        digit(ImageDraw.Draw(frame), i, 2, 2, 1, (255, 255, 255, 230))
        sheet.paste(frame, (i * S, 0))
    return sheet


def slime_sheet() -> Image.Image:
    frames = 6
    sheet = Image.new("RGBA", (S * frames, S), (0, 0, 0, 0))
    for i in range(frames):
        big = Image.new("RGBA", (S * SS, S * SS), (0, 0, 0, 0))
        d = ImageDraw.Draw(big)
        phase = i / frames * 2 * math.pi
        squash = 0.18 * math.sin(phase)
        w = 46 * SS * (1 + squash)
        h = 40 * SS * (1 - squash)
        cx = S * SS / 2
        base = S * SS - 6 * SS
        body = (90, 220, 130, 255)
        d.ellipse((cx - w / 2, base - h, cx + w / 2, base + 4 * SS), fill=body)
        d.rectangle((cx - w / 2, base - h / 2, cx + w / 2, base), fill=body)
        d.ellipse((cx - w / 2, base - 6 * SS, cx + w / 2, base + 4 * SS), fill=(60, 170, 100, 255))
        # Eyes look left and right over the cycle.
        look = 4 * SS * math.cos(phase)
        for ex in (-10 * SS, 10 * SS):
            d.ellipse((cx + ex - 6 * SS, base - h * 0.75 - 7 * SS, cx + ex + 6 * SS, base - h * 0.75 + 7 * SS), fill=(255, 255, 255, 255))
            d.ellipse((cx + ex + look - 3 * SS, base - h * 0.75 - 3 * SS, cx + ex + look + 3 * SS, base - h * 0.75 + 4 * SS), fill=(30, 30, 50, 255))
        frame = big.resize((S, S), Image.LANCZOS)
        digit(ImageDraw.Draw(frame), i, 2, 2, 1, (255, 255, 255, 230))
        sheet.paste(frame, (i * S, 0))
    return sheet


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    coin_sheet().save(OUT / "coin-sheet.png", optimize=True)
    slime_sheet().save(OUT / "slime-sheet.png", optimize=True)
    print("wrote", OUT / "coin-sheet.png", OUT / "slime-sheet.png")
