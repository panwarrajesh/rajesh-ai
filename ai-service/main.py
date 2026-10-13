import asyncio
import json
import logging

from dotenv import load_dotenv

load_dotenv()

from fastapi import FastAPI, File, HTTPException, UploadFile  # noqa: E402
from fastapi.responses import StreamingResponse  # noqa: E402
from pydantic import BaseModel, Field  # noqa: E402

from extract import ExtractError, extract  # noqa: E402
from images import prepare_image_b64  # noqa: E402
from providers.base import ProviderError  # noqa: E402
from providers.ollama import OllamaProvider  # noqa: E402
from providers.openai_compat import OpenAICompatProvider  # noqa: E402
from providers.pytorch_gpt import PyTorchGPTProvider  # noqa: E402

log = logging.getLogger("rajesh-ai")
app = FastAPI(title="Rajesh AI service")

PROVIDERS = {p.id: p for p in (OllamaProvider(), OpenAICompatProvider(), PyTorchGPTProvider())}
MAX_UPLOAD = 30 * 1024 * 1024


class Msg(BaseModel):
    role: str
    content: str
    images: list[str] | None = None      # base64 image bytes
    image_text: str | None = None        # OCR text for those images


class ChatRequest(BaseModel):
    provider: str | None = None
    model: str | None = None
    messages: list[Msg]
    temperature: float = Field(0.7, ge=0, le=2)


def sse(obj: dict) -> str:
    return f"data: {json.dumps(obj, ensure_ascii=False)}\n\n"


async def prepare_messages(provider, model: str, msgs: list[Msg]) -> tuple[list[dict], str | None]:
    """Capability check + graceful fallback: only vision models receive pixels; others get OCR text."""
    has_images = any(m.images for m in msgs)
    vision = False
    if has_images:
        listed = await provider.list_models()
        vision = next((m["capabilities"]["vision"] for m in listed if m["id"] == model), False)
    out = []
    for m in msgs:
        content = m.content
        d: dict = {"role": m.role}
        sees = vision and bool(m.images)
        if sees:
            d["images"] = [await asyncio.to_thread(prepare_image_b64, b) for b in m.images]
        if m.image_text:
            if sees:
                content += f"\n\n[Text found in the attached image(s) by OCR; may contain errors]\n{m.image_text}"
            else:
                content += ("\n\n[The user attached image(s), but you cannot see them. Do not describe or guess what "
                            "they show; say you cannot view the picture. Only this OCR text is available]\n"
                            f"{m.image_text}")
        d["content"] = content
        out.append(d)
    notice = None
    if has_images and not vision:
        notice = (f"{model} can't see images, so only text found by OCR was used. "
                  "Pick a vision model in Settings (for example, pull one with Ollama such as qwen2.5vl or llava).")
    return out, notice


@app.get("/health")
async def health():
    return {"ok": True}


@app.get("/models")
async def models():
    return {"providers": await asyncio.gather(*(p.describe() for p in PROVIDERS.values()))}


@app.post("/extract")
async def extract_file(file: UploadFile = File(...)):
    data = await file.read()
    if len(data) > MAX_UPLOAD:
        raise HTTPException(413, "File is too large.")
    try:
        return await asyncio.to_thread(extract, file.filename or "file", data)
    except ExtractError as e:
        raise HTTPException(e.status, str(e)) from e
    except Exception as e:  # noqa: BLE001
        log.exception("extract failed")
        raise HTTPException(500, f"Could not process this file: {e}") from e


@app.post("/chat/stream")
async def chat_stream(req: ChatRequest):
    async def gen():
        try:
            provider = PROVIDERS.get(req.provider or "")
            model = req.model
            if provider is None:  # graceful fallback: first provider that works
                for p in PROVIDERS.values():
                    info = await p.describe()
                    if info["available"]:
                        provider, model = p, info["models"][0]["id"]
                        break
                if provider is None:
                    raise ProviderError("No AI provider is available. Start Ollama (`ollama serve`) or set an API key.")
            if not model:
                model = (await provider.list_models())[0]["id"]
            messages, notice = await prepare_messages(provider, model, req.messages)
            if notice:
                yield sse({"type": "notice", "message": notice})
            async for token in provider.stream(model, messages, req.temperature):
                yield sse({"type": "token", "content": token})
            yield sse({"type": "done"})
        except ProviderError as e:
            yield sse({"type": "error", "message": str(e)})
        except Exception as e:  # noqa: BLE001
            log.exception("Unexpected error")
            yield sse({"type": "error", "message": f"Unexpected error in AI service: {e}"})

    return StreamingResponse(gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
