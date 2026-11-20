"""Generates the Phase 2 placeholder sprites for the Godot prototype.

Pure standard library (zlib + struct) so it runs without Pillow. Shapes are
rasterised with analytic anti-aliasing at SS x resolution and box-downsampled,
which gives clean edges without any image library.

Run:
    python tools/gen_sprites.py

Output: assets/sprites/{player,enemy,swing}.png
All sprites are drawn FACING UP (-Y), because Player/Enemy rotate their `Body`
node by `facing.angle() + PI/2`, which maps the sprite's up vector onto the
facing direction.
"""

import math
import os
import struct
import zlib

SS = 3  # supersampling factor for downsample quality


# --------------------------------------------------------------------------
# Canvas with analytic-AA shape rasterisation
# --------------------------------------------------------------------------
class Canvas:
    def __init__(self, w, h):
        self.out_w = w
        self.out_h = h
        self.w = w * SS
        self.h = h * SS
        self.buf = [[0.0, 0.0, 0.0, 0.0] for _ in range(self.w * self.h)]

    def _blend(self, x, y, rgb, alpha):
        """Standard source-over compositing in straight-alpha space.

        `alpha` here is the *effective* coverage (shape AA x paint alpha), so
        repeated soft passes must accumulate, never replace. Getting this wrong
        in either direction shows up immediately as over-exposed white blobs or
        as edges that fade into the transparent backdrop.
        """
        if alpha <= 0.0 or x < 0 or y < 0 or x >= self.w or y >= self.h:
            return
        i = y * self.w + x
        d = self.buf[i]
        da = d[3]
        out_a = alpha + da * (1.0 - alpha)
        if out_a <= 0.0:
            d[0] = d[1] = d[2] = d[3] = 0.0
            return
        k = da * (1.0 - alpha)
        d[0] = (rgb[0] * alpha + d[0] * k) / out_a
        d[1] = (rgb[1] * alpha + d[1] * k) / out_a
        d[2] = (rgb[2] * alpha + d[2] * k) / out_a
        d[3] = out_a

    def _paint(self, sdf, rgb, grow=0.0, alpha=1.0):
        """Paints every pixel whose signed distance to the shape is <= grow.

        `sdf(x, y)` returns distance in final-image pixels; negative inside.
        Coverage is feathered over one output pixel, which is then converted
        into supersampled units — getting this scaling wrong yields either hard
        aliased edges or a 3px smeared halo.
        """
        for y in range(self.h):
            fy = (y + 0.5) / SS
            row = y * self.w
            for x in range(self.w):
                d = sdf((x + 0.5) / SS, fy) - grow
                cov = min(max(0.5 - d * SS, 0.0), 1.0)
                if cov > 0.0:
                    self._blend(x, y, rgb, cov * alpha)

    # -- primitives (coordinates are in final-image pixels) --
    # `grow` expands the shape outward. All three primitives must honour it or
    # the outline pass silently draws nothing and sprites read as flat blobs.
    def disc(self, cx, cy, r, rgb, grow=0.0, alpha=1.0):
        rr = r + grow
        self._paint(lambda x, y: math.hypot(x - cx, y - cy) - rr, rgb, alpha=alpha)

    def capsule(self, x1, y1, x2, y2, r, rgb, grow=0.0, alpha=1.0):
        rr = r + grow

        def sdf(x, y):
            pax, pay = x - x1, y - y1
            bax, bay = x2 - x1, y2 - y1
            denom = bax * bax + bay * bay
            h = 0.0 if denom == 0 else min(max((pax * bax + pay * bay) / denom, 0.0), 1.0)
            return math.hypot(pax - bax * h, pay - bay * h) - rr

        self._paint(sdf, rgb, alpha=alpha)

    def box(self, x0, y0, x1, y1, rgb, grow=0.0, alpha=1.0):
        # Grow is handled inside the sdf here (not passed to _paint) so the
        # expansion stays symmetric on both axes.
        self._paint(
            lambda x, y: max(abs(x - (x0 + x1) / 2) - (abs(x1 - x0) / 2),
                             abs(y - (y0 + y1) / 2) - (abs(y1 - y0) / 2)),
            rgb, grow=grow, alpha=alpha,
        )

    def arc(self, cx, cy, r_in, r_out, half_angle_deg, rgb, alpha=1.0):
        """Upward-facing arc band centred on (cx, cy), symmetric about -Y."""
        half = math.radians(half_angle_deg)
        reach = r_out + 2.0

        def sdf(x, y):
            dx, dy = x - cx, y - cy
            dist = math.hypot(dx, dy)
            radial = max(r_in - dist, dist - r_out)
            # Angle measured from straight up (-Y).
            ang = abs(math.atan2(dx, -dy))
            angular = max(0.0, ang - half) * dist
            if dist > reach:
                return dist - reach
            return max(radial, angular)

        self._paint(sdf, rgb, alpha=alpha)

    def to_png(self, path):
        rows = []
        for oy in range(self.out_h):
            for ox in range(self.out_w):
                r = g = b = a = 0.0
                for sy in range(SS):
                    base = (oy * SS + sy) * self.w + ox * SS
                    for sx in range(SS):
                        p = self.buf[base + sx]
                        pa = p[3]
                        # Accumulate straight-alpha colour weighted by coverage.
                        # Averaging colours directly (without the pa weight)
                        # bleeds the transparent-black backdrop into every edge
                        # pixel and makes the whole sprite read as near-black.
                        r += p[0] * pa
                        g += p[1] * pa
                        b += p[2] * pa
                        a += pa
                n = float(SS * SS)
                a /= n
                if a > 0.0001:
                    # Divide by n as well: `a` is a coverage fraction, but the
                    # colour sums still carry SS*SS samples. Forgetting the /n
                    # scales every channel by 9 and clips the sprite to white.
                    r, g, b = r / a / n, g / a / n, b / a / n
                else:
                    r = g = b = 0.0
                rows.append((min(max(r * 255.0, 0), 255),
                             min(max(g * 255.0, 0), 255),
                             min(max(b * 255.0, 0), 255),
                             min(max(a * 255.0, 0), 255)))

        raw = bytearray()
        for y in range(self.out_h):
            raw.append(0)  # filter type 0 (None)
            for x in range(self.out_w):
                raw += bytes(int(v + 0.5) for v in rows[y * self.out_w + x])

        def chunk(tag, data):
            out = struct.pack(">I", len(data)) + tag + data
            return out + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

        png = (b"\x89PNG\r\n\x1a\n"
               + chunk(b"IHDR", struct.pack(">IIBBBBB", self.out_w, self.out_h,
                                             8, 6, 0, 0, 0))
               + chunk(b"IDAT", zlib.compress(bytes(raw), 9))
               + chunk(b"IEND", b""))
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "wb") as fh:
            fh.write(png)
        return path


