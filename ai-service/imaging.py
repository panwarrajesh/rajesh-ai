"""Image generation / AI image editing through a pluggable backend.

  IMAGE_PROVIDER=openai  any OpenAI-compatible /images API (hosted)         needs IMAGE_API_KEY or OPENAI_API_KEY
  IMAGE_PROVIDER=a1111   a local Stable Diffusion WebUI started with --api  needs A1111_URL
Nothing here runs a model itself, so no GPU is needed in this service.
"""
import base64
import io
import os

import httpx


class ImagingError(Exception):
    """User-presentable failure."""


def provider() -> str:
    p = os.getenv("IMAGE_PROVIDER", "").strip().lower()
    if p in ("openai", "a1111"):
        return p
    if p in ("none", "off"):
        return ""
    if os.getenv("A1111_URL"):
        return "a1111"
    if os.getenv("IMAGE_API_KEY") or os.getenv("OPENAI_API_KEY"):
        return "openai"
    return ""


def _openai():
    base = (os.getenv("IMAGE_BASE_URL") or os.getenv("OPENAI_BASE_URL") or "https://api.openai.com/v1").rstrip("/")
    key = os.getenv("IMAGE_API_KEY") or os.getenv("OPENAI_API_KEY", "")
    return base, key, os.getenv("IMAGE_MODEL") or "gpt-image-1"


def _a1111_url() -> str:
    return (os.getenv("A1111_URL") or "http://localhost:7860").rstrip("/")


