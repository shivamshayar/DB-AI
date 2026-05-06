from __future__ import annotations

from fastapi import APIRouter

from app.schemas import LlmConfig, LlmTestResult
from app.services.llm_providers import build_provider
from app.services.settings_store import get_llm_config, set_llm_config

router = APIRouter(prefix="/settings", tags=["settings"])


@router.get("/llm", response_model=LlmConfig)
async def get_llm_settings():
    """Return the active LLM configuration.

    Note: returns the API key as-is. This is a single-user local app so this
    is fine, but be aware if deploying to multi-tenant environments.
    """
    config = await get_llm_config()
    return LlmConfig(**config)


@router.put("/llm", response_model=LlmConfig)
async def update_llm_settings(body: LlmConfig):
    """Save the LLM configuration. Takes effect immediately."""
    config = body.model_dump()
    await set_llm_config(config)
    return LlmConfig(**config)


@router.post("/llm/test", response_model=LlmTestResult)
async def test_llm_settings(body: LlmConfig):
    """Test an LLM configuration without saving it."""
    try:
        provider = build_provider(body.model_dump())
        result = await provider.test()
        return LlmTestResult(**result)
    except Exception as e:
        return LlmTestResult(ok=False, message=str(e))
