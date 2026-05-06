"""LLM provider abstraction.

Supports Ollama (local), OpenAI (hosted), and Anthropic Claude (hosted).
All providers expose a common `chat()` interface that returns a string response
(parsed as JSON by the caller).

Configuration is stored in the app_settings table and can be changed at runtime
from the Settings modal.
"""

from __future__ import annotations

import json
import logging
from abc import ABC, abstractmethod
from typing import Any

import httpx

logger = logging.getLogger(__name__)


# ── Base class ────────────────────────────────────────────────

class LlmProvider(ABC):
    """Base interface all providers must implement."""

    @abstractmethod
    async def chat(self, system: str, user: str, json_mode: bool = True) -> str:
        """Send a chat request and return the response content as a string.

        Args:
            system: The system prompt.
            user: The user message.
            json_mode: If True, hint the model to return valid JSON.

        Returns:
            The response content.
        """
        ...

    @abstractmethod
    async def test(self) -> dict[str, Any]:
        """Test connectivity to the provider. Returns {ok, message}."""
        ...


# ── Ollama ────────────────────────────────────────────────────

class OllamaProvider(LlmProvider):
    def __init__(self, base_url: str, model: str):
        self._base_url = base_url.rstrip("/")
        self._model = model

    async def chat(self, system: str, user: str, json_mode: bool = True) -> str:
        import ollama as ollama_sdk
        client = ollama_sdk.AsyncClient(
            host=self._base_url,
            timeout=httpx.Timeout(120.0, connect=10.0),
        )
        response = await client.chat(
            model=self._model,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            format="json" if json_mode else None,
        )
        return response.message.content or ""

    async def test(self) -> dict[str, Any]:
        try:
            async with httpx.AsyncClient(timeout=5) as http:
                resp = await http.get(f"{self._base_url}/api/tags")
                if resp.status_code != 200:
                    return {"ok": False, "message": f"Ollama returned {resp.status_code}"}
                data = resp.json()
                available = [m.get("name", "") for m in data.get("models", [])]
                # Model name comparison: "llama3.2" matches "llama3.2:latest"
                model_found = any(m.startswith(self._model) for m in available)
                if not model_found:
                    return {
                        "ok": False,
                        "message": f"Model '{self._model}' not found. Available: {available[:5]}",
                    }
                return {"ok": True, "message": f"Connected. Using {self._model}."}
        except Exception as e:
            return {"ok": False, "message": f"Cannot reach {self._base_url}: {e}"}


# ── OpenAI ────────────────────────────────────────────────────

class OpenAiProvider(LlmProvider):
    def __init__(self, api_key: str, model: str, base_url: str | None = None):
        self._api_key = api_key
        self._model = model
        self._base_url = (base_url or "https://api.openai.com/v1").rstrip("/")

    async def chat(self, system: str, user: str, json_mode: bool = True) -> str:
        payload: dict[str, Any] = {
            "model": self._model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            "temperature": 0.1,
        }
        if json_mode:
            payload["response_format"] = {"type": "json_object"}

        async with httpx.AsyncClient(timeout=httpx.Timeout(120.0, connect=10.0)) as client:
            resp = await client.post(
                f"{self._base_url}/chat/completions",
                headers={
                    "Authorization": f"Bearer {self._api_key}",
                    "Content-Type": "application/json",
                },
                json=payload,
            )
            if resp.status_code != 200:
                raise ValueError(f"OpenAI API error {resp.status_code}: {resp.text[:200]}")
            data = resp.json()
            return data["choices"][0]["message"]["content"] or ""

    async def test(self) -> dict[str, Any]:
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.get(
                    f"{self._base_url}/models",
                    headers={"Authorization": f"Bearer {self._api_key}"},
                )
                if resp.status_code == 200:
                    return {"ok": True, "message": f"OpenAI API connected. Using {self._model}."}
                if resp.status_code == 401:
                    return {"ok": False, "message": "Invalid API key"}
                return {"ok": False, "message": f"API returned {resp.status_code}"}
        except Exception as e:
            return {"ok": False, "message": f"Cannot reach {self._base_url}: {e}"}


