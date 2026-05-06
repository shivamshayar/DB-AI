"""Simple key-value settings store backed by the app_settings table."""

from __future__ import annotations

import json
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import async_session
from app.models import AppSetting
from app.services.llm_providers import DEFAULT_LLM_CONFIG

LLM_CONFIG_KEY = "llm_config"


async def get_setting(key: str, default: Any = None) -> Any:
    """Read a setting value."""
    async with async_session() as session:
        result = await session.execute(select(AppSetting).where(AppSetting.key == key))
        row = result.scalar_one_or_none()
        if row:
            return row.get_value()
        return default


async def set_setting(key: str, value: Any) -> None:
    """Write a setting value (upsert)."""
    async with async_session() as session:
        existing = await session.get(AppSetting, key)
        if existing:
            existing.value = json.dumps(value)
        else:
            session.add(AppSetting(key=key, value=json.dumps(value)))
        await session.commit()


async def get_llm_config() -> dict[str, Any]:
    """Get the active LLM config, falling back to defaults."""
    config = await get_setting(LLM_CONFIG_KEY, default=None)
    if not config:
        return dict(DEFAULT_LLM_CONFIG)
    # Merge with defaults in case new fields are added
    merged = dict(DEFAULT_LLM_CONFIG)
    merged.update(config)
    return merged


async def set_llm_config(config: dict[str, Any]) -> None:
    """Save the LLM config."""
    await set_setting(LLM_CONFIG_KEY, config)


# Sync helpers for code that can't be async (used inside a running session)

async def get_setting_in_session(session: AsyncSession, key: str, default: Any = None) -> Any:
    result = await session.execute(select(AppSetting).where(AppSetting.key == key))
    row = result.scalar_one_or_none()
    if row:
        return row.get_value()
    return default


async def get_llm_config_in_session(session: AsyncSession) -> dict[str, Any]:
    config = await get_setting_in_session(session, LLM_CONFIG_KEY, default=None)
    if not config:
        return dict(DEFAULT_LLM_CONFIG)
    merged = dict(DEFAULT_LLM_CONFIG)
    merged.update(config)
    return merged
