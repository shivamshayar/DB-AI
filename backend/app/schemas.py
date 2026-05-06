from __future__ import annotations

import datetime
from typing import Any

from pydantic import BaseModel


# ── Settings ────────────────────────────────────────────────

class LlmConfig(BaseModel):
    provider: str  # ollama | openai | anthropic
    model: str
    api_key: str = ""
    base_url: str = ""


class LlmTestResult(BaseModel):
    ok: bool
    message: str


# ── Connections ──────────────────────────────────────────────

class ConnectionCreate(BaseModel):
    name: str
    connection_type: str = "direct"  # direct | toolbox
    source_type: str  # postgresql, mysql, sqlite, mssql, oracle
    # Direct connection
    host: str | None = None
    port: int | None = None
    database_name: str | None = None
    username: str | None = None
    password: str | None = None
    ssl_mode: str | None = None
    extra_params: dict[str, Any] | None = None
    # SQLite
    file_path: str | None = None
    # MCP Toolbox
    toolbox_url: str | None = None


class ConnectionResponse(BaseModel):
    id: int
    name: str
    connection_type: str
    source_type: str
    host: str | None = None
    port: int | None = None
    database_name: str | None = None
    username: str | None = None
    ssl_mode: str | None = None
    file_path: str | None = None
    toolbox_url: str | None = None
    schema_cache: dict[str, Any] | None = None
    schema_profile: dict[str, Any] | None = None
    test_result: dict[str, Any] | None = None
    created_at: datetime.datetime

    model_config = {"from_attributes": True}


class ConnectionListResponse(BaseModel):
    id: int
    name: str
    connection_type: str
    source_type: str
    host: str | None = None
    database_name: str | None = None
    has_schema: bool
    created_at: datetime.datetime


# ── Table Metadata ───────────────────────────────────────────

class ColumnMetadataItem(BaseModel):
    column_name: str
    description: str = ""


class TableMetadataItem(BaseModel):
    table_name: str
    description: str = ""
    columns: list[ColumnMetadataItem] = []


class MetadataUpdate(BaseModel):
    tables: list[TableMetadataItem]


class MetadataResponse(BaseModel):
    connection_id: int
    tables: list[TableMetadataItem]


# ── Knowledge Base ───────────────────────────────────────────

class KbDocumentResponse(BaseModel):
    id: int
    title: str
    file_name: str
    file_type: str
    status: str
    created_at: datetime.datetime

    model_config = {"from_attributes": True}


class KbSearchRequest(BaseModel):
    query: str
    top_k: int = 5


class KbSearchResult(BaseModel):
    chunk_text: str
    document_title: str
    page_number: int | None
    score: float


# ── Queries ──────────────────────────────────────────────────

class QueryRequest(BaseModel):
    question: str
    connection_id: int | None = None
    context: str | None = None
    thread_id: int | None = None  # None = auto-create new thread


class ClarificationOption(BaseModel):
    label: str
    value: str


class ClarificationData(BaseModel):
    message: str
    options: list[ClarificationOption]


class QueryResponse(BaseModel):
    id: int
    thread_id: int | None
    question: str
    connection_id: int | None
    sql_generated: str | None
    chart_spec: dict[str, Any] | None
    result_data: dict[str, Any] | None  # {columns: [...], rows: [[...]]}
    explanation: str | None
    intent: str | None
    clarification: ClarificationData | None
    status: str
    error_message: str | None
    created_at: datetime.datetime

    model_config = {"from_attributes": True}


class QueryListResponse(BaseModel):
    id: int
    question: str
    status: str
    created_at: datetime.datetime

    model_config = {"from_attributes": True}


# ── Chat Threads ─────────────────────────────────────────────

class ChatThreadResponse(BaseModel):
    id: int
    title: str
    created_at: datetime.datetime
    updated_at: datetime.datetime
    message_count: int = 0
    last_question: str | None = None

class ChatThreadDetailResponse(BaseModel):
    id: int
    title: str
    created_at: datetime.datetime
    messages: list[QueryResponse]


# ── Dashboards ───────────────────────────────────────────────

class DashboardCreate(BaseModel):
    title: str
    description: str = ""


class PanelCreate(BaseModel):
    query_id: int
    title: str
    layout: dict[str, Any] | None = None  # {x, y, w, h}


class PanelUpdate(BaseModel):
    title: str | None = None
    layout: dict[str, Any] | None = None


class PanelResponse(BaseModel):
    id: int
    query_id: int
    title: str
    layout: dict[str, Any] | None
    chart_spec: dict[str, Any] | None
    result_data: dict[str, Any] | None
    created_at: datetime.datetime


class DashboardResponse(BaseModel):
    id: int
    title: str
    description: str | None
    panels: list[PanelResponse]
    created_at: datetime.datetime


class DashboardListResponse(BaseModel):
    id: int
    title: str
    description: str | None
    panel_count: int
    created_at: datetime.datetime
