from typing import AsyncIterator


class ProviderError(Exception):
    """A user-presentable error (shown directly in the chat UI)."""


class Provider:
    id: str = "base"
    label: str = "Base"
    experimental: bool = False

    async def list_models(self) -> list[dict]:
        """Return [{id, name, capabilities:{vision, tools}}]. Raise ProviderError if unavailable."""
        raise NotImplementedError

    def stream(self, model: str, messages: list[dict], temperature: float) -> AsyncIterator[str]:
        """Async generator yielding text chunks."""
        raise NotImplementedError

    async def describe(self) -> dict:
        try:
            models = await self.list_models()
            return {"id": self.id, "label": self.label, "experimental": self.experimental,
                    "available": True, "error": None, "models": models}
        except ProviderError as e:
            return {"id": self.id, "label": self.label, "experimental": self.experimental,
                    "available": False, "error": str(e), "models": []}