def sniff(data: bytes) -> str:
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if data[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return "image/png"


def _err(r: httpx.Response) -> str:
    try:
        j = r.json()
        return str(j.get("error", {}).get("message") or j.get("detail") or j)[:300]
    except Exception:  # noqa: BLE001
        return (r.text or "")[:300]


async def status() -> dict:
    p = provider()
    if not p:
        return {"available": False, "provider": None, "can_edit": False,
                "message": "No image provider is configured. Set IMAGE_PROVIDER (openai or a1111) in ai-service/.env."}
    if p == "a1111":
        try:
            async with httpx.AsyncClient(timeout=4) as c:
                r = await c.get(f"{_a1111_url()}/sdapi/v1/options")
                r.raise_for_status()
        except httpx.HTTPError:
            return {"available": False, "provider": p, "can_edit": False,
                    "message": f"Can't reach Stable Diffusion WebUI at {_a1111_url()}. Start it with the --api option."}
        return {"available": True, "provider": p, "model": "Stable Diffusion WebUI", "can_edit": True, "message": None}
    base, key, model = _openai()
    if not key and base == "https://api.openai.com/v1":
        return {"available": False, "provider": p, "can_edit": False, "message": "Set IMAGE_API_KEY (or OPENAI_API_KEY)."}
    return {"available": True, "provider": p, "model": model, "can_edit": model.startswith("gpt-image"), "message": None}


def _openai_size(model: str, size: str) -> str:
    dalle = model.startswith("dall-e")
    table = {"square": "1024x1024", "landscape": "1792x1024" if dalle else "1536x1024",
             "portrait": "1024x1792" if dalle else "1024x1536"}
    return table.get(size, "1024x1024")


def _a1111_size(size: str) -> tuple[int, int]:
    b = int(os.getenv("A1111_BASE_SIZE", "768"))
    long = round(b * 4 / 3 / 64) * 64
    return {"landscape": (long, b), "portrait": (b, long)}.get(size, (b, b))


async def _image_from_item(client: httpx.AsyncClient, item: dict) -> bytes:
    if item.get("b64_json"):
        return base64.b64decode(item["b64_json"])
    if item.get("url"):
        r = await client.get(item["url"])
        r.raise_for_status()
        return r.content
    raise ImagingError("The image service returned no image.")


async def generate(prompt: str, size: str = "square", negative: str = "") -> tuple[bytes, str]:
    p = provider()
    if not p:
        raise ImagingError((await status())["message"])
    prompt = prompt.strip()[:4000]
    if not prompt:
        raise ImagingError("The image prompt is empty.")
    try:
        if p == "a1111":
            w, h = _a1111_size(size)
            payload = {"prompt": prompt, "negative_prompt": negative, "width": w, "height": h,
                       "steps": int(os.getenv("A1111_STEPS", "25")), "cfg_scale": 7}
            async with httpx.AsyncClient(timeout=600) as c:
                r = await c.post(f"{_a1111_url()}/sdapi/v1/txt2img", json=payload)
            if r.status_code != 200:
                raise ImagingError(f"Stable Diffusion returned {r.status_code}: {_err(r)}")
            data = base64.b64decode(r.json()["images"][0])
            return data, sniff(data)
        base, key, model = _openai()
        payload = {"model": model, "prompt": prompt, "n": 1, "size": _openai_size(model, size)}
        if model.startswith("dall-e"):
            payload["response_format"] = "b64_json"
        async with httpx.AsyncClient(timeout=180) as c:
            r = await c.post(f"{base}/images/generations", json=payload,
                             headers={"Authorization": f"Bearer {key}"} if key else {})
            if r.status_code != 200:
                raise ImagingError(f"Image API returned {r.status_code}: {_err(r)}")
            data = await _image_from_item(c, r.json()["data"][0])
        return data, sniff(data)
    except httpx.ConnectError as e:
        raise ImagingError("Couldn't connect to the image service.") from e
    except httpx.ReadTimeout as e:
        raise ImagingError("The image service took too long to respond.") from e


def _to_png(data: bytes, max_side: int = 1024) -> tuple[bytes, int, int]:
    from PIL import Image, ImageOps
    img = ImageOps.exif_transpose(Image.open(io.BytesIO(data))).convert("RGBA")
    img.thumbnail((max_side, max_side))
    out = io.BytesIO()
    img.save(out, "PNG")
    return out.getvalue(), img.width, img.height


async def edit(image: bytes, prompt: str, strength: float = 0.6) -> tuple[bytes, str]:
    p = provider()
    if not p:
        raise ImagingError((await status())["message"])
    prompt = prompt.strip()[:4000]
    if not prompt:
        raise ImagingError("Describe the change you want.")
    try:
        if p == "a1111":
            png, w, h = _to_png(image, int(os.getenv("A1111_MAX_EDIT_SIDE", "1024")))
            payload = {"init_images": [base64.b64encode(png).decode()], "prompt": prompt,
                       "denoising_strength": max(0.05, min(float(strength), 0.95)),
                       "width": max(64, w // 8 * 8), "height": max(64, h // 8 * 8),
                       "steps": int(os.getenv("A1111_STEPS", "25")), "cfg_scale": 7}
            async with httpx.AsyncClient(timeout=600) as c:
                r = await c.post(f"{_a1111_url()}/sdapi/v1/img2img", json=payload)
            if r.status_code != 200:
                raise ImagingError(f"Stable Diffusion returned {r.status_code}: {_err(r)}")
            data = base64.b64decode(r.json()["images"][0])
            return data, sniff(data)
        base, key, model = _openai()
        if not model.startswith("gpt-image"):
            raise ImagingError(f"The model '{model}' can't edit images. Set IMAGE_MODEL to an editing-capable model.")
        png, _, _ = _to_png(image)
        async with httpx.AsyncClient(timeout=180) as c:
            r = await c.post(f"{base}/images/edits", data={"model": model, "prompt": prompt},
                             files={"image": ("image.png", png, "image/png")},
                             headers={"Authorization": f"Bearer {key}"} if key else {})
            if r.status_code != 200:
                raise ImagingError(f"Image API returned {r.status_code}: {_err(r)}")
            data = await _image_from_item(c, r.json()["data"][0])
        return data, sniff(data)
    except httpx.ConnectError as e:
        raise ImagingError("Couldn't connect to the image service.") from e
    except httpx.ReadTimeout as e:
        raise ImagingError("The image service took too long to respond.") from e
