import asyncio
import json
import os
from typing import AsyncIterator

import httpx

from .base import Provider, ProviderError

VISION_HINTS = ("llava", "vision", "-vl", "vl:", "minicpm-v", "moondream", "bakllava", "gemma3", "llama4")


class OllamaProvider(Provider):
    id = "ollama"
    label = "Ollama (local open-source models)"

    def __init__(self) -> None:
        self.base = os.getenv("OLLAMA_URL", "http://localhost:11434").rstrip("/")
        self._caps_cache: dict[str, dict] = {}

    async def _caps(self, client: httpx.AsyncClient, name: str) -> dict:
        """Ask Ollama what the model can do; fall back to a name heuristic on older versions."""
        if name in self._caps_cache:
            return self._caps_cache[name]
        vision = any(h in name.lower() for h in VISION_HINTS)
        tools = False
        try:
            r = await client.post(f"{self.base}/api/show", json={"model": name, "name": name})
            if r.status_code == 200:
                d = r.json()
                caps = d.get("capabilities")
                if isinstance(caps, list):  # newer Ollama: authoritative
                    vision, tools = "vision" in caps, "tools" in caps
                else:
                    fam = (d.get("details") or {}).get("families") or []
                    vision = vision or any(f in ("clip", "mllama") for f in fam)
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

    async def stream(self, model: str, messages: list[dict], temperature: float) -> AsyncIterator[str]:
        payload = {"model": model, "messages": messages, "stream": True,
                   "options": {"temperature": temperature}}
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
                        text = data.get("message", {}).get("content", "")
                        if text:
                            yield text
                        if data.get("done"):
                            break
        except (httpx.ConnectError, httpx.ConnectTimeout) as e:
            raise self._unreachable() from e
        except httpx.ReadTimeout as e:
            raise ProviderError("The model took too long to respond. Try a smaller model.") from e
