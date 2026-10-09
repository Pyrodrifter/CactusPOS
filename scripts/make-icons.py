"""Draws the CactusPOS logo into the PNG icons phones use on the home screen.

Same geometry as packages/web/src/ui/Logo.tsx and public/icons/logo.svg (a 64x64 box).
Run from the repository root after changing the logo:  python scripts/make-icons.py
Needs Pillow (pip install pillow). The PNGs are committed, so a normal build does not need Python.
"""
from pathlib import Path
from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / 'packages' / 'web' / 'public' / 'icons'
SS = 4  # supersampling for smooth edges


def lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def draw_logo(size, maskable=False):
    px = size * SS
    # Maskable icons are cropped to a circle or squircle by the launcher: fill the whole square
    # and keep the drawing inside the central safe zone.
    scale = (px / 64) * (0.72 if maskable else 1.0)
    off = (px - 64 * scale) / 2

    def P(x, y):
        return (off + x * scale, off + y * scale)

    top, bottom = (0x1b, 0x3a, 0x86), (0x0b, 0x16, 0x40)
    bg = Image.new('RGB', (px, px))
    pix = bg.load()
    for y in range(px):
        for x in range(px):
            pix[x, y] = lerp(top, bottom, (x + y) / (2 * px - 2))
    img = Image.new('RGBA', (px, px), (0, 0, 0, 0))
    mask = Image.new('L', (px, px), 0)
    radius = 0 if maskable else round(16 * px / 64)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, px - 1, px - 1], radius=radius, fill=255)
    img.paste(bg, (0, 0), mask)
    d = ImageDraw.Draw(img, 'RGBA')

    def dot(x, y, r, fill):
        cx, cy = P(x, y)
        rr = r * scale
        d.ellipse([cx - rr, cy - rr, cx + rr, cy + rr], fill=fill)

    def stroke(points, width, fill):
        pts = [P(x, y) for x, y in points]
        d.line(pts, fill=fill, width=round(width * scale), joint='curve')
        for x, y in points:  # round caps and joins
            dot(x, y, width / 2, fill)

    dot(47, 17, 6, '#ffc93c')
    cactus = '#37c8dc'
    stroke([(32, 38), (21, 38), (21, 27)], 7, cactus)
    stroke([(32, 44), (43, 44), (43, 32)], 7, cactus)
    stroke([(32, 47), (32, 18)], 11, cactus)
    stroke([(13, 53), (51, 53)], 3, '#4f74d9')
    stroke([(29.5, 22), (29.5, 46)], 2, (0x9a, 0xea, 0xf3, 190))
    dot(32, 12.5, 3.2, '#ff6fae')
    return img.resize((size, size), Image.LANCZOS)


if __name__ == '__main__':
    OUT.mkdir(parents=True, exist_ok=True)
    for name, size, maskable in [
        ('icon-192.png', 192, False), ('icon-512.png', 512, False),
        ('maskable-192.png', 192, True), ('maskable-512.png', 512, True),
        ('apple-touch-icon.png', 180, True),  # iOS rounds the corners itself and dislikes transparency
    ]:
        draw_logo(size, maskable).save(OUT / name, optimize=True)
        print('wrote', name)
    # Windows shortcut icon (desktop, Start menu) and the Linux launcher icon, used by the installers in ops/.
    ops = OUT.parents[3] / 'ops'
    sizes = [16, 24, 32, 48, 64, 128, 256]
    frames = [draw_logo(s) for s in sizes]
    frames[-1].save(ops / 'windows' / 'cactuspos.ico', sizes=[(s, s) for s in sizes], append_images=frames[:-1])
    draw_logo(256).save(ops / 'linux' / 'cactuspos.png', optimize=True)
    print('wrote cactuspos.ico, cactuspos.png')
