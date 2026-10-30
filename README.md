# Rajesh AI (Phases 1-6)

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

# 0c. FFmpeg (Phase 3: audio/video). Check with: ffmpeg -version
#     Ubuntu/Debian: sudo apt install ffmpeg   macOS: brew install ffmpeg   Windows: winget install ffmpeg

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

## Added in Phase 3: audio and video
- **Attach** mp3, wav, m4a, ogg, flac, aac, mp4, mov, mkv, webm, avi (up to 500 MB, `MEDIA_MAX_MB`). Upload progress is shown,
  then a progress bar while the server works. You can cancel at any time. Processing runs in the background.
- **Metadata + thumbnail:** duration, resolution, fps, codecs (FFmpeg). A poster image appears on the video player.
- **Speech to text:** faster-whisper with automatic language detection (Hindi, English and more), silence skipped.
  Timestamps are kept, so you can ask "what did they say around 12:30?".
- **Subtitles:** download `.srt`, `.vtt` or a timestamped `.txt` from any processed file.
- **Frame analysis:** 8 frames sampled evenly across the video (`VIDEO_FRAMES`) go to a vision model with their timestamps.
  Text visible on screen (slides, screen recordings) is read with OCR.
- **Summaries of long files:** ask "summarize this" (or "saransh batao"). If the file is too long for one prompt, it is
  read in parts (about 6,000 characters each), each part is summarized, and the final answer is written from those
  summaries. Progress is shown. This works for long PDFs too. It makes many model calls, so it is slow on small machines.
- The built-in players support seeking. Files are stored under `backend/data/uploads`.

### Whisper model choice (`WHISPER_MODEL` in `ai-service/.env`)
`small` (default) is a reasonable start on CPU. For better Hindi and Hinglish accuracy use `medium` or `large-v3`, ideally
on a GPU (`WHISPER_DEVICE=cuda`). The first run downloads the model (needs internet once). On CPU, long videos can take
longer than their running time. Only one file is transcribed at a time.

### Ollama context size
Ollama's own default context window is small and silently cuts long prompts, so the AI service sets `OLLAMA_NUM_CTX=8192`.
Hindi text uses many more tokens per character than English; if you work with long Hindi documents and have the memory,
raise it (e.g. 16384).

## Added in Phase 4: tools, memory, projects
### Tools (the AI does things instead of only explaining)
Calculator (exact, no `eval`), current date/time, memory (save/list/forget), search inside your attached files,
read a transcript between two timestamps, and, inside a project, list/read/write/delete files in the project workspace.
Each use is shown above the answer ("Calculator · (15+25)*3/4 = 30"). The model may chain several tools (up to `MAX_TOOL_ROUNDS`).
- Tools need a **tool-capable model** (for Ollama: `qwen2.5`, `llama3.1`, `mistral`...). Capability is read from Ollama; if the
  model can't use tools you get a notice and a normal text answer. You can switch tools off in Settings.
- The server enforces the rules, not just the prompt: `remember` and `forget_memory` refuse to run unless your latest message
  explicitly asks for it; file paths are validated (no `..`, no absolute paths, no symlink escapes, size and count limits).

### Memory
- Only what you explicitly ask for is saved: "Remember that...", "yaad rakhna ki...", "याद रखना कि...", or "..., yaad rakhna".
  This is detected on the server, so it works with **any** model, even without tool support. Questions such as
  "do you remember...?" never save anything.
- Open **Memory** in the sidebar to add, edit, delete, or clear everything. A toggle in Settings turns memory use off.
- Saved facts (up to `MEMORY_CHAR_BUDGET` characters, newest first) are included with each request. This is not semantic search.

### Projects
- Create a project with its own instructions (applied to every chat in it). Chats started inside a project belong to it.
- Each project has a **Files** workspace. Ask for a website, script or API in a project chat and the model writes the real
  files; browse them, view contents, and **download all as a .zip** from the project's Files tab.
- Deleting a project deletes its files but keeps its chats (they move to All chats).

## Added in Phase 5: creating media, login, hardening, Docker
### Pictures
- **Generate:** `/image a red kite over Delhi at sunset` (options `--landscape`, `--portrait`). Works with **any** model: slash
  commands don't go through the language model. Tool-capable models can also do it from a normal request ("make me a logo").
- **AI edit:** `/edit make the sky purple` changes the newest picture in the chat and keeps the original.
- **Simple edits, no AI:** `/img resize 800`, `/img crop 10`, `/img rotate 90`, `/img grayscale`, `/img brightness 1.3`,
  `/img webp`, or chain them: `/img resize 800, grayscale, webp`. Exact, instant, no GPU, no internet.