def _outline_pass(canvas, shapes, width, rgb):
    for fn in shapes:
        fn(canvas, rgb, width)


# --------------------------------------------------------------------------
# Player: 32x40, a hooded figure with a forward crest so facing is readable
# --------------------------------------------------------------------------
def build_player():
    c = Canvas(32, 40)
    STEEL = (0.24, 0.45, 0.70)
    STEEL_HI = (0.36, 0.61, 0.88)
    CREST = (0.50, 0.89, 1.00)
    DARK = (0.09, 0.14, 0.23)

    body = [
        lambda cv, c_, g: cv.capsule(16, 34, 16, 19, 9.5, c_, g),   # cloak
        lambda cv, c_, g: cv.disc(16, 13, 7.0, c_, g),              # head
        lambda cv, c_, g: cv.capsule(16, 10, 16, 3, 3.2, c_, g),    # crest
        lambda cv, c_, g: cv.disc(7.5, 21, 4.2, c_, g),            # shoulder L
        lambda cv, c_, g: cv.disc(24.5, 21, 4.2, c_, g),           # shoulder R
    ]
    _outline_pass(c, body, 2.6, DARK)

    c.capsule(16, 34, 16, 19, 9.5, STEEL)
    c.disc(7.5, 21, 4.2, STEEL)
    c.disc(24.5, 21, 4.2, STEEL)
    c.disc(16, 13, 7.0, STEEL_HI)
    c.capsule(16, 10, 16, 3, 3.2, CREST)
    # chest sigil
    c.disc(16, 25, 2.6, CREST, alpha=0.9)
    return c.to_png(os.path.join("assets", "sprites", "player.png"))


# --------------------------------------------------------------------------
# Enemy: 28x30, a three-eyed blob
# --------------------------------------------------------------------------
def build_enemy():
    c = Canvas(28, 30)
    HIDE = (0.72, 0.24, 0.21)
    HIDE_HI = (0.88, 0.36, 0.28)
    EYE = (1.00, 0.90, 0.55)
    DARK = (0.22, 0.07, 0.06)

    body = [
        lambda cv, c_, g: cv.disc(14, 19, 11.0, c_, g),            # belly
        lambda cv, c_, g: cv.box(3, 19, 25, 28, c_, g),           # flat base
        lambda cv, c_, g: cv.disc(8, 8, 3.2, c_, g),              # spike L
        lambda cv, c_, g: cv.disc(14, 5, 3.6, c_, g),             # spike C
        lambda cv, c_, g: cv.disc(20, 8, 3.2, c_, g),             # spike R
    ]
    _outline_pass(c, body, 2.6, DARK)

    c.disc(14, 19, 11.0, HIDE)
    c.box(3, 19, 25, 28, HIDE)
    c.disc(8, 8, 3.2, HIDE)
    c.disc(14, 5, 3.6, HIDE)
    c.disc(20, 8, 3.2, HIDE)
    c.disc(11, 15, 10.0, HIDE_HI, alpha=0.45)                     # soft highlight
    for ex in (9.5, 18.5):
        c.disc(ex, 16, 2.3, EYE)
    return c.to_png(os.path.join("assets", "sprites", "enemy.png"))


# --------------------------------------------------------------------------
# Swing arc: 96x96, upward-facing band placed under the actor's Body node
# --------------------------------------------------------------------------
def build_swing():
    c = Canvas(96, 96)
    # Near-opaque core with a soft cyan halo. Painted bright here rather than
    # boosted via `modulate` at runtime: the gl_compatibility renderer clamps
    # modulate above 1.0, so an over-bright tint silently does nothing.
    core = (0.72, 0.97, 1.00)
    c.arc(48, 52, 30.0, 46.0, 60.0, core, alpha=0.34)
    c.arc(48, 52, 35.0, 45.0, 58.0, core, alpha=0.52)
    c.arc(48, 52, 39.5, 44.0, 55.0, (0.88, 1.00, 1.00), alpha=0.80)
    c.arc(48, 52, 41.0, 43.0, 52.0, (1.00, 1.00, 1.00), alpha=0.95)
    return c.to_png(os.path.join("assets", "sprites", "swing.png"))


if __name__ == "__main__":
    for built in (build_player(), build_enemy(), build_swing()):
        size = os.path.getsize(built)
        print("  wrote %-34s %6d bytes" % (built.replace("\\", "/"), size))
