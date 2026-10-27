import asyncio
import base64
import hmac
import json
import logging
import os
import shutil
import tempfile
import time
import uuid

from dotenv import load_dotenv

load_dotenv()

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile  # noqa: E402
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse  # noqa: E402
from pydantic import BaseModel, Field  # noqa: E402

import imaging  # noqa: E402
import imageops  # noqa: E402
from extract import ExtractError, extract  # noqa: E402
from media_edit import edit_media  # noqa: E402
from images import prepare_image_b64  # noqa: E402
from media import Cancelled, MediaError, process_media  # noqa: E402
from providers.base import ProviderError  # noqa: E402
from providers.ollama import OllamaProvider  # noqa: E402
from providers.openai_compat import OpenAICompatProvider  # noqa: E402
from providers.pytorch_gpt import PyTorchGPTProvider  # noqa: E402

log = logging.getLogger("rajesh-ai")
app = FastAPI(title="Rajesh AI service")


@app.middleware("http")
async def internal_token(request: Request, call_next):
    """If INTERNAL_TOKEN is set, only callers that know it (the backend) may use this service."""
    token = os.getenv("INTERNAL_TOKEN", "")
    if token and request.url.path != "/health" and not hmac.compare_digest(request.headers.get("x-internal-token", ""), token):
        return JSONResponse({"detail": "Unauthorized"}, status_code=401)
    return await call_next(request)


PROVIDERS = {p.id: p for p in (OllamaProvider(), OpenAICompatProvider(), PyTorchGPTProvider())}
MAX_UPLOAD = 30 * 1024 * 1024
JOBS: dict[str, dict] = {}
_TASKS: set = set()
MEDIA_SEM = asyncio.Semaphore(1)  # one heavy transcription at a time


class Msg(BaseModel):
    role: str
    content: str
    images: list[str] | None = None      # base64 image bytes
    image_text: str | None = None        # OCR text for those images
    tool_calls: list[dict] | None = None  # assistant asked for tools
    tool_call_id: str | None = None       # tool result
    name: str | None = None


class ChatRequest(BaseModel):
    provider: str | None = None
    model: str | None = None
    messages: list[Msg]
    temperature: float = Field(0.7, ge=0, le=2)
    tools: list[dict] | None = None      # OpenAI-style function schemas


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
                content += f"\n\n[Details about the attached image(s)/video frames. OCR text may contain errors]\n{m.image_text}"
            else:
                content += ("\n\n[The user attached image(s) or video frames, but you cannot see them. Do not describe or guess "
                            "what they show; say you cannot view them. Only this text is available]\n"
                            f"{m.image_text}")
        d["content"] = content
        if m.tool_calls:
            d["tool_calls"] = m.tool_calls
        if m.tool_call_id:
            d["tool_call_id"] = m.tool_call_id
        if m.name:
            d["name"] = m.name
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


async def resolve(req: ChatRequest):
    provider = PROVIDERS.get(req.provider or "")
    model = req.model
    if provider is None:  # graceful fallback: first provider that works
        for p in PROVIDERS.values():
            info = await p.describe()
            if info["available"]:
                return p, info["models"][0]["id"]
        raise ProviderError("No AI provider is available. Start Ollama (`ollama serve`) or set an API key.")
    if not model:
        model = (await provider.list_models())[0]["id"]
    return provider, model


