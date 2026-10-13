"""アプリアイコン（PNG）を生成する。外部ライブラリ不要。

    python scripts/make_icons.py

緑のグラデーション背景に白い「¥」。maskable 用は全面塗り、通常用は角丸。
「¥」は中央 80% のセーフゾーン内に収めている。
"""
import struct
import zlib
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / 'public' / 'icons'

TOP = (0x14, 0xB8, 0xA6)  # teal-500
BOTTOM = (0x0F, 0x76, 0x6E)  # teal-700
WHITE = (255, 255, 255)

# 「¥」を丸端の線分で表す（0〜1 の座標）
STROKE = 0.078
SEGMENTS = [
    ((0.335, 0.265), (0.5, 0.5)),
    ((0.665, 0.265), (0.5, 0.5)),
    ((0.5, 0.5), (0.5, 0.755)),
    ((0.355, 0.545), (0.645, 0.545)),
    ((0.355, 0.65), (0.645, 0.65)),
]


def dist_to_segment(px, py, a, b):
    ax, ay = a
    bx, by = b
    dx, dy = bx - ax, by - ay
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
    cx, cy = ax + t * dx, ay + t * dy
    return ((px - cx) ** 2 + (py - cy) ** 2) ** 0.5


def in_glyph(x, y):
    return any(dist_to_segment(x, y, a, b) <= STROKE / 2 for a, b in SEGMENTS)


def in_rounded_rect(x, y, r):
    cx = min(max(x, r), 1 - r)
    cy = min(max(y, r), 1 - r)
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r


def render(size, rounded):
    ss = 4 if size <= 256 else 3  # スーパーサンプリングでアンチエイリアス
    rows = []
    for py in range(size):
        row = bytearray([0])  # PNG フィルタ: なし
        for px in range(size):
            bg = glyph = 0
            for sy in range(ss):
                for sx in range(ss):
                    x = (px + (sx + 0.5) / ss) / size
                    y = (py + (sy + 0.5) / ss) / size
                    if rounded and not in_rounded_rect(x, y, 0.22):
                        continue
                    bg += 1
                    if in_glyph(x, y):
                        glyph += 1
            n = ss * ss
            t = py / (size - 1)
            base = [round(TOP[i] + (BOTTOM[i] - TOP[i]) * t) for i in range(3)]
            if bg == 0:
                row += bytes(4)
                continue
            g = glyph / bg
            color = [round(base[i] * (1 - g) + WHITE[i] * g) for i in range(3)]
            row += bytes(color + [round(255 * bg / n)])
        rows.append(bytes(row))
    return png(size, size, b''.join(rows))


def png(w, h, raw):
    def chunk(kind, data):
        c = struct.pack('>I', len(data)) + kind + data
        return c + struct.pack('>I', zlib.crc32(kind + data) & 0xFFFFFFFF)

    return (b'\x89PNG\r\n\x1a\n'
            + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(raw, 9))
            + chunk(b'IEND', b''))


TARGETS = [
    ('icon-192.png', 192, True),
    ('icon-512.png', 512, True),
    ('icon-maskable-512.png', 512, False),
    ('apple-touch-icon.png', 180, False),  # iOS は自動で角丸にする
    ('favicon-32.png', 32, True),
]

if __name__ == '__main__':
    OUT.mkdir(parents=True, exist_ok=True)
    for name, size, rounded in TARGETS:
        (OUT / name).write_bytes(render(size, rounded))
        print('wrote', name)
