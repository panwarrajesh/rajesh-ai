FROM python:3.11-slim
ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
# FFmpeg (audio/video), Tesseract with English + Hindi (OCR), Noto fonts (so burned-in Hindi subtitles render)
RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg tesseract-ocr tesseract-ocr-eng tesseract-ocr-hin fonts-noto-core \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt
COPY . .
RUN useradd -m app && chown -R app /app
USER app
ENV HF_HOME=/home/app/.cache/huggingface
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health', timeout=3)"
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
