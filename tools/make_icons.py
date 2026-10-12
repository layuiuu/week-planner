"""生成 PWA 图标(纯 Pillow,无其他依赖)。

iOS 极简风格:纯色底 + 白色线性图形,不用渐变、不用投影。

用法: python tools/make_icons.py
输出:
  icons/icon-192.png          安卓 / manifest 用,圆角 + 透明
  icons/icon-512.png          同上,512
  icons/icon-512-maskable.png maskable(内容缩进安全区,背景铺满)
  icons/apple-touch-icon.png  iOS 用,180,满幅不透明(iOS 自己加圆角)
  icons/favicon-32.png        浏览器标签页用
"""

import os

from PIL import Image, ImageDraw

OUT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "icons")

BLUE = (63, 97, 212)  # #3F61D4,与界面里的柔和交互色一致
WHITE = (255, 255, 255)


def draw_icon(size, rounded=True, inset=1.0):
    """在 4 倍画布上绘制后缩小,边缘更干净(这是抗锯齿,不是渐变)。"""
    S = size * 4
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    if rounded:
        mask = Image.new("L", (S, S), 0)
        ImageDraw.Draw(mask).rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * 0.225), fill=255)
        img.paste(Image.new("RGBA", (S, S), BLUE + (255,)), (0, 0), mask)
    else:
        d.rectangle([0, 0, S, S], fill=BLUE + (255,))

    # 日历外框
    pad = S * 0.24 * inset
    left, top, right, bottom = pad, S * 0.30 * inset + (S - S * inset) / 2, S - pad, S - pad
    radius = (right - left) * 0.16
    stroke = max(1, int(S * 0.036))
    d.rounded_rectangle([left, top, right, bottom], radius=radius, outline=WHITE + (255,), width=stroke)

    # 顶部横线
    d.line([(left, top + (bottom - top) * 0.28), (right, top + (bottom - top) * 0.28)], fill=WHITE + (255,), width=stroke)

    # 两个挂环
    tick_w = stroke
    for x in (left + (right - left) * 0.3, left + (right - left) * 0.7):
        d.line([(x, top - (bottom - top) * 0.16), (x, top + (bottom - top) * 0.06)], fill=WHITE + (255,), width=tick_w)

    # 右下对勾徽标(白色实心圆 + 蓝色对勾,扁平)
    cx, cy = right - (right - left) * 0.06, bottom - (bottom - top) * 0.06
    r = (right - left) * 0.30
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=WHITE + (255,))
    w = max(1, int(r * 0.24))
    pts = [(cx - r * 0.42, cy + r * 0.02), (cx - r * 0.12, cy + r * 0.32), (cx + r * 0.44, cy - r * 0.30)]
    for i in range(len(pts) - 1):
        d.line([pts[i], pts[i + 1]], fill=BLUE + (255,), width=w, joint="curve")
    for p in pts:
        d.ellipse([p[0] - w / 2, p[1] - w / 2, p[0] + w / 2, p[1] + w / 2], fill=BLUE + (255,))

    return img.resize((size, size), Image.LANCZOS)


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    draw_icon(192).save(os.path.join(OUT_DIR, "icon-192.png"))
    draw_icon(512).save(os.path.join(OUT_DIR, "icon-512.png"))
    draw_icon(512, rounded=False, inset=1.28).save(os.path.join(OUT_DIR, "icon-512-maskable.png"))
    draw_icon(180, rounded=False).convert("RGB").save(os.path.join(OUT_DIR, "apple-touch-icon.png"))
    draw_icon(32).save(os.path.join(OUT_DIR, "favicon-32.png"))
    print("icons written to", OUT_DIR)


if __name__ == "__main__":
    main()
