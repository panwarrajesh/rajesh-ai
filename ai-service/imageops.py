"""Simple, deterministic image edits with Pillow (no AI, no GPU)."""
import io

from PIL import Image, ImageEnhance, ImageFilter, ImageOps

MAX_SIDE = 4096
ALLOWED = "resize, crop, rotate, flip, grayscale, brightness, contrast, saturation, blur, sharpen, format"


class OpsError(Exception):
    """User-presentable failure."""


def _num(o: dict, key: str, lo: float, hi: float, default=None) -> float:
    v = o.get(key, default)
    if v is None:
        raise OpsError(f"'{key}' is required for {o.get('op')}.")
    try:
        x = float(v)
    except (TypeError, ValueError) as e:
        raise OpsError(f"'{key}' must be a number.") from e
    if not lo <= x <= hi:
        raise OpsError(f"'{key}' must be between {lo:g} and {hi:g}.")
    return x


def _enhance(img: Image.Image, cls, factor: float) -> Image.Image:
    if img.mode in ("RGBA", "LA"):  # keep transparency untouched
        rgb, alpha = img.convert("RGB"), img.getchannel("A")
        out = cls(rgb).enhance(factor)
        out.putalpha(alpha)
        return out
    return cls(img.convert("RGB")).enhance(factor)


def apply_ops(data: bytes, ops: list[dict]) -> tuple[bytes, str, int, int]:
    if not isinstance(ops, list) or not ops:
        raise OpsError("Give at least one operation.")
    if len(ops) > 12:
        raise OpsError("At most 12 operations at a time.")
    try:
        img = Image.open(io.BytesIO(data))
        src_fmt = (img.format or "PNG").upper()
        img = ImageOps.exif_transpose(img)
        img.load()
    except Exception as e:  # noqa: BLE001
        raise OpsError("This image couldn't be opened.") from e
    out_fmt = src_fmt if src_fmt in ("PNG", "JPEG", "WEBP") else "PNG"
    quality = 90

    for o in ops:
        if not isinstance(o, dict):
            raise OpsError("Each operation must be an object like {\"op\": \"resize\", ...}.")
        op = str(o.get("op", "")).lower()
        if op == "resize":
            w, h = img.size
            if o.get("max_side") is not None:
                m = _num(o, "max_side", 16, MAX_SIDE)
                s = m / max(w, h)
                nw, nh = round(w * s), round(h * s)
            elif o.get("width") is not None and o.get("height") is not None:
                nw, nh = round(_num(o, "width", 1, MAX_SIDE)), round(_num(o, "height", 1, MAX_SIDE))
            elif o.get("width") is not None:
                nw = round(_num(o, "width", 1, MAX_SIDE)); nh = round(h * nw / w)
            elif o.get("height") is not None:
                nh = round(_num(o, "height", 1, MAX_SIDE)); nw = round(w * nh / h)
            else:
                raise OpsError("resize needs max_side, width or height.")
            if max(nw, nh) > MAX_SIDE or min(nw, nh) < 1:
                raise OpsError(f"The result would be {nw}x{nh}; the limit is {MAX_SIDE}px per side.")
            img = img.resize((nw, nh), Image.LANCZOS)
        elif op == "crop":
            w, h = img.size
            l, t, r, b = (_num(o, k, 0, 90, 0) for k in ("left", "top", "right", "bottom"))
            box = (round(w * l / 100), round(h * t / 100), w - round(w * r / 100), h - round(h * b / 100))
            if box[2] - box[0] < 1 or box[3] - box[1] < 1:
                raise OpsError("That crop would remove the whole image.")
            img = img.crop(box)
        elif op == "rotate":
            d = _num(o, "degrees", -360, 360)
            if d % 90 == 0:
                steps = int(d // 90) % 4
                img = img.transpose({0: None, 1: Image.ROTATE_90, 2: Image.ROTATE_180, 3: Image.ROTATE_270}[steps]) if steps else img
            else:
                img = img.convert("RGBA").rotate(d, expand=True, resample=Image.BICUBIC)
        elif op == "flip":
            direction = str(o.get("direction", "horizontal")).lower()
            if direction not in ("horizontal", "vertical"):
                raise OpsError("flip direction must be horizontal or vertical.")
            img = ImageOps.mirror(img) if direction == "horizontal" else ImageOps.flip(img)
        elif op == "grayscale":
            alpha = img.getchannel("A") if img.mode in ("RGBA", "LA") else None
            img = ImageOps.grayscale(img).convert("RGB")
            if alpha:
                img.putalpha(alpha)
        elif op in ("brightness", "contrast", "saturation"):
            cls = {"brightness": ImageEnhance.Brightness, "contrast": ImageEnhance.Contrast,
                   "saturation": ImageEnhance.Color}[op]
            img = _enhance(img, cls, _num(o, "factor", 0.1, 3))
        elif op == "blur":
            img = img.filter(ImageFilter.GaussianBlur(_num(o, "radius", 0.1, 20, 2)))
        elif op == "sharpen":
            img = img.filter(ImageFilter.UnsharpMask(radius=2, percent=150, threshold=3))
        elif op == "format":
            f = str(o.get("format", "")).lower().replace("jpg", "jpeg")
            if f not in ("png", "jpeg", "webp"):
                raise OpsError("format must be png, jpeg or webp.")
            out_fmt = f.upper()
            if o.get("quality") is not None:
                quality = int(_num(o, "quality", 30, 100))
        else:
            raise OpsError(f"Unknown operation '{op}'. Available: {ALLOWED}.")

    if out_fmt == "JPEG":
        if img.mode in ("RGBA", "LA", "P"):
            rgba = img.convert("RGBA")
            bg = Image.new("RGB", rgba.size, "white")
            bg.paste(rgba, mask=rgba.getchannel("A"))
            img = bg
        else:
            img = img.convert("RGB")
    buf = io.BytesIO()
    kwargs = {"quality": quality} if out_fmt in ("JPEG", "WEBP") else {}
    img.save(buf, out_fmt, **kwargs)
    mime = {"PNG": "image/png", "JPEG": "image/jpeg", "WEBP": "image/webp"}[out_fmt]
    return buf.getvalue(), mime, img.width, img.height
