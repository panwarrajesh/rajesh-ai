import json
import os
from typing import AsyncIterator

import httpx

from .base import Provider, ProviderError

DEFAULT_BASE = "https://api.openai.com/v1"
VISION_HINTS = ("gpt-4o", "gpt-4.1", "gpt-5", "vision", "-vl", "gemini", "claude", "pixtral", "llava")


def _convert(m: dict) -> dict:
    """Canonical message -> OpenAI format (images as content parts, tool calls as JSON strings)."""
    if m["role"] == "assistant" and m.get("tool_calls"):
        return {"role": "assistant", "content": m.get("content") or None,
                "tool_calls": [{"id": c["id"], "type": "function",
                                "function": {"name": c["name"], "arguments": json.dumps(c.get("arguments") or {})}}
                               for c in m["tool_calls"]]}
    if m["role"] == "tool":
        return {"role": "tool", "tool_call_id": m.get("tool_call_id", ""), "content": m.get("content") or ""}
    images = m.get("images")
    if not images:
        return {"role": m["role"], "content": m["content"]}
    parts = [{"type": "text", "text": m["content"]}]
    parts += [{"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b}"}} for b in images]
    return {"role": m["role"], "content": parts}


class OpenAICompatProvider(Provider):
    """Any OpenAI-compatible server: OpenAI, OpenRouter, Groq, LM Studio, vLLM, llama.cpp server..."""

    id = "openai_compat"
    label = "External API (OpenAI-compatible)"

    def __init__(self) -> None:
        self.base = (os.getenv("OPENAI_BASE_URL") or DEFAULT_BASE).rstrip("/")
        self.key = os.getenv("OPENAI_API_KEY", "")
        self.fixed_models = [m.strip() for m in os.getenv("OPENAI_MODELS", "").split(",") if m.strip()]
        self.vision_models = {m.strip() for m in os.getenv("OPENAI_VISION_MODELS", "").split(",") if m.strip()}

    def _headers(self) -> dict:
        h = {"Content-Type": "application/json"}
        if self.key:
            h["Authorization"] = f"Bearer {self.key}"
        return h

    async def list_models(self) -> list[dict]:
        if not self.key and self.base == DEFAULT_BASE:
            raise ProviderError("Not configured. Set OPENAI_API_KEY (and optionally OPENAI_BASE_URL) in ai-service/.env.")
        if self.fixed_models:
            names = self.fixed_models
        else:
            try:
                async with httpx.AsyncClient(timeout=10) as client:
                    r = await client.get(f"{self.base}/models", headers=self._headers())
                    r.raise_for_status()
                names = sorted(m["id"] for m in r.json().get("data", []))
            except httpx.HTTPError as e:
                raise ProviderError(f"Couldn't list models from {self.base}. Check the key/URL, or set OPENAI_MODELS.") from e
        # Name-based guesses; set OPENAI_VISION_MODELS to override for your server.
        # Most OpenAI-compatible chat models support tools; set OPENAI_NO_TOOLS=1 for servers that do not.
        tools = os.getenv("OPENAI_NO_TOOLS", "") not in ("1", "true")
        return [{"id": n, "name": n,
                 "capabilities": {"vision": n in self.vision_models or any(h in n.lower() for h in VISION_HINTS),
                                  "tools": tools}} for n in names]

    async def stream(self, model: str, messages: list[dict], temperature: float,
                     tools: list[dict] | None = None) -> AsyncIterator[str | dict]:
        payload = {"model": model, "messages": [_convert(m) for m in messages], "stream": True,
                   "temperature": temperature}
        if tools:
            payload["tools"] = tools
        acc: dict[int, dict] = {}  # tool calls arrive in fragments, keyed by index
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(300, connect=10)) as client:
                async with client.stream("POST", f"{self.base}/chat/completions",
                                         json=payload, headers=self._headers()) as r:
                    if r.status_code != 200:
                        body = (await r.aread()).decode(errors="ignore")[:300]
                        raise ProviderError(f"API returned {r.status_code}: {body}")
                    async for line in r.aiter_lines():
                        if not line.startswith("data:"):
                            continue
                        chunk = line[5:].strip()
                        if chunk == "[DONE]":
                            break
                        try:
                            delta = json.loads(chunk)["choices"][0].get("delta", {})
                        except (json.JSONDecodeError, KeyError, IndexError):
                            continue
                        if delta.get("content"):
                            yield delta["content"]
                        for tc in delta.get("tool_calls") or []:
                            e = acc.setdefault(tc.get("index", 0), {"id": "", "name": "", "args": ""})
                            if tc.get("id"):
                                e["id"] = tc["id"]
                            fn = tc.get("function") or {}
                            e["name"] += fn.get("name") or ""
                            e["args"] += fn.get("arguments") or ""
        except httpx.ConnectError as e:
            raise ProviderError(f"Couldn't connect to {self.base}.") from e
        if acc:
            calls = []
            for i, e in sorted(acc.items()):
                try:
                    args = json.loads(e["args"] or "{}")
                except json.JSONDecodeError:
                    args = {}
                calls.append({"id": e["id"] or f"call_{i}", "name": e["name"], "arguments": args})
            yield {"tool_calls": calls}