@app.post("/chat/stream")
async def chat_stream(req: ChatRequest):
    async def gen():
        try:
            provider, model = await resolve(req)
            messages, notice = await prepare_messages(provider, model, req.messages)
            if notice:
                yield sse({"type": "notice", "message": notice})
            tools = req.tools
            if tools:  # capability check with graceful fallback
                listed = await provider.list_models()
                caps = next((m["capabilities"] for m in listed if m["id"] == model), {})
                if not caps.get("tools"):
                    yield sse({"type": "notice", "message": f"{model} can't use tools, so the calculator, memory and file "
                               "tools are off for this reply. Try a tool-capable model such as qwen2.5 or llama3.1."})
                    tools = None
            async for item in provider.stream(model, messages, req.temperature, tools):
                if isinstance(item, dict):
                    yield sse({"type": "tool_calls", "calls": item["tool_calls"]})
                else:
                    yield sse({"type": "token", "content": item})
            yield sse({"type": "done"})
        except ProviderError as e:
            yield sse({"type": "error", "message": str(e)})
        except Exception as e:  # noqa: BLE001
            log.exception("Unexpected error")
            yield sse({"type": "error", "message": f"Unexpected error in AI service: {e}"})

    return StreamingResponse(gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.post("/chat/complete")
async def chat_complete(req: ChatRequest):
    """Non-streaming call, used for map-reduce summaries of long files."""
    try:
        provider, model = await resolve(req)
        messages, _ = await prepare_messages(provider, model, req.messages)
        parts = [t async for t in provider.stream(model, messages, req.temperature) if isinstance(t, str)]
        return {"text": "".join(parts)}
    except ProviderError as e:
        raise HTTPException(502, str(e)) from e


# ---------------- audio / video jobs ----------------
def _drop_job(job_id: str) -> None:
    job = JOBS.pop(job_id, None)
    if job and job.get("outdir"):
        shutil.rmtree(job["outdir"], ignore_errors=True)


def _purge_jobs() -> None:
    for k in [k for k, j in JOBS.items() if time.time() - j["created"] > 3600]:
        _drop_job(k)


async def _run_job(job_id: str, tmp: str) -> None:
    job = JOBS[job_id]

    def cb(stage: str, frac: float) -> None:
        if job["cancel"]:
            raise Cancelled()
        job.update(stage=stage, progress=round(frac, 3))

    try:
        async with MEDIA_SEM:
            cb("Starting", 0.01)
            job["status"] = "running"
            job["result"] = await asyncio.to_thread(process_media, tmp, cb)
            job["status"] = "done"
    except Cancelled:
        job["status"] = "cancelled"
    except MediaError as e:
        job.update(status="failed", error=str(e))
    except Exception as e:  # noqa: BLE001
        log.exception("media job failed")
        job.update(status="failed", error=f"Processing failed: {e}")
    finally:
        try:
            os.remove(tmp)
        except OSError:
            pass


@app.post("/media/jobs")
async def media_start(file: UploadFile = File(...)):
    _purge_jobs()
    fd, tmp = tempfile.mkstemp(suffix=os.path.splitext(file.filename or "")[1])
    os.close(fd)

    def save():
        with open(tmp, "wb") as out:
            shutil.copyfileobj(file.file, out)

    await asyncio.to_thread(save)  # stream to disk, never hold a big video in memory
    job_id = uuid.uuid4().hex
    JOBS[job_id] = _new_job()
    _spawn(_run_job(job_id, tmp))
    return {"job_id": job_id}


def _new_job() -> dict:
    return {"status": "queued", "stage": "Queued", "progress": 0.0, "result": None, "error": None,
            "cancel": False, "created": time.time(), "outdir": None, "output": None}


def _spawn(coro) -> None:
    task = asyncio.create_task(coro)
    _TASKS.add(task)
    task.add_done_callback(_TASKS.discard)


async def _run_edit_job(job_id: str, tmp: str, op: str, params: dict, srt: str) -> None:
    job = JOBS[job_id]
    job["outdir"] = tempfile.mkdtemp(prefix="rajesh_edit_")

    def cb(stage: str, frac: float) -> None:
        if job["cancel"]:
            raise Cancelled()
        job.update(stage=stage, progress=round(frac, 3))

    try:
        async with MEDIA_SEM:
            cb("Starting", 0.01)
            job["status"] = "running"
            res = await asyncio.to_thread(edit_media, tmp, op, params, srt, job["outdir"], cb)
            job["output"] = res.pop("path")
            job["result"] = res
            job["status"] = "done"
    except Cancelled:
        job["status"] = "cancelled"
    except MediaError as e:
        job.update(status="failed", error=str(e))
    except Exception as e:  # noqa: BLE001
        log.exception("edit job failed")
        job.update(status="failed", error=f"Editing failed: {e}")
    finally:
        try:
            os.remove(tmp)
        except OSError:
            pass


@app.post("/media/edit")
async def media_edit_start(file: UploadFile = File(...), op: str = Form(...), params: str = Form("{}"), srt: str = Form("")):
    _purge_jobs()
    try:
        p = json.loads(params or "{}")
        if not isinstance(p, dict):
            raise ValueError
    except ValueError as e:
        raise HTTPException(422, "params must be a JSON object") from e
    fd, tmp = tempfile.mkstemp(suffix=os.path.splitext(file.filename or "")[1])
    os.close(fd)

    def save():
        with open(tmp, "wb") as out:
            shutil.copyfileobj(file.file, out)

    await asyncio.to_thread(save)
    job_id = uuid.uuid4().hex
    JOBS[job_id] = _new_job()
    _spawn(_run_edit_job(job_id, tmp, op, p, srt))
    return {"job_id": job_id}


@app.get("/media/jobs/{job_id}/output")
async def media_output(job_id: str):
    job = JOBS.get(job_id)
    if not job or job["status"] != "done" or not job.get("output"):
        raise HTTPException(404, "No output for this job")
    return FileResponse(job["output"], media_type=job["result"]["mime"])


@app.get("/media/jobs/{job_id}")
async def media_status(job_id: str):
    job = JOBS.get(job_id)
    if not job:
        raise HTTPException(404, "Unknown job")
    out = {k: job[k] for k in ("status", "stage", "progress", "error")}
    if job["status"] == "done":
        out["result"] = job["result"]
    return out


@app.delete("/media/jobs/{job_id}")
async def media_cancel(job_id: str):
    job = JOBS.get(job_id)
    if job:
        job["cancel"] = True
        if job["status"] in ("done", "failed", "cancelled"):
            _drop_job(job_id)
    return {"ok": True}


# ---------------- images: generation, AI edit, simple edits ----------------
class ImageGenRequest(BaseModel):
    prompt: str
    size: str = "square"
    negative_prompt: str = ""


def _image_json(data: bytes, mime: str) -> dict:
    return {"b64": base64.b64encode(data).decode(), "mime": mime}


@app.get("/image/status")
async def image_status():
    return await imaging.status()


@app.post("/image/generate")
async def image_generate(req: ImageGenRequest):
    try:
        return _image_json(*await imaging.generate(req.prompt, req.size, req.negative_prompt))
    except imaging.ImagingError as e:
        raise HTTPException(502, str(e)) from e


@app.post("/image/edit")
async def image_edit(image: UploadFile = File(...), prompt: str = Form(...), strength: float = Form(0.6)):
    data = await image.read()
    if len(data) > MAX_UPLOAD:
        raise HTTPException(413, "Image is too large.")
    try:
        return _image_json(*await imaging.edit(data, prompt, strength))
    except imaging.ImagingError as e:
        raise HTTPException(502, str(e)) from e


@app.post("/image/transform")
async def image_transform(image: UploadFile = File(...), ops: str = Form(...)):
    data = await image.read()
    if len(data) > MAX_UPLOAD:
        raise HTTPException(413, "Image is too large.")
    try:
        parsed = json.loads(ops)
        out, mime, w, h = await asyncio.to_thread(imageops.apply_ops, data, parsed)
    except json.JSONDecodeError as e:
        raise HTTPException(422, "ops must be valid JSON") from e
    except imageops.OpsError as e:
        raise HTTPException(422, str(e)) from e
    return {**_image_json(out, mime), "width": w, "height": h}