- Results appear in the chat with a download button. Type `/` in the message box for a command list.

**Image provider (pick one in `ai-service/.env`; image generation is optional):**
| Option | Needs | Notes |
|---|---|---|
| `IMAGE_PROVIDER=openai` | An API key (`IMAGE_API_KEY`) | Any OpenAI-compatible images API. No GPU needed. Set `IMAGE_MODEL` to your provider's current model name. `dall-e-*` models can generate but not edit; `gpt-image-*` can do both. |
| `IMAGE_PROVIDER=a1111` | Stable Diffusion WebUI running with `--api` | Local and private. Needs a GPU on whichever machine runs it. Set `A1111_BASE_SIZE` (512 for SD 1.5, 1024 for SDXL). |

### Video and audio editing (FFmpeg, no GPU, no internet)
`/video trim 0:10 0:40` · `/video audio` (extract mp3) · `/video gif 5 4` · `/video compress` · `/video resize 480` ·
`/video speed 1.5` · `/video subtitles` (burns the transcript into the video). Runs in the background with progress shown;
the edited copy appears in the chat and the original is kept. Tool-capable models can call the same edits from normal requests.

### Login and hardening
- Set `APP_PASSWORD` in `backend/.env` to require a password (signed HTTP-only cookie, 30 days). Empty = no login (local only).
- Rate limits: 600 API calls/min, 40 answers/min, 60 uploads/10 min, 10 login attempts/15 min per client.
- Cross-site requests are blocked (Origin check), CORS is off unless `CORS_ORIGIN` is set, security headers on all responses.
- `INTERNAL_TOKEN` (same value in both `.env` files) makes the AI service refuse everything except the backend.
- This is **one password for one owner**, not a multi-user system: chats, files and memory are shared by anyone who has the password.

### Docker (one command)
```bash
cp .env.example .env       # set APP_PASSWORD and INTERNAL_TOKEN  (openssl rand -hex 32)
docker compose up --build  # open http://localhost:8080
```
By default the container talks to Ollama running on your computer (`host.docker.internal:11434`). To run Ollama in Docker too:
`docker compose --profile ollama up --build` and set `OLLAMA_URL=http://ollama:11434` (GPU instructions are in the compose file).
Data lives in Docker volumes (`rajesh-data` holds the database, uploads and project files; back it up).
Serving it on the internet? Put it behind HTTPS (e.g. a reverse proxy or tunnel) and set `COOKIE_SECURE=1`.

## Added in Phase 6: voice assistant
Press **Talk** (top right, or the big button on the start screen). A full-screen voice session opens with an animated orb.

**What happens:** it greets you once in Hindi, then listens. You speak (Hindi, English or Hinglish), it shows what it heard, thinks,
and answers aloud in a female voice where your device has one, starting to speak while the answer is still being written.
When it finishes it listens again, so you can just keep talking.

**Controls:** microphone on/off (Space), mute/unmute, stop speaking, replay, stop generating, attach a file, a text box (type instead
of talking), a language switch (हिं / EN) for what you speak, and Settings. Esc closes. The state is always shown: *Listening ·
सुन रही हूँ*, *Thinking · सोच रही हूँ*, *Speaking · बोल रही हूँ*.

**The orb:** idle = slow float and glow; listening = blue pulse and sound-wave rings that follow your real microphone level;
thinking = a light rotating around the edge; speaking = it expands with each spoken word. It respects "reduce motion".

**Greeting and names:** the greeting is exactly the one you specified. You can change the assistant's name, your name and the greeting
in Settings. It is spoken once per voice session (not again if you reopen within 10 minutes) and never after each message.

**Files, spoken:** attach a TXT, PDF, DOCX, CSV or image (OCR is used for images and scanned PDFs), then say "isko padho" or tap
*Explain my file aloud*. Any message can also be read aloud with its speaker button. If a file has no readable text, the AI is told
so and must say so; it is not allowed to pretend it read it.

**Memory and data:** saved memory is only what you explicitly ask it to remember. It refuses to save passwords, PINs, OTPs, API keys,
card, Aadhaar and PAN numbers. The Memory panel lets you review, edit and delete memories, and delete all conversations. The AI is
told which facts are saved and which exist only in the current chat, and answers "what do you remember?" accordingly.
The only database change is one **new** table, `preferences`, created with `CREATE TABLE IF NOT EXISTS`; nothing existing is altered or removed.

