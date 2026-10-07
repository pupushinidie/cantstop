"""把选定的美术导出到 apps/web/public/art/。选择记在 selection.json（路径相对 art/out/）。

- 登山者、头像、营地小旗、山顶大旗都只生成红色一套，其他三个座位色把红色像素换色（像实体游戏里同一个模子的棋子）。
- 骰子：选一张空白骰面，按点数画上像素点。
- 还没选定的项目用简单的占位图，界面可以先跑起来。

用法：python export.py
"""
from __future__ import annotations

import colorsys
import json
import pathlib

from PIL import Image, ImageDraw

ART = pathlib.Path(__file__).resolve().parent
OUT = ART / "out"
WEB = ART.parent / "apps/web/public/art"
SELECTION = json.loads((ART / "selection.json").read_text())

# 座位色：红（原样）、蓝、绿、黄。值是 (色相, 饱和度, 目标亮度区间)
SEATS = {
    "red": None,
    "blue": (216, 0.78, (0.20, 0.66)),
    "green": (128, 0.55, (0.18, 0.58)),
    "yellow": (46, 0.88, (0.30, 0.74)),
}
RED_LIGHTNESS = (0.16, 0.56)  # 原图红色衣服的亮度范围


def is_team_red(r: int, g: int, b: int) -> bool:
    """衣服、旗面的红色：色相在 340°–18°、饱和度 > 0.42。肤色饱和度低、偏橙，不算。"""
    h, l, s = colorsys.rgb_to_hls(r / 255, g / 255, b / 255)
    hue = h * 360
    return (hue >= 340 or hue <= 18) and s > 0.42 and 0.08 < l < 0.75


def recolor(image: Image.Image, seat: str, from_row: int = 0) -> Image.Image:
    """把红色像素换成座位色；from_row 以上的行不动（头像只换衣服，嘴唇保持原色）。"""
    spec = SEATS[seat]
    if spec is None:
        return image.copy()
    hue, saturation, (low, high) = spec
    src_low, src_high = RED_LIGHTNESS
    out = image.copy()
    px = out.load()
    cache: dict[tuple[int, int, int], tuple[int, int, int]] = {}
    for y in range(from_row, out.height):
        for x in range(out.width):
            r, g, b, a = px[x, y]
            if a == 0 or not is_team_red(r, g, b):
                continue
            key = (r, g, b)
            if key not in cache:
                _, l, _ = colorsys.rgb_to_hls(r / 255, g / 255, b / 255)
                t = min(1.0, max(0.0, (l - src_low) / (src_high - src_low)))
                nr, ng, nb = colorsys.hls_to_rgb(hue / 360, low + t * (high - low), saturation)
                cache[key] = (round(nr * 255), round(ng * 255), round(nb * 255))
            px[x, y] = (*cache[key], a)
    return out


def load(key: str) -> Image.Image | None:
    path = SELECTION.get(key)
    if not path:
        return None
    return Image.open(OUT / path).convert("RGBA")


def clear_white(image: Image.Image) -> Image.Image:
    """从四角开始把连通的近白色像素抠成透明（generate-with-style 出的图是白底）。"""
    out = image.copy()
    px = out.load()
    width, height = out.size
    stack = [(0, 0), (width - 1, 0), (0, height - 1), (width - 1, height - 1)]
    seen = set()
    while stack:
        x, y = stack.pop()
        if (x, y) in seen or not (0 <= x < width and 0 <= y < height):
            continue
        seen.add((x, y))
        r, g, b, a = px[x, y]
        if a == 0 or min(r, g, b) < 236:
            continue
        px[x, y] = (0, 0, 0, 0)
        stack += [(x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)]
    return out


def save(image: Image.Image, relative: str) -> None:
    target = WEB / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    image.save(target)


def strip(frames: list[Image.Image]) -> Image.Image:
    width, height = frames[0].size
    sheet = Image.new("RGBA", (width * len(frames), height))
    for index, frame in enumerate(frames):
        sheet.alpha_composite(frame, (index * width, 0))
    return sheet


def frames_of(key: str, count: int) -> list[Image.Image] | None:
    """动画帧：selection 里是目录 + 前缀（{前缀}-00.png …），不够 count 帧就循环补齐。"""
    spec = SELECTION.get(key)
    if not spec:
        return None
    folder, prefix = spec
    paths = sorted((OUT / folder).glob(f"{prefix}-[0-9][0-9].png"))
    if not paths:
        return None
    frames = [Image.open(path).convert("RGBA") for path in paths]
    # PixelLab 返回的第 0 帧就是输入的那张静态图；首末帧都用静态图时最后一帧≈第 0 帧，去掉开头那张循环才不卡一下
    if len(frames) > count:
        frames = frames[1:]
    picks = [frames[round(i * (len(frames) - 1) / max(1, count - 1))] for i in range(count)] if len(frames) >= count else (frames * count)[:count]
    return picks


# ---------- 占位图（还没选定时用） ----------

