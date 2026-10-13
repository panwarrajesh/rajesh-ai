"""Turn uploaded files into text (and OCR for images / scanned PDFs)."""
import io
import os

from PIL import Image, ImageOps

IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"}
TEXT_EXTS = {
    ".txt", ".md", ".markdown", ".csv", ".tsv", ".json", ".jsonl", ".xml", ".yaml", ".yml", ".toml", ".ini",
    ".cfg", ".conf", ".log", ".html", ".htm", ".css", ".scss", ".svg", ".js", ".jsx", ".mjs", ".cjs", ".ts",
    ".tsx", ".vue", ".svelte", ".py", ".ipynb", ".java", ".c", ".h", ".cpp", ".hpp", ".cs", ".go", ".rs",
    ".rb", ".php", ".sh", ".bash", ".sql", ".swift", ".kt", ".dart", ".lua", ".r",
}
MEDIA_EXTS = {".mp3", ".wav", ".m4a", ".ogg", ".flac", ".aac", ".mp4", ".mov", ".mkv", ".webm", ".avi"}

MAX_CHARS = 1_000_000
MAX_PDF_PAGES = 500
MAX_OCR_PDF_PAGES = 15


class ExtractError(Exception):
    def __init__(self, message: str, status: int = 422):
        super().__init__(message)
        self.status = status


def kind_of(filename: str) -> str:
    ext = os.path.splitext(filename.lower())[1]
    if ext in IMAGE_EXTS:
        return "image"
    if ext == ".pdf":
        return "pdf"
    if ext == ".docx":
        return "docx"
    if ext in TEXT_EXTS:
        return "text"
    if ext in MEDIA_EXTS:
        raise ExtractError("Audio and video files arrive in Phase 3. For now, upload images, PDFs, Word files, text or code.", 415)
    raise ExtractError(f"Files of type '{ext or 'unknown'}' aren't supported yet.", 415)


def _ocr_lang(pytesseract) -> str | None:
    want = [x for x in os.getenv("OCR_LANGS", "eng+hin").split("+") if x]
    have = set(pytesseract.get_languages(config=""))
    use = [x for x in want if x in have]
    return "+".join(use) or None


def _ocr_image(img: Image.Image) -> tuple[str, str]:
    """Return (text, status) where status is ok | unavailable | failed."""
    try:
        import pytesseract
    except ImportError:
        return "", "unavailable"
    try:
        lang = _ocr_lang(pytesseract)
        if not lang:
            return "", "unavailable"
        g = ImageOps.grayscale(img)
        w, h = g.size
        if max(w, h) < 1000:
            g = g.resize((w * 2, h * 2))
        if max(g.size) > 3000:
            g.thumbnail((3000, 3000))
        return pytesseract.image_to_string(g, lang=lang).strip(), "ok"
    except pytesseract.TesseractNotFoundError:
        return "", "unavailable"
    except Exception:  # noqa: BLE001
        return "", "failed"


def _image(data: bytes) -> tuple[str, dict]:
    try:
        img = ImageOps.exif_transpose(Image.open(io.BytesIO(data)))
        img.load()
    except Exception as e:  # noqa: BLE001
        raise ExtractError("This image couldn't be opened. It may be corrupted or in an unsupported format.") from e
    text, status = _ocr_image(img.convert("RGB"))
    return text, {"width": img.width, "height": img.height, "ocr": status}


def _ocr_pdf_pages(data: bytes, idxs: list[int]) -> dict[int, str]:
    try:
        import pypdfium2 as pdfium
    except ImportError:
        return {}
    out: dict[int, str] = {}
    pdf = pdfium.PdfDocument(data)
    for i in idxs[:MAX_OCR_PDF_PAGES]:
        text, status = _ocr_image(pdf[i].render(scale=2).to_pil())
        if status == "unavailable":
            break
        if text:
            out[i] = text
    return out


def _pdf(data: bytes) -> tuple[str, dict]:
    from pypdf import PdfReader
    try:
        reader = PdfReader(io.BytesIO(data))
        if reader.is_encrypted and not reader.decrypt(""):
            raise ExtractError("This PDF is password-protected. Remove the password and upload it again.")
        pages = reader.pages
        total = len(pages)
        texts = []
        for p in list(pages)[:MAX_PDF_PAGES]:
            try:
                texts.append((p.extract_text() or "").strip())
            except Exception:  # noqa: BLE001
                texts.append("")
    except ExtractError:
        raise
    except Exception as e:  # noqa: BLE001
        raise ExtractError("This PDF couldn't be read. It may be damaged.") from e

    empty = [i for i, t in enumerate(texts) if len(t) < 20]
    ocr = _ocr_pdf_pages(data, empty) if empty else {}
    for i, t in ocr.items():
        texts[i] = t
    body = "\n\n".join(f"[Page {i + 1}]\n{t}" for i, t in enumerate(texts) if t)
    return body, {"pages": total, "ocr_pages": len(ocr), "pages_without_text": len(empty) - len(ocr)}


def _docx(data: bytes) -> tuple[str, dict]:
    try:
        from docx import Document
        from docx.table import Table
        from docx.text.paragraph import Paragraph
        doc = Document(io.BytesIO(data))
    except Exception as e:  # noqa: BLE001
        raise ExtractError("This Word file couldn't be read. Only .docx is supported (not old .doc).") from e
    lines = []
    for child in doc.element.body.iterchildren():
        if child.tag.endswith("}p"):
            t = Paragraph(child, doc).text.strip()
            if t:
                lines.append(t)
        elif child.tag.endswith("}tbl"):
            for row in Table(child, doc).rows:
                lines.append(" | ".join(c.text.strip() for c in row.cells))
    return "\n".join(lines), {}


def _text(data: bytes) -> tuple[str, dict]:
    for enc in ("utf-8-sig", "utf-16"):
        try:
            return data.decode(enc), {}
        except UnicodeError:
            pass
    return data.decode("latin-1"), {"encoding": "latin-1 (guessed)"}


def extract(filename: str, data: bytes) -> dict:
    kind = kind_of(filename)
    text, meta = {"image": _image, "pdf": _pdf, "docx": _docx, "text": _text}[kind](data)
    meta["truncated"] = len(text) > MAX_CHARS
    text = text[:MAX_CHARS]
    warning = None
    if kind == "image" and meta["ocr"] == "unavailable":
        warning = "OCR isn't installed on the AI service, so only a vision model can read this image."
    elif kind == "image" and meta["ocr"] == "failed":
        warning = "OCR failed on this image; only a vision model can read it."
    elif kind != "image" and not text.strip():
        warning = "No text could be extracted from this file."
        if kind == "pdf":
            warning += " It may be a scan; install Tesseract so scanned pages can be read."
    return {"kind": kind, "text": text, "meta": meta, "warning": warning}
