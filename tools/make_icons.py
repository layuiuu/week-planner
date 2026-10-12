"""生成 PWA 图标(纯 Pillow,无其他依赖)。

用法: python tools/make_icons.py
输出:
  icons/icon-192.png          安卓 / manifest 用,圆角 + 透明
  icons/icon-512.png          同上,512,声明为 maskable
  icons/apple-touch-icon.png  iOS 用,180,满幅不透明(iOS 自己会加圆角)
"""

import math
import os

from PIL import Image, ImageDraw

OUT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "icons")

TOP = (79, 70, 229)      # #4F46E5
BOTTOM = (6, 182, 212)   # #06B6D4
ACCENT = (79, 70, 229)
GREEN = (34, 197, 94)
WEEKEND = (148, 163, 184)


def gradient(size):
    img = Image.new("RGB", (1, size))
    px = img.load()
    for y in range(size):
        t = y / max(size - 1, 1)
        px[0, y] = (
            round(TOP[0] + (BOTTOM[0] - TOP[0]) * t),
            round(TOP[1] + (BOTTOM[1] - TOP[1]) * t),
            round(TOP[2] + (BOTTOM[2] - TOP[2]) * t),
        )
    return img.resize((size, size), Image.NEAREST)


def check(draw, cx, cy, r, width):
    """在最右下的圆圈里画一个对勾。"""
    draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(255, 255, 255, 255))
    r2 = r * 0.86
    draw.ellipse([cx - r2, cy - r2, cx + r2, cy + r2], fill=GREEN + (255,))
    w = width
    pts = [
        (cx - r * 0.40, cy + r * 0.02),
        (cx - r * 0.10, cy + r * 0.32),
        (cx + r * 0.42, cy - r * 0.30),
    ]
    for i in range(len(pts) - 1):
        draw.line([pts[i], pts[i + 1]], fill=(255, 255, 255, 255), width=w, joint="curve")
        draw.ellipse(
            [pts[i][0] - w / 2, pts[i][1] - w / 2, pts[i][0] + w / 2, pts[i][1] + w / 2],
            fill=(255, 255, 255, 255),
        )


def render(size, rounded=True, safe=1.0):
    S = size * 4  # 4 倍超采样
    base = gradient(S).convert("RGBA")

    if rounded:
        mask = Image.new("L", (S, S), 0)
        ImageDraw.Draw(mask).rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * 0.225), fill=255)
        base.putalpha(mask)

    d = ImageDraw.Draw(base)

    # 日历卡片
    m = S * 0.20 / safe
    card = [m, m, S - m, S - m]
    radius = S * 0.075
    d.rounded_rectangle(card, radius=radius, fill=(255, 255, 255, 255))

    # 卡片顶部色带(下方两角切平)
    head_h = (card[3] - card[1]) * 0.26
    d.rounded_rectangle([card[0], card[1], card[2], card[1] + head_h], radius=radius, fill=ACCENT + (255,))
    d.rectangle([card[0], card[1] + head_h * 0.5, card[2], card[1] + head_h], fill=ACCENT + (255,))

    # 顶部两个挂环
    ring_r = S * 0.016
    for x in (card[0] + (card[2] - card[0]) * 0.3, card[0] + (card[2] - card[0]) * 0.7):
        d.ellipse([x - ring_r, card[1] - ring_r * 1.4, x + ring_r, card[1] + ring_r * 0.6],
                  fill=(255, 255, 255, 255))

    # 卡片里的日期格子
    body_top = card[1] + head_h * 1.18
    body_bottom = card[3] - (card[3] - card[1]) * 0.14
    body_left = card[0] + (card[2] - card[0]) * 0.11
    body_right = card[2] - (card[2] - card[0]) * 0.11
    cols, rows = 4, 3
    gapx = (body_right - body_left) / cols
    gapy = (body_bottom - body_top) / rows
    cell = min(gapx, gapy) * 0.62
    filled = {(0, 0), (1, 0), (2, 0), (0, 1), (2, 1), (1, 2)}
    for r in range(rows):
        for c in range(cols):
            cx = body_left + gapx * (c + 0.5)
            cy = body_top + gapy * (r + 0.5)
            if r == 2 and c == 3:
                continue  # 让位给对勾
            color = ACCENT + (255,) if (c, r) in filled else WEEKEND + (255,)
            if (c, r) not in filled:
                color = (203, 213, 225, 255)
            d.rounded_rectangle([cx - cell / 2, cy - cell / 2, cx + cell / 2, cy + cell / 2],
                                radius=cell * 0.28, fill=color)

    # 右下对勾徽标
    check(d, card[2] - (card[2] - card[0]) * 0.06, card[3] - (card[3] - card[1]) * 0.06, S * 0.135, int(S * 0.022))

    return base.resize((size, size), Image.LANCZOS)


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    render(192, rounded=True).save(os.path.join(OUT_DIR, "icon-192.png"))
    render(512, rounded=True).save(os.path.join(OUT_DIR, "icon-512.png"))
    # maskable: 内容缩小到安全区(80%),背景铺满
    render(512, rounded=False, safe=1.25).save(os.path.join(OUT_DIR, "icon-512-maskable.png"))
    render(180, rounded=False).convert("RGB").save(os.path.join(OUT_DIR, "apple-touch-icon.png"))
    render(32, rounded=True).save(os.path.join(OUT_DIR, "favicon-32.png"))
    print("icons written to", OUT_DIR)


if __name__ == "__main__":
    main()