# ── Anthropic Claude ──────────────────────────────────────────

class AnthropicProvider(LlmProvider):
    def __init__(self, api_key: str, model: str):
        self._api_key = api_key
        self._model = model
        self._base_url = "https://api.anthropic.com/v1"

    async def chat(self, system: str, user: str, json_mode: bool = True) -> str:
        # Anthropic doesn't have a native json_mode; we rely on prompt instructions
        system_prompt = system
        if json_mode:
            system_prompt += "\n\nCRITICAL: Reply with ONLY valid JSON. No markdown, no prose, no code fences."

        async with httpx.AsyncClient(timeout=httpx.Timeout(120.0, connect=10.0)) as client:
            resp = await client.post(
                f"{self._base_url}/messages",
                headers={
                    "x-api-key": self._api_key,
                    "anthropic-version": "2023-06-01",
                    "Content-Type": "application/json",
                },
                json={
                    "model": self._model,
                    "max_tokens": 4096,
                    "system": system_prompt,
                    "messages": [{"role": "user", "content": user}],
                },
            )
            if resp.status_code != 200:
                raise ValueError(f"Anthropic API error {resp.status_code}: {resp.text[:200]}")
            data = resp.json()
            content = data.get("content", [])
            if content and content[0].get("type") == "text":
                text = content[0]["text"]
                # Strip markdown code fences if present (Claude sometimes wraps JSON)
                if json_mode and text.strip().startswith("```"):
                    lines = text.strip().split("\n")
                    text = "\n".join(lines[1:-1]) if len(lines) > 2 else text
                return text
            return ""

    async def test(self) -> dict[str, Any]:
        try:
            # Anthropic doesn't have a free list-models endpoint; do a tiny chat call
            async with httpx.AsyncClient(timeout=15) as client:
                resp = await client.post(
                    f"{self._base_url}/messages",
                    headers={
                        "x-api-key": self._api_key,
                        "anthropic-version": "2023-06-01",
                        "Content-Type": "application/json",
                    },
                    json={
                        "model": self._model,
                        "max_tokens": 10,
                        "messages": [{"role": "user", "content": "hi"}],
                    },
                )
                if resp.status_code == 200:
                    return {"ok": True, "message": f"Anthropic API connected. Using {self._model}."}
                if resp.status_code == 401:
                    return {"ok": False, "message": "Invalid API key"}
                error = resp.json().get("error", {}).get("message", resp.text[:200])
                return {"ok": False, "message": f"API error: {error}"}
        except Exception as e:
            return {"ok": False, "message": f"Cannot reach Anthropic API: {e}"}


# ── Factory ────────────────────────────────────────────────────

def build_provider(config: dict[str, Any]) -> LlmProvider:
    """Build a provider instance from a config dict.

    Config shape:
      {"provider": "ollama" | "openai" | "anthropic",
       "model": "...",
       "api_key": "..." (optional, for openai/anthropic),
       "base_url": "..." (optional, for ollama/openai)}
    """
    provider = config.get("provider", "ollama")
    model = config.get("model", "")
    api_key = config.get("api_key", "")
    base_url = config.get("base_url", "")

    if provider == "ollama":
        return OllamaProvider(
            base_url=base_url or "http://localhost:11434",
            model=model or "llama3.2",
        )
    elif provider == "openai":
        if not api_key:
            raise ValueError("OpenAI provider requires an API key")
        return OpenAiProvider(
            api_key=api_key,
            model=model or "gpt-4o-mini",
            base_url=base_url or None,
        )
    elif provider == "anthropic":
        if not api_key:
            raise ValueError("Anthropic provider requires an API key")
        return AnthropicProvider(
            api_key=api_key,
            model=model or "claude-sonnet-4-20250514",
        )
    else:
        raise ValueError(f"Unknown LLM provider: {provider}")


# ── Default config ─────────────────────────────────────────────

DEFAULT_LLM_CONFIG = {
    "provider": "ollama",
    "model": "llama3.2",
    "base_url": "http://localhost:11434",
    "api_key": "",
}