### Start it (nothing new to install)
```bash
# Terminal 1 - AI service
cd ai-service && source .venv/bin/activate && uvicorn main:app --port 8000
# Terminal 2 - backend
cd backend && npm start
# Terminal 3 - frontend
cd frontend && npm run dev            # open http://localhost:5173, then press Talk
```
(First time only: the install steps above. Docker: `docker compose up --build`.)
Microphone access needs `http://localhost` or HTTPS; a plain `http://` address on your network will not be allowed by the browser.

### Speech recognition: two modes (Settings -> Voice assistant)
| Mode | Works in | Notes |
|---|---|---|
| Browser (default) | Chrome, Edge, Safari | Fast and good with Hindi. **Chrome sends your audio to Google** for recognition. |
| This computer | any browser that can record | Uses your own Whisper (`/api/transcribe`), so audio stays on your machine. Needs `faster-whisper`; set `WHISPER_MODEL=medium` for better Hindi. A little slower. |
"Automatic" uses the browser's recognition when it exists and falls back to this computer when it does not (for example Firefox).
If nothing is available, or the microphone is blocked, the screen says so plainly and typing keeps working.

### Honest limits of the voice assistant
- Voice quality comes from your device. If no Hindi voice is installed you are warned, and Hindi will sound wrong until you add one
  in your system settings. "Female voice" is chosen by voice name; if none matches, the default voice is used.
- Browsers do not expose the audio level of speech synthesis, so the orb pulses on each spoken word (and gently when a voice sends no
  word events). It does follow your real microphone level while you speak.
- It cannot be interrupted by speaking over it (the microphone is off while it talks, so it does not hear itself). Tap *Stop speaking*.
- On some Android phones Chrome plays a small sound each time listening restarts.
- Hindi/Hinglish recognition is only as good as the engine behind it. Hinglish may come back in Devanagari or Roman letters.
- **Tested here:** the real voice screen was run in headless Chrome with a pretend microphone and speaker (51 checks: greeting, full
  conversation loop, speaking while the answer is still being written, stop, mute, replay, errors, silence, no-support fallbacks, the
  Whisper fallback), and the backend rules (secret filter, preferences, prompt, unreadable files, speech-to-text) were tested.
  **Not tested:** a real microphone, real device voices, a real model, and a phone.

## Not built yet
Running code, web browsing/search, multi-user accounts, a button to move chats into projects, and ComfyUI support.

## Honest limits of Phase 5
- Image quality, speed and cost depend entirely on the provider you connect; this app doesn't include an image model.
- AI image editing quality varies: Stable Diffusion img2img changes the whole picture to a degree set by `--strength`;
  hosted editors follow instructions better. Hindi/Devanagari text inside generated pictures is usually poor.
- Content rules (what may be generated) are enforced by your provider, not by this app.
- Burned-in subtitles use the Whisper transcript, so transcript mistakes appear in the video. Edited copies carry no transcript
  of their own; subtitles are always taken from the newest original video that has one.
- Docker files and nginx config were written but not built in the sandbox (no Docker there). Expect to fix small things.

## Honest limits of Phase 4
- Small local models call tools unreliably (wrong arguments, forgetting to call, or inventing a result in text). The tool
  results shown above an answer are the source of truth. Bigger models are noticeably better.
- The AI **writes** project files but cannot **run** them: there is no code-execution sandbox, deliberately, for safety.
  Download the zip and run the code yourself.
- Project files are not automatically in the model's context; it reads them with tools when it needs to.
- There is no web search or browsing tool yet, so the model has no live information beyond date/time.
- A chat can be moved into a project through the API (`PATCH /api/chats/:id {project_id}`) but there is no button for it yet.

## Honest limits of Phase 3
- Transcripts can contain mistakes, especially names, technical terms and mixed Hindi-English speech. Spoken Hinglish is
  usually transcribed in Devanagari. There are no speaker labels, and subtitle timing is per sentence, not per word.
- The model sees only sampled frames, not every moment of a video. Short on-screen events can be missed.
- No audio understanding beyond speech (music, sounds, tone are not analysed).
- Video editing (cut, trim, burn-in subtitles) is not built yet.

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
- Login is a single shared password (Phase 5); there are no separate user accounts.
- Not yet run against real models or a live server (the build sandbox had no internet): first run may need small fixes.
  Checked so far: Python compiles; the FFmpeg pipeline and all 7 video edits were run on real files; Pillow edits were run
  for real; image providers, tool loop, slash commands and login were tested against fakes; retrieval, subtitles and context
  building were unit-tested; the Whisper path was tested against a fake model; Node and JSX parse cleanly.
