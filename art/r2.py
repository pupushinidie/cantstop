"""第二轮：在第一轮选定的图上做动画和配套图。结果在 out/r2/。

- climb：登山者攀爬循环（/animate-with-text-v3，首帧 = 选定的登山者，8 帧）。
- rocks：照着选定的积雪岩块的画风出普通岩块（/generate-with-style-v2，一次 64 个）。
- wave：山顶大旗飘动；campfire：篝火跳动（首帧末帧都用静态图，循环无缝）。

用法：python r2.py <任务 ...>
"""
from __future__ import annotations

import json
import sys

import pixellab

ART = pixellab.ART
OUT = ART / "out" / "r2"
SELECTION = json.loads((ART / "selection.json").read_text())


def image(key: str) -> dict:
    return pixellab.b64_image(ART / "out" / SELECTION[key])


def animate(name: str, key: str, action: str, frames: int, seeds: tuple[int, ...], loop: bool = True) -> None:
    for seed in seeds:
        target = f"{name}-s{seed}"
        if (OUT / name / f"{target}-00.png").exists():
            continue
        body = {
            "first_frame": image(key),
            "action": action,
            "frame_count": frames,
            "seed": seed,
            "no_background": True,
        }
        if loop:
            body["last_frame"] = image(key)
        pixellab.animate(target, body, OUT / name, endpoint="/animate-with-text-v3")
        print(target, "done; spent", round(pixellab.spent_usd(), 4), flush=True)


def styled(name: str, keys: list[str], description: str, style: str) -> None:
    folder = OUT / name
    if folder.exists() and any(folder.glob("*.png")):
        return
    images = [pixellab.ART / "out" / SELECTION[key] for key in keys]
    pixellab.generate_async(name, {
        "style_images": [{"image": pixellab.b64_image(path), "width": 32, "height": 32} for path in images],
        "description": description,
        "style_description": style,
        "no_background": False,
        "seed": 202,
    }, folder, endpoint="/generate-with-style-v2")
    print(name, "done; spent", round(pixellab.spent_usd(), 4), flush=True)


TASKS = {
    "climb": lambda: animate(
        "climb", "climber",
        "climbing up a rock wall seen from behind, reaching up with the left arm then the right arm, legs stepping up",
        8, (301, 302), loop=True),
    "rocks": lambda: styled(
        "rocks", ["snowrock"],
        "a square block of grey granite cliff rock without any snow, a few cracks and small ledges, fills the whole square",
        "same pixel art style, palette and outline as the reference snowy rock tile"),
    "wave": lambda: animate(
        "wave", "summit",
        "the flag cloth waving gently in the wind, the pole stays still",
        4, (311, 312), loop=True),
    "cheer": lambda: animate(
        "cheer", "climber",
        "turning around and jumping with both arms raised high in celebration at the summit, then landing",
        8, (331, 332), loop=True),
    "fall": lambda: animate(
        "fall", "climber",
        "losing grip and falling backwards off the cliff, arms and legs flailing in panic",
        6, (341, 342), loop=False),
    "campfire": lambda: animate(
        "campfire", "ui-campfire",
        "flames flickering and dancing, small sparks rising, logs stay still",
        4, (321, 322), loop=True),
}


if __name__ == "__main__":
    for task in sys.argv[1:]:
        try:
            TASKS[task]()
        except Exception as error:
            print(task, "失败：", error, flush=True)
