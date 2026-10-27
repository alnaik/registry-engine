"""Assemble PNG screenshots into an animated PNG (APNG), stdlib only.

Usage: python3 -I scripts/docs/apng.py <out.png> <frames.json>
frames.json: [{"file": "f001.png", "ms": 400}, ...] — every frame must have
the same size and color type (screenshots from one browser session do).
Consecutive identical frames are merged into one longer frame. Each frame
is cropped to the rectangle that changed since the previous one, so a
mostly static UI animation stays small.
"""
import json
import struct
import sys
import zlib


def chunks(data):
    pos = 8
    while pos < len(data):
        length = struct.unpack(">I", data[pos:pos + 4])[0]
        kind = data[pos + 4:pos + 8]
        yield kind, data[pos + 8:pos + 8 + length]
        pos += 12 + length


def chunk(kind, body):
    return struct.pack(">I", len(body)) + kind + body + struct.pack(">I", zlib.crc32(kind + body) & 0xFFFFFFFF)


def decode(path):
    data = open(path, "rb").read()
    ihdr, idat = None, b""
    for kind, body in chunks(data):
        if kind == b"IHDR":
            ihdr = body
        elif kind == b"IDAT":
            idat += body
    w, h, depth, ctype = struct.unpack(">IIBB", ihdr[:10])
    if depth != 8 or ctype not in (2, 6) or ihdr[12] != 0:
        sys.exit(f"{path}: need 8-bit RGB/RGBA, non-interlaced")
    bpp = 3 if ctype == 2 else 4
    raw = zlib.decompress(idat)
    stride = w * bpp
    rows, prev = [], bytearray(stride)
    for y in range(h):
        f = raw[y * (stride + 1)]
        line = bytearray(raw[y * (stride + 1) + 1:(y + 1) * (stride + 1)])
        for x in range(stride):
            a = line[x - bpp] if x >= bpp else 0
            b = prev[x]
            c = prev[x - bpp] if x >= bpp else 0
            if f == 1:
                line[x] = (line[x] + a) & 255
            elif f == 2:
                line[x] = (line[x] + b) & 255
            elif f == 3:
                line[x] = (line[x] + ((a + b) >> 1)) & 255
            elif f == 4:
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                line[x] = (line[x] + (a if pa <= pb and pa <= pc else b if pb <= pc else c)) & 255
        rows.append(bytes(line))
        prev = line
    return ihdr, w, h, bpp, rows


def encode(rows, x0, x1, bpp):
    return zlib.compress(b"".join(b"\x00" + r[x0 * bpp:x1 * bpp] for r in rows), 9)


def main():
    out, spec = sys.argv[1], json.load(open(sys.argv[2]))
    frames = []   # [ihdr, w, h, bpp, rows, ms]
    for f in spec:
        ihdr, w, h, bpp, rows = decode(f["file"])
        if frames and rows == frames[-1][4]:
            frames[-1][5] += f["ms"]
            continue
        if frames and (w, h, bpp) != tuple(frames[0][1:4]):
            sys.exit(f"{f['file']}: size/color differs from the first frame")
        frames.append([ihdr, w, h, bpp, rows, f["ms"]])

    ihdr, w, h, bpp = frames[0][:4]
    png = [b"\x89PNG\r\n\x1a\n", chunk(b"IHDR", ihdr), chunk(b"acTL", struct.pack(">II", len(frames), 0))]
    seq = 0
    for i, (_, _, _, _, rows, ms) in enumerate(frames):
        if i == 0:
            x0, y0, x1, y1 = 0, 0, w, h
        else:
            before = frames[i - 1][4]
            changed = [y for y in range(h) if rows[y] != before[y]]
            if not changed:
                changed = [0]
            y0, y1 = changed[0], changed[-1] + 1
            x0, x1 = w, 0
            for y in range(y0, y1):
                a, b = rows[y], before[y]
                if a == b:
                    continue
                lo = next(k for k in range(0, len(a), bpp) if a[k:k + bpp] != b[k:k + bpp]) // bpp
                hi = next(k for k in range(len(a) - bpp, -1, -bpp) if a[k:k + bpp] != b[k:k + bpp]) // bpp + 1
                x0, x1 = min(x0, lo), max(x1, hi)
            if x1 <= x0:
                x0, x1 = 0, 1
        png.append(chunk(b"fcTL", struct.pack(">IIIIIHHBB", seq, x1 - x0, y1 - y0, x0, y0, ms, 1000, 0, 0)))
        seq += 1
        data = encode(rows[y0:y1], x0, x1, bpp)
        if i == 0:
            png.append(chunk(b"IDAT", data))
        else:
            png.append(chunk(b"fdAT", struct.pack(">I", seq) + data))
            seq += 1
    png.append(chunk(b"IEND", b""))
    open(out, "wb").write(b"".join(png))
    print(f"{out}: {len(frames)} frames, {sum(len(p) for p in png) / 1e6:.2f} MB")


if __name__ == "__main__":
    main()
