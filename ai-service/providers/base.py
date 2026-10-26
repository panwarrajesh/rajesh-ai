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

    def stream(self, model: str, messages: list[dict], temperature: float,
               tools: list[dict] | None = None) -> AsyncIterator[str | dict]:
        """Async generator yielding text chunks (str). If the model asks for tools it finally yields
        {"tool_calls": [{"id", "name", "arguments": dict}]}.

        Canonical message shapes: assistant {"role","content","tool_calls":[...]} and
        tool {"role":"tool","tool_call_id","name","content"}. Providers convert to their own format."""
        raise NotImplementedError

    async def describe(self) -> dict:
        try:
            models = await self.list_models()
            return {"id": self.id, "label": self.label, "experimental": self.experimental,
                    "available": True, "error": None, "models": models}
        except ProviderError as e:
            return {"id": self.id, "label": self.label, "experimental": self.experimental,
                    "available": False, "error": str(e), "models": []}
