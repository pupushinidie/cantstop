"""第一轮：定画风、出候选。结果在 out/r1/<名字>/（一组小图一个目录，大图直接放 out/r1/）。

- 小图（≤42px）用 /generate-image-v2：一次出 64 个候选，挑一个。
- 大图（背景、首页主图）用 /create-image-pixen，512×288。
PixelLab 同一时间只跑一个任务，按顺序一个一个来。

用法：python r1.py [名字 ...]（不写就全跑；已经出过的跳过）
"""
from __future__ import annotations

import sys

import pixellab

OUT = pixellab.ART / "out" / "r1"

# 名字: (提示词, 宽, 高, 透明背景)
SPRITES: dict[str, tuple[str, int, int, bool]] = {
    "climber": ("a tiny mountain climber with a red jacket, white helmet and backpack, seen from behind, climbing up a rock wall, arms reaching up", 32, 32, True),
    "avatar": ("portrait of a cheerful mountain climber, red jacket, white helmet with goggles, rosy cheeks, head and shoulders, front view", 32, 32, True),
    "rock": ("a square block of grey granite rock with cracks and small ledges, side view, platformer game tile filling the whole square", 32, 32, False),
    "snowrock": ("a square block of grey granite rock with a thick cap of white snow on top and icicles, side view, platformer game tile", 32, 32, True),
    "tent": ("a tiny red camping tent pitched on the ground, front view, game marker", 16, 16, True),
    "pennant": ("a small red triangular pennant flag on a short wooden pole stuck in the ground", 16, 16, True),
    "summit-flag": ("a large red flag waving in the wind on a tall wooden pole planted in a pile of snow", 32, 48, True),
    "die": ("a single white dice cube seen straight from the front, one flat square face with rounded corners, blank face with no dots, soft shading", 32, 32, True),
    "icon-dice": ("game icon: two white dice tumbling", 32, 32, True),
    "icon-camp": ("game icon: a small red flag planted on a rocky ledge next to a tent", 32, 32, True),
    "icon-rockfall": ("game icon: falling rocks and a dust cloud, avalanche", 32, 32, True),
    "icon-trophy": ("game icon: a golden trophy cup on a snowy mountain peak", 32, 32, True),
    "sign": ("a small blank wooden sign board nailed to a short post, front view", 32, 32, True),
    "campfire": ("a cozy campfire with orange flames and crossed logs, ring of stones", 32, 32, True),
    "pine": ("a single snowy pine tree, full height, side view", 32, 48, True),
}

SCENES: dict[str, tuple[str, tuple[int, ...]]] = {
    "backdrop-dawn": ("alpine mountain range panorama at dawn, tall snowy granite peaks, pine forest at the foot, pale blue sky with soft pink clouds, side view, no people", (7, 8, 9)),
    "backdrop-dusk": ("alpine mountain range panorama at dusk, snowy peaks glowing orange in the last sunlight, deep purple sky with first stars, dark pine forest at the foot, side view, no people", (17, 18)),
    "backdrop-night": ("alpine mountain range under a starry night sky with a full moon, moonlit snowy peaks, dark blue tones, pine forest silhouettes at the foot, side view, no people", (27, 28)),
    "hero": ("a team of tiny mountain climbers roped together ascending a steep snowy mountain toward the summit, small colorful flags planted on ledges along the route, dramatic sunrise sky, side view", (37, 38, 39)),
}


def sprite(name: str) -> None:
    prompt, width, height, transparent = SPRITES[name]
    folder = OUT / name
    if folder.exists() and any(folder.glob("*.png")):
        print(name, "已有，跳过", flush=True)
        return
    pixellab.generate_async(name, {
        "description": prompt,
        "image_size": {"width": width, "height": height},
        "no_background": transparent,
        "seed": 101,
    }, folder, endpoint="/generate-image-v2")


def scene(name: str) -> None:
    prompt, seeds = SCENES[name]
    for seed in seeds:
        target = f"{name}-s{seed}"
        if (OUT / f"{target}.png").exists():
            continue
        pixellab.generate_image(target, {
            "description": prompt,
            "image_size": {"width": 512, "height": 288},
            "detail": "highly detailed",
            "seed": seed,
        }, OUT, endpoint="/create-image-pixen")


if __name__ == "__main__":
    names = sys.argv[1:] or [*SPRITES, *SCENES]
    for name in names:
        try:
            if name in SPRITES:
                sprite(name)
            else:
                scene(name)
        except Exception as error:  # 一项失败不影响后面的
            print(name, "失败：", error, flush=True)
            continue
        print(name, "done; spent", round(pixellab.spent_usd(), 4), flush=True)
