from __future__ import annotations

import random
import string
from dataclasses import dataclass
from pathlib import Path

import ddddocr
from PIL import Image, ImageDraw, ImageFilter, ImageFont


BASE_DIR = Path(__file__).resolve().parent
OUT_DIR = BASE_DIR / "out"
OUT_DIR.mkdir(exist_ok=True)


@dataclass
class CaptchaSample:
    expected: str
    image_path: Path
    predicted: str

    @property
    def matched(self) -> bool:
        return self.expected.lower() == self.predicted.lower()


def random_text(length: int = 5) -> str:
    alphabet = string.ascii_lowercase + string.digits
    return "".join(random.choice(alphabet) for _ in range(length))


def load_font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    candidates = [
        Path("C:/Windows/Fonts/arialbd.ttf"),
        Path("C:/Windows/Fonts/arial.ttf"),
        Path("C:/Windows/Fonts/consolab.ttf"),
    ]
    for candidate in candidates:
        if candidate.exists():
            return ImageFont.truetype(str(candidate), size)
    return ImageFont.load_default()


def draw_local_captcha(text: str, image_path: Path) -> None:
    width, height = 180, 72
    image = Image.new("RGB", (width, height), "white")
    draw = ImageDraw.Draw(image)
    font = load_font(36)

    for _ in range(10):
        x1 = random.randint(0, width)
        y1 = random.randint(0, height)
        x2 = random.randint(0, width)
        y2 = random.randint(0, height)
        color = tuple(random.randint(70, 170) for _ in range(3))
        draw.line((x1, y1, x2, y2), fill=color, width=random.randint(1, 3))

    x = 16
    for char in text:
        y = random.randint(10, 24)
        color = tuple(random.randint(15, 70) for _ in range(3))
        char_image = Image.new("RGBA", (36, 48), (255, 255, 255, 0))
        char_draw = ImageDraw.Draw(char_image)
        char_draw.text((4, 0), char, font=font, fill=color)
        char_image = char_image.rotate(random.randint(-18, 18), expand=True)
        image.paste(char_image, (x, y), char_image)
        x += random.randint(25, 31)

    for _ in range(160):
        x = random.randint(0, width - 1)
        y = random.randint(0, height - 1)
        color = tuple(random.randint(0, 220) for _ in range(3))
        image.putpixel((x, y), color)

    image = image.filter(ImageFilter.SMOOTH_MORE)
    image.save(image_path)


def solve_image(ocr: ddddocr.DdddOcr, image_path: Path) -> str:
    with image_path.open("rb") as image_file:
        return ocr.classification(image_file.read()).strip()


def run(samples: int = 5) -> list[CaptchaSample]:
    ocr = ddddocr.DdddOcr(show_ad=False)
    results: list[CaptchaSample] = []
    for index in range(1, samples + 1):
        expected = random_text()
        image_path = OUT_DIR / f"captcha_{index:02d}_{expected}.png"
        draw_local_captcha(expected, image_path)
        predicted = solve_image(ocr, image_path)
        results.append(CaptchaSample(expected, image_path, predicted))
    return results


def main() -> None:
    results = run()
    ok = sum(1 for result in results if result.matched)
    for result in results:
        status = "OK" if result.matched else "MISS"
        print(f"{status} expected={result.expected} predicted={result.predicted} image={result.image_path}")
    print(f"accuracy={ok}/{len(results)}")


if __name__ == "__main__":
    main()
