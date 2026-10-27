"""Video / audio editing with FFmpeg. Arguments are validated numbers and enums; no shell is ever used."""
import os
import re
import subprocess

from media import Cancelled, MediaError, _need, probe

OPS = "trim, extract_audio, compress, resize, gif, speed, burn_subtitles"
_PROGRESS = re.compile(r"^(frame|fps|stream_\d+_\d+_q|bitrate|total_size|out_time|out_time_ms|out_time_us|dup_frames|drop_frames|speed|progress)=")


def _num(p: dict, key: str, lo: float, hi: float, default=None) -> float:
    v = p.get(key)
    if v is None or v == "":
        if default is None:
            raise MediaError(f"'{key}' is required.")
        return default
    try:
        x = float(v)
    except (TypeError, ValueError) as e:
        raise MediaError(f"'{key}' must be a number.") from e
    if not lo <= x <= hi:
        raise MediaError(f"'{key}' must be between {lo:g} and {hi:g}.")
    return x


def _run(args: list[str], expected: float, cb, stage: str, cwd: str | None = None) -> None:
    proc = subprocess.Popen(["ffmpeg", "-nostdin", "-v", "error", "-y", "-progress", "pipe:1", "-nostats", *args],
                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, cwd=cwd)
    errors: list[str] = []
    try:
        for line in proc.stdout:
            line = line.strip()
            if line.startswith("out_time_us="):
                try:
                    cb(stage, min(int(line.split("=", 1)[1]) / 1e6 / max(expected, 0.1), 0.99))
                except ValueError:
                    pass
            elif line and not _PROGRESS.match(line):
                errors.append(line)
    except Cancelled:
        proc.kill()
        raise
    finally:
        proc.stdout.close()
        proc.wait()
    if proc.returncode != 0:
        raise MediaError("FFmpeg could not do this edit: " + " ".join(errors)[-300:])


def _atempo(f: float) -> str:
    parts = []
    while f > 2.0:
        parts.append("atempo=2.0"); f /= 2.0
    while f < 0.5:
        parts.append("atempo=0.5"); f /= 0.5
    parts.append(f"atempo={f:.4f}")
    return ",".join(parts)


def _has_filter(name: str) -> bool:
    out = subprocess.run(["ffmpeg", "-hide_banner", "-filters"], capture_output=True, text=True).stdout
    return any(re.search(rf"\s{name}\s", line) for line in out.splitlines())


def edit_media(src: str, op: str, p: dict, srt: str, outdir: str, cb) -> dict:
    _need("ffmpeg")
    src = os.path.abspath(src)
    meta = probe(src)
    dur, hv, ha = meta["duration"], meta["has_video"], meta["has_audio"]
    if not (hv or ha):
        raise MediaError("This file has no audio or video.")
    out = lambda ext: os.path.join(outdir, "output" + ext)  # noqa: E731
    vcodec = ["-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p"]
    cb("Starting edit", 0.02)

    if op == "trim":
        start = _num(p, "start", 0, max(dur - 0.1, 0), 0)
        end = _num(p, "end", 0.1, dur + 1, dur)
        if end <= start:
            raise MediaError("'end' must be after 'start'.")
        if hv:
            args = ["-ss", f"{start}", "-to", f"{end}", "-i", src, *vcodec, "-crf", "23", "-c:a", "aac",
                    "-movflags", "+faststart", out(".mp4")]
            ext, mime = ".mp4", "video/mp4"
        else:
            args = ["-ss", f"{start}", "-to", f"{end}", "-i", src, "-c:a", "libmp3lame", "-q:a", "2", out(".mp3")]
            ext, mime = ".mp3", "audio/mpeg"
        expected = end - start
    elif op == "extract_audio":
        if not ha:
            raise MediaError("This file has no audio track.")
        args = ["-i", src, "-vn", "-c:a", "libmp3lame", "-q:a", "2", out(".mp3")]
        ext, mime, expected = ".mp3", "audio/mpeg", dur
    elif op == "compress":
        if not hv:
            raise MediaError("Compression needs a video file.")
        crf = int(_num(p, "crf", 18, 40, 28))
        args = ["-i", src]
        if p.get("max_height") not in (None, ""):
            args += ["-vf", f"scale=-2:min({int(_num(p, 'max_height', 144, 2160))}\\,ih)"]
        args += [*vcodec, "-crf", str(crf), "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", out(".mp4")]
        ext, mime, expected = ".mp4", "video/mp4", dur
    elif op == "resize":
        if not hv:
            raise MediaError("Resizing needs a video file.")
        h = int(_num(p, "height", 144, 2160))
        args = ["-i", src, "-vf", f"scale=-2:{h}", *vcodec, "-crf", "23", "-c:a", "aac", "-movflags", "+faststart", out(".mp4")]
        ext, mime, expected = ".mp4", "video/mp4", dur
    elif op == "gif":
        if not hv:
            raise MediaError("A GIF needs a video file.")
        start = _num(p, "start", 0, max(dur - 0.1, 0), 0)
        seconds = _num(p, "seconds", 0.5, 20, min(8, max(dur - start, 0.5)))
        fps, width = int(_num(p, "fps", 1, 15, 10)), int(_num(p, "width", 120, 800, 480))
        vf = f"fps={fps},scale={width}:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse"
        args = ["-ss", f"{start}", "-t", f"{seconds}", "-i", src, "-vf", vf, "-loop", "0", out(".gif")]
        ext, mime, expected = ".gif", "image/gif", seconds
    elif op == "speed":
        f = _num(p, "factor", 0.25, 4)
        if hv and ha:
            args = ["-i", src, "-filter_complex", f"[0:v]setpts=PTS/{f}[v];[0:a]{_atempo(f)}[a]", "-map", "[v]", "-map", "[a]",
                    *vcodec, "-crf", "23", "-c:a", "aac", "-movflags", "+faststart", out(".mp4")]
            ext, mime = ".mp4", "video/mp4"
        elif hv:
            args = ["-i", src, "-vf", f"setpts=PTS/{f}", *vcodec, "-crf", "23", "-an", "-movflags", "+faststart", out(".mp4")]
            ext, mime = ".mp4", "video/mp4"
        else:
            args = ["-i", src, "-af", _atempo(f), "-c:a", "libmp3lame", "-q:a", "2", out(".mp3")]
            ext, mime = ".mp3", "audio/mpeg"
        expected = dur / f
    elif op == "burn_subtitles":
        if not hv:
            raise MediaError("Burning subtitles needs a video file.")
        if not srt.strip():
            raise MediaError("There is no transcript to burn in. Process the video with speech-to-text first.")
        if not _has_filter("subtitles"):
            raise MediaError("This FFmpeg build has no subtitle (libass) support.")
        with open(os.path.join(outdir, "subs.srt"), "w", encoding="utf-8") as fh:
            fh.write(srt)
        args = ["-i", src, "-vf", "subtitles=subs.srt:force_style='FontSize=20,Outline=1,MarginV=28'",
                *vcodec, "-crf", "23", "-c:a", "copy", "-movflags", "+faststart", out(".mp4")]
        ext, mime, expected = ".mp4", "video/mp4", dur
    else:
        raise MediaError(f"Unknown edit '{op}'. Available: {OPS}.")

    _run(args, expected, cb, "Editing", cwd=outdir)
    path = out(ext)
    if not os.path.exists(path) or os.path.getsize(path) == 0:
        raise MediaError("The edit produced no output.")
    cb("Done", 1.0)
    return {"path": path, "mime": mime, "ext": ext, "size": os.path.getsize(path)}
