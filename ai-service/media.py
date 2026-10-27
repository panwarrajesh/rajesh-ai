"""Audio/video processing: FFmpeg for metadata, frames and audio; faster-whisper for speech-to-text."""
import base64
import json
import os
import shutil
import subprocess
import tempfile
import threading
from pathlib import Path


class MediaError(Exception):
    """User-presentable failure."""


class Cancelled(Exception):
    pass


def _need(tool: str) -> None:
    if not shutil.which(tool):
        raise MediaError(f"{tool} isn't installed. Install FFmpeg from ffmpeg.org and make sure `{tool}` is on your PATH.")


def _fps(r: str | None) -> float | None:
    try:
        a, b = (r or "").split("/")
        return round(float(a) / float(b), 2) if float(b) else None
    except (ValueError, ZeroDivisionError):
        return None


def probe(path: str) -> dict:
    _need("ffprobe")
    r = subprocess.run(
        ["ffprobe", "-v", "error", "-print_format", "json", "-show_format", "-show_streams", path],
        capture_output=True, text=True, timeout=120,
    )
    if r.returncode != 0:
        raise MediaError("This file couldn't be read as audio or video. It may be corrupted or use an unsupported codec.")
    d = json.loads(r.stdout or "{}")
    streams = d.get("streams", [])
    video = next((s for s in streams if s.get("codec_type") == "video" and not s.get("disposition", {}).get("attached_pic")), None)
    audio = next((s for s in streams if s.get("codec_type") == "audio"), None)
    fmt = d.get("format", {})
    duration = float(fmt.get("duration") or (video or audio or {}).get("duration") or 0)
    return {
        "duration": round(duration, 2),
        "has_video": bool(video),
        "has_audio": bool(audio),
        "container": fmt.get("format_long_name"),
        "bitrate": int(fmt["bit_rate"]) if fmt.get("bit_rate") else None,
        "width": video.get("width") if video else None,
        "height": video.get("height") if video else None,
        "fps": _fps(video.get("r_frame_rate")) if video else None,
        "video_codec": video.get("codec_name") if video else None,
        "audio_codec": audio.get("codec_name") if audio else None,
    }


def extract_audio(path: str, out_wav: str) -> None:
    r = subprocess.run(
        ["ffmpeg", "-nostdin", "-v", "error", "-y", "-i", path, "-vn", "-ac", "1", "-ar", "16000",
         "-c:a", "pcm_s16le", out_wav],
        capture_output=True, text=True, timeout=7200,
    )
    if r.returncode != 0 or not os.path.exists(out_wav):
        raise MediaError("The audio track couldn't be extracted from this file.")


def grab_frame(path: str, t: float, out: str, width: int = 768) -> bool:
    r = subprocess.run(
        ["ffmpeg", "-nostdin", "-v", "error", "-y", "-ss", f"{t:.2f}", "-i", path, "-frames:v", "1",
         "-vf", f"scale=min({width}\\,iw):-2", "-q:v", "3", out],
        capture_output=True, timeout=120,
    )
    return r.returncode == 0 and os.path.exists(out) and os.path.getsize(out) > 0


def frame_times(duration: float, n: int) -> list[float]:
    n = max(1, min(n, int(duration)))  # at most one frame per second of video
    return [round(duration * (i + 0.5) / n, 2) for i in range(n)]


_model = None
_model_lock = threading.Lock()


def _whisper():
    global _model
    with _model_lock:
        if _model is None:
            from faster_whisper import WhisperModel
            _model = WhisperModel(os.getenv("WHISPER_MODEL") or "small",
                                  device=os.getenv("WHISPER_DEVICE") or "auto",
                                  compute_type=os.getenv("WHISPER_COMPUTE") or "auto")
        return _model


def transcribe(wav: str, duration: float, on_progress) -> tuple[str, float, list[dict]]:
    model = _whisper()
    segments, info = model.transcribe(wav, language=os.getenv("WHISPER_LANGUAGE") or None,
                                      vad_filter=True, beam_size=5)
    out = []
    for seg in segments:  # lazy generator: this is where the time is spent
        text = seg.text.strip()
        if text:
            out.append({"start": round(seg.start, 2), "end": round(seg.end, 2), "text": text})
        if duration:
            on_progress(min(seg.end / duration, 1.0))
    return info.language, round(info.language_probability, 3), out


def _b64(path: str) -> str:
    return base64.b64encode(Path(path).read_bytes()).decode()


def process_media(path: str, cb) -> dict:
    """cb(stage, overall_fraction) reports progress and may raise Cancelled."""
    cb("Inspecting file", 0.02)
    meta = probe(path)
    max_min = float(os.getenv("MAX_MEDIA_MINUTES", "240"))
    if meta["duration"] > max_min * 60:
        raise MediaError(f"This file is {meta['duration'] / 60:.0f} minutes long; the limit is {max_min:.0f} minutes (MAX_MEDIA_MINUTES).")
    warnings: list[str] = []
    result = {"kind": "video" if meta["has_video"] else "audio", "meta": meta, "language": None,
              "segments": [], "thumbnail": None, "frames": [], "warnings": warnings}
    tmp = tempfile.mkdtemp(prefix="rajesh_media_")
    try:
        # ---- frames (video only)
        if meta["has_video"] and meta["duration"] > 0:
            cb("Extracting frames", 0.05)
            thumb = os.path.join(tmp, "thumb.jpg")
            if grab_frame(path, min(meta["duration"] * 0.1, 3), thumb, 480):
                result["thumbnail"] = _b64(thumb)
            times = frame_times(meta["duration"], int(os.getenv("VIDEO_FRAMES", "8")))
            for i, t in enumerate(times):
                cb("Extracting frames", 0.05 + 0.15 * (i / len(times)))
                f = os.path.join(tmp, f"f{i}.jpg")
                if not grab_frame(path, t, f):
                    continue
                ocr = ""
                try:  # text visible in the frame (slides, screen recordings)
                    from PIL import Image
                    from extract import _ocr_image
                    ocr, _ = _ocr_image(Image.open(f).convert("RGB"))
                except Exception:  # noqa: BLE001
                    pass
                result["frames"].append({"t": t, "b64": _b64(f), "ocr": ocr[:600]})
        # ---- speech
        if not meta["has_audio"]:
            warnings.append("This file has no audio track, so there is no transcript.")
        else:
            wav = os.path.join(tmp, "audio.wav")
            cb("Extracting audio", 0.2)
            extract_audio(path, wav)
            try:
                import faster_whisper  # noqa: F401
            except ImportError:
                warnings.append("Transcription is unavailable: run `pip install faster-whisper` in the AI service.")
            else:
                cb("Loading speech model (first run downloads it)", 0.22)
                _whisper()
                lang, prob, segs = transcribe(wav, meta["duration"], lambda f: cb("Transcribing speech", 0.25 + 0.75 * f))
                result["language"] = {"code": lang, "probability": prob}
                result["segments"] = segs
                if not segs:
                    warnings.append("No speech was detected.")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    cb("Done", 1.0)
    return result
