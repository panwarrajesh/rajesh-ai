import base64
import io
import os

from PIL import Image, ImageOps


def prepare_image_b64(b64: str) -> str:
    """Fix rotation, flatten transparency, shrink, and re-encode as JPEG for the model."""
    max_side = int(os.getenv("MAX_IMAGE_SIDE", "1568"))
    img = ImageOps.exif_transpose(Image.open(io.BytesIO(base64.b64decode(b64))))
    if img.mode in ("RGBA", "LA", "P"):
        img = img.convert("RGBA")
        bg = Image.new("RGB", img.size, "white")
        bg.paste(img, mask=img.split()[-1])
        img = bg
    else:
        img = img.convert("RGB")
    img.thumbnail((max_side, max_side))
    out = io.BytesIO()
    img.save(out, "JPEG", quality=88)
    return base64.b64encode(out.getvalue()).decode()
