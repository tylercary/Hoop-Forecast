"""
Resize a headshot for the site: reads a PNG on stdin, writes a 520x380
palette PNG on stdout. Used by refreshPlayerHeadshots.js, which fetches
NBA.com's 1040x760 originals; 520x380 is twice the largest size the site
renders (the 230px player header) so it stays sharp on retina screens, and
the 256-colour palette keeps each file around 40 KB.

    python3 backend/scripts/resize_headshot.py < in.png > out.png

Requires Pillow (pip install pillow).
"""
import io
import sys

from PIL import Image

TARGET = (520, 380)

data = sys.stdin.buffer.read()
image = Image.open(io.BytesIO(data)).convert('RGBA')
if image.size != TARGET:
    image = image.resize(TARGET, Image.LANCZOS)
image = image.quantize(colors=256, method=Image.Quantize.FASTOCTREE)
out = io.BytesIO()
image.save(out, format='PNG', optimize=True)
sys.stdout.buffer.write(out.getvalue())
