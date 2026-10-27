import asyncio
import json
import os
from typing import AsyncIterator

import httpx

from .base import Provider, ProviderError

TOOL_HINTS = ("qwen2.5", "qwen3", "llama3.1", "llama3.2", "llama3.3", "mistral", "command-r", "granite", "firefunction", "hermes")
VISION_HINTS = ("llava", "vision", "-vl", "vl:", "minicpm-v", "moondream", "bakllava", "gemma3", "llama4")


class OllamaProvider(Provider):
    id = "ollama"
    label = "Ollama (local open-source models)"

    def __init__(self) -> None:
        self.base = (os.getenv("OLLAMA_URL") or "http://localhost:11434").rstrip("/")
        self._caps_cache: dict[str, dict] = {}

    async def _caps(self, client: httpx.AsyncClient, name: str) -> dict:
        """Ask Ollama what the model can do; fall back to a name heuristic on older versions."""
        if name in self._caps_cache:
            return self._caps_cache[name]
        vision = any(h in name.lower() for h in VISION_HINTS)
        tools = any(h in name.lower() for h in TOOL_HINTS) and "vision" not in name.lower()  # guess for old Ollama
        try:
            r = await client.post(f"{self.base}/api/show", json={"model": name, "name": name})
            if r.status_code == 200:
                d = r.json()
                caps = d.get("capabilities")
                if isinstance(caps, list):  # newer Ollama: authoritative
                    vision, tools = "vision" in caps, "tools" in caps
                else:
                    fam = (d.get("details") or {}).get("families") or []
                    vision = vision or any(f in ("clip", "mllama") for f in fam)  # tools stays a name-based guess
        except httpx.HTTPError:
            pass
        self._caps_cache[name] = {"vision": vision, "tools": tools}
        return self._caps_cache[name]

    def _unreachable(self) -> ProviderError:
        return ProviderError(
            f"Ollama isn't reachable at {self.base}. Install it from ollama.com, run `ollama serve`, "
            "then pull a model, e.g. `ollama pull qwen2.5:7b`."
        )

    async def list_models(self) -> list[dict]:
        try:
            async with httpx.AsyncClient(timeout=5) as client:
                r = await client.get(f"{self.base}/api/tags")
                r.raise_for_status()
        except httpx.HTTPError as e:
            raise self._unreachable() from e
        names = [m["name"] for m in r.json().get("models", [])]
        async with httpx.AsyncClient(timeout=10) as client:
            caps = await asyncio.gather(*(self._caps(client, n) for n in names))
        models = [{"id": n, "name": n, "capabilities": c} for n, c in zip(names, caps)]
        if not models:
            raise ProviderError("Ollama is running but has no models. Run `ollama pull qwen2.5:7b`.")
        return models

    @staticmethod
    def _convert(m: dict) -> dict:
        if m["role"] == "assistant" and m.get("tool_calls"):
            return {"role": "assistant", "content": m.get("content") or "",
                    "tool_calls": [{"function": {"name": c["name"], "arguments": c.get("arguments") or {}}}
                                   for c in m["tool_calls"]]}
        if m["role"] == "tool":
            return {"role": "tool", "content": m.get("content") or "", "tool_name": m.get("name") or ""}
        out = {"role": m["role"], "content": m.get("content", "")}
        if m.get("images"):
            out["images"] = m["images"]
        return out

    async def stream(self, model: str, messages: list[dict], temperature: float,
                     tools: list[dict] | None = None) -> AsyncIterator[str | dict]:
        payload = {"model": model, "messages": [self._convert(m) for m in messages], "stream": True,
                   "options": {"temperature": temperature,
                               "num_ctx": int(os.getenv("OLLAMA_NUM_CTX", "8192"))}}
        if tools:
            payload["tools"] = tools
        calls: list[dict] = []
        timeout = httpx.Timeout(300, connect=5)
        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                async with client.stream("POST", f"{self.base}/api/chat", json=payload) as r:
                    if r.status_code != 200:
                        body = (await r.aread()).decode(errors="ignore")[:300]
                        raise ProviderError(f"Ollama returned {r.status_code}: {body}")
                    async for line in r.aiter_lines():
                        if not line:
                            continue
                        data = json.loads(line)
                        if data.get("error"):
                            raise ProviderError(data["error"])
                        msg = data.get("message", {})
                        if msg.get("content"):
                            yield msg["content"]
                        for tc in msg.get("tool_calls") or []:
                            fn = tc.get("function", {})
                            args = fn.get("arguments") or {}
                            if isinstance(args, str):
                                try:
                                    args = json.loads(args)
                                except json.JSONDecodeError:
                                    args = {}
                            calls.append({"id": f"call_{len(calls)}", "name": fn.get("name", ""), "arguments": args})
                        if data.get("done"):
                            break
                    if calls:
                        yield {"tool_calls": calls}
        except (httpx.ConnectError, httpx.ConnectTimeout) as e:
            raise self._unreachable() from e
        except httpx.ReadTimeout as e:
            raise ProviderError("The model took too long to respond. Try a smaller model.") from e