def placeholder_flag(size: int, color=(214, 58, 46)) -> Image.Image:
    image = Image.new("RGBA", (size, size))
    draw = ImageDraw.Draw(image)
    pole = size // 4
    draw.rectangle([pole, 1, pole + 1, size - 1], fill=(92, 64, 40, 255))
    draw.polygon([(pole + 2, 2), (size - 2, size // 4 + 1), (pole + 2, size // 2)], fill=(*color, 255), outline=(40, 10, 10, 255))
    return image


def die_face(base: Image.Image | None, face: int) -> Image.Image:
    """32×32 的骰面：有选定的空白骰面就画在上面，否则画一个白色圆角方块。点用 4×4 像素的深色方点。"""
    if base is None:
        base = Image.new("RGBA", (32, 32))
        draw = ImageDraw.Draw(base)
        draw.rounded_rectangle([1, 1, 30, 30], radius=6, fill=(238, 240, 246, 255), outline=(20, 24, 36, 255), width=2)
        draw.line([(5, 27), (26, 27)], fill=(196, 202, 216, 255), width=2)
    image = base.copy()
    draw = ImageDraw.Draw(image)
    spots = {
        1: [(1, 1)],
        2: [(0, 0), (2, 2)],
        3: [(0, 0), (1, 1), (2, 2)],
        4: [(0, 0), (2, 0), (0, 2), (2, 2)],
        5: [(0, 0), (2, 0), (1, 1), (0, 2), (2, 2)],
        6: [(0, 0), (2, 0), (0, 1), (2, 1), (0, 2), (2, 2)],
    }[face]
    # 骰面在 4..27 之间（24 像素），点阵以 15.5 为中心；点是切掉四角的小方块，看起来是圆的
    left, top, step = 7, 7, 6
    for col, row in spots:
        x = left + col * step
        y = top + row * step
        if face == 1:
            color, size = (204, 44, 44, 255), 7
            x, y = x - 1, y - 1
        else:
            color, size = (30, 34, 52, 255), 5
        draw.rectangle([x, y, x + size - 1, y + size - 1], fill=color)
        for cx, cy in [(x, y), (x + size - 1, y), (x, y + size - 1), (x + size - 1, y + size - 1)]:
            draw.point((cx, cy), fill=base.getpixel((cx, cy)))
    return image


def export() -> None:
    # 登山者：静止图 + 攀爬动画（4 帧横排），四个座位色
    climber = load("climber")
    climb = frames_of("climb", 8)
    cheer = frames_of("cheer", 8)
    fall = frames_of("fall", 6)
    avatar = load("avatar")
    camp = load("camp") or placeholder_flag(16)
    summit = load("summit") or placeholder_flag(32).resize((32, 48))
    wave = frames_of("wave", 4)
    for seat in SEATS:
        if climber:
            save(recolor(climber, seat), f"sprites/climber-{seat}.png")
            save(strip([recolor(frame, seat) for frame in (climb or [climber] * 8)]), f"sprites/climber-{seat}-climb.png")
            save(strip([recolor(frame, seat) for frame in (cheer or [climber] * 8)]), f"sprites/climber-{seat}-cheer.png")
            save(strip([recolor(frame, seat) for frame in (fall or [climber] * 6)]), f"sprites/climber-{seat}-fall.png")
        if avatar:
            save(recolor(avatar, seat, from_row=SELECTION.get("avatar-jacket-row", 21)), f"sprites/avatar-{seat}.png")
        save(recolor(camp, seat), f"sprites/camp-{seat}.png")
        save(recolor(summit, seat), f"sprites/summit-{seat}.png")
        save(strip([recolor(frame, seat) for frame in (wave or [summit] * 4)]), f"sprites/summit-{seat}-wave.png")

    # 岩块：几种普通岩块轮换 + 积雪岩块
    # 岩块裁到 24×24（画面本身就是 24 像素见方，四周是留白），积雪岩块裁成 26×24（积雪两边各探出 1 像素）
    for index, key in enumerate(SELECTION.get("rocks", [])):
        save(clear_white(Image.open(OUT / key).convert("RGBA")).crop((4, 4, 28, 28)), f"tiles/rock-{index}.png")
    for index, key in enumerate(SELECTION.get("snows", [])):
        save(Image.open(OUT / key).convert("RGBA").crop((3, 4, 29, 28)), f"tiles/snow-{index}.png")

    # 骰子
    blank = load("die")
    for face in range(1, 7):
        save(die_face(blank, face), f"dice/die-{face}.png")

    # 界面图标、装饰、场景
    for key in ["dice", "camp", "rockfall", "trophy", "sign", "campfire", "pine", "pine2"]:
        image = load(f"ui-{key}")
        if image:
            save(image, f"ui/{key}.png")
    campfire = load("ui-campfire")
    if campfire:
        save(strip(frames_of("flicker", 4) or [campfire] * 4), "ui/campfire-anim.png")
    for index, key in enumerate(SELECTION.get("backdrops", [])):
        save(Image.open(OUT / key).convert("RGBA"), f"scene/backdrop-{index}.png")
    hero = load("hero")
    if hero:
        save(hero, "scene/hero.png")


if __name__ == "__main__":
    export()
    print("exported to", WEB)
