from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Ollama
    ollama_base_url: str = "http://localhost:11434"
    ollama_model: str = "llama3.2"

    # App database (SQLite)
    database_url: str = "sqlite+aiosqlite:///data/app.db"

    # ChromaDB
    chromadb_path: str = "data/chromadb"

    # File uploads
    upload_dir: str = "uploads"

    # CORS
    cors_origins: list[str] = ["http://localhost:3000"]

    # Query limits
    default_max_rows: int = 1000


@lru_cache
def get_settings() -> Settings:
    return Settings()
