"""
Experimental backend for your own small PyTorch GPT.

It is deliberately an adapter: you write `custom_gpt_adapter.py` (see the .example file)
exposing load() and generate(prompt, temperature). A small custom model will NOT match
modern LLMs; it is labelled experimental in the UI for that reason.
"""
import asyncio
import importlib
import os
from typing import AsyncIterator

from .base import Provider, ProviderError

_SENTINEL = object()


class PyTorchGPTProvider(Provider):
    id = "pytorch_gpt"
    label = "My PyTorch GPT (experimental)"
    experimental = True

    def __init__(self) -> None:
        self._mod = None

    def _adapter(self):
        name = os.getenv("CUSTOM_GPT_ADAPTER")
        if not name:
            raise ProviderError("Not configured. Copy custom_gpt_adapter.example.py to custom_gpt_adapter.py, "
                                "then set CUSTOM_GPT_ADAPTER=custom_gpt_adapter in ai-service/.env.")
        if self._mod is None:
            try:
                mod = importlib.import_module(name)
                mod.load()
            except Exception as e:  # surface adapter problems to the user
                raise ProviderError(f"Your adapter failed to load: {e}") from e
            self._mod = mod
        return self._mod

    async def list_models(self) -> list[dict]:
        self._adapter()
        return [{"id": "custom-gpt", "name": "Custom GPT (small, experimental)",
                 "capabilities": {"vision": False, "tools": False}}]

    async def stream(self, model: str, messages: list[dict], temperature: float,
                     tools: list[dict] | None = None) -> AsyncIterator[str]:
        mod = self._adapter()
        prompt = "\n".join(f"{m['role']}: {m.get('content', '')}" for m in messages if m["role"] != "tool") + "\nassistant:"
        gen = iter(mod.generate(prompt, temperature))
        while True:
            chunk = await asyncio.to_thread(next, gen, _SENTINEL)  # don't block the event loop
            if chunk is _SENTINEL:
                break
            yield chunk
