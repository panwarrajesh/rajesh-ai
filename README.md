# Rajesh AI (Phases 1-2)

Personal AI assistant: React UI → Node/Express backend (chats, history, SQLite) → FastAPI AI service → your model
(Ollama local models, any OpenAI-compatible API, or your own PyTorch GPT as an experimental adapter).

## Run it

You need Node 20+, Python 3.10+, and [Ollama](https://ollama.com).

```bash
# 0. a model (pick one that fits your RAM/GPU; 7B needs ~8 GB)
ollama pull qwen2.5:7b            # good for Hindi/Hinglish/English + code
# smaller machine: ollama pull qwen2.5:3b

# 0b. OCR + a vision model (Phase 2)
#   Tesseract program with English + Hindi language data:
#     Ubuntu/Debian: sudo apt install tesseract-ocr tesseract-ocr-hin
#     macOS:         brew install tesseract tesseract-lang
#     Windows:       installer from github.com/UB-Mannheim/tesseract (tick Hindi), add to PATH
#   A vision model so the AI can actually SEE images (pick one that fits your hardware):
ollama pull qwen2.5vl:7b          # or: llava, llama3.2-vision, gemma3

# 1. AI service  (terminal 1)
cd ai-service
python -m venv .venv && source .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env
uvicorn main:app --port 8000

# 2. Backend  (terminal 2)
cd backend && cp .env.example .env && npm install && npm start

# 3. Frontend  (terminal 3)
cd frontend && npm install && npm run dev        # http://localhost:5173
```

If something is missing (Ollama not running, no model pulled, service down), the app tells you exactly what to do
in the chat and in Settings.

## What works in Phase 1
- Streaming chat with Stop, Regenerate, Continue, Edit-and-resend, Copy, read-aloud, voice input (Chrome/Edge/Safari)
- Markdown, syntax-highlighted code with copy buttons, tables
- Chat history in SQLite: search (titles and message text), rename, delete, export (Markdown/JSON)
- Context trimming (newest messages that fit `MAX_CONTEXT_CHARS`), Hindi/Hinglish/English system prompt
- Provider/model picker with capability flags; automatic fallback to any available provider
- Light/dark theme, responsive layout (mobile drawer sidebar)

## Added in Phase 2
- **Attach** images, PDFs, Word (.docx), text and code files: button, drag-and-drop, or paste a screenshot. Previews in the
  composer and in the chat; up to 8 files, 25 MB each (`UPLOAD_MAX_MB`).
- **Image understanding:** images go to the model only if it reports vision support (Ollama's `/api/show`). Images are
  rotated, flattened and resized to 1568 px first. Ask "what is in this photo?", "explain this error", "suggest design improvements".
- **OCR:** Tesseract (English + Hindi) reads text from images and from scanned PDF pages. OCR text is sent alongside the
  picture to vision models, and is the *only* thing a text-only model gets.
- **Graceful fallback:** with a text-only model you see a notice, and the model is told it cannot see the picture, so it
  won't invent a description.
- **Document Q&A:** PDFs (with `[Page N]` markers), Word files (including tables), text/code. Small files go in whole.
  Large files use keyword search (BM25) to pick the most relevant ~16,000 characters (`DOC_BUDGET_CHARS`) and tell you so.
  Files stay available for the whole chat, so follow-up questions work.
- Editing a message keeps its files; deleting a chat deletes its files; unsent uploads are cleaned up after 24 hours.

## Not built yet (clearly marked in the UI)
Audio/video (transcription, frames, subtitles), memory, tools, Projects, image/video generation, login → Phases 3-5.

## Honest limits of Phase 2
- Document search is keyword-based, not semantic (it can miss a passage that uses different words than your question).
  Embedding-based search is a planned upgrade. "Summarize this whole 300-page PDF" will only see part of it.
- Hindi OCR quality depends on image quality; handwriting is poor with Tesseract.
- Old `.doc`, `.xls`, `.pptx` files are not supported yet.
- Uploads are stored unencrypted on your disk under `backend/data/uploads`.

## Other providers
- **External API:** set `OPENAI_API_KEY` (+ `OPENAI_BASE_URL`, `OPENAI_MODELS`) in `ai-service/.env`. Works with OpenAI,
  OpenRouter, Groq, LM Studio, vLLM. Keys never reach the browser.
- **Your PyTorch GPT:** copy `ai-service/custom_gpt_adapter.example.py` to `custom_gpt_adapter.py`, implement `load()` and
  `generate()`, set `CUSTOM_GPT_ADAPTER=custom_gpt_adapter`. It shows up as "experimental"; a small model will not
  match modern pretrained LLMs.

## Known limits
- No auth yet (single user, local use). Add before exposing it to a network (Phase 5).
- Not yet run against real models or a live server (the build sandbox had no internet): first run may need small fixes.
  Checked so far: Python compiles, retrieval logic unit-tested, Node and JSX parse cleanly.
