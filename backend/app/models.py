from __future__ import annotations

import datetime
import json
from typing import Any

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


class Connection(Base):
    __tablename__ = "connections"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    connection_type: Mapped[str] = mapped_column(String(20), default="direct")  # direct | toolbox
    source_type: Mapped[str] = mapped_column(String(50), nullable=False)  # postgresql, mysql, sqlite, mssql, oracle
    # Direct connection fields
    host: Mapped[str | None] = mapped_column(String(255), nullable=True)
    port: Mapped[int | None] = mapped_column(Integer, nullable=True)
    database_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    username: Mapped[str | None] = mapped_column(String(255), nullable=True)
    password: Mapped[str | None] = mapped_column(String(500), nullable=True)
    ssl_mode: Mapped[str | None] = mapped_column(String(50), nullable=True)  # disable, require, verify-ca, etc.
    extra_params: Mapped[str | None] = mapped_column(Text, nullable=True)  # JSON: driver-specific options
    # SQLite specific
    file_path: Mapped[str | None] = mapped_column(String(500), nullable=True)
    # MCP Toolbox
    toolbox_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    # Schema
    schema_cache: Mapped[str | None] = mapped_column(Text, nullable=True)  # JSON: tables/columns/types
    schema_profile: Mapped[str | None] = mapped_column(Text, nullable=True)  # JSON: sample rows, column stats
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )

    table_metadata: Mapped[list[TableMetadata]] = relationship(
        back_populates="connection", cascade="all, delete-orphan"
    )

    def get_schema_cache(self) -> dict[str, Any] | None:
        return json.loads(self.schema_cache) if self.schema_cache else None

    def get_schema_profile(self) -> dict[str, Any] | None:
        return json.loads(self.schema_profile) if self.schema_profile else None


class TableMetadata(Base):
    __tablename__ = "table_metadata"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    connection_id: Mapped[int] = mapped_column(ForeignKey("connections.id"), nullable=False)
    table_name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    column_metadata: Mapped[str | None] = mapped_column(Text, nullable=True)  # JSON: [{name, description}]
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )

    connection: Mapped[Connection] = relationship(back_populates="table_metadata")

    def get_column_metadata(self) -> list[dict[str, str]] | None:
        return json.loads(self.column_metadata) if self.column_metadata else None


class KbDocument(Base):
    __tablename__ = "kb_documents"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    file_name: Mapped[str] = mapped_column(String(255), nullable=False)
    file_path: Mapped[str] = mapped_column(String(500), nullable=False)
    file_type: Mapped[str] = mapped_column(String(20), nullable=False)  # pdf, txt, md, csv
    status: Mapped[str] = mapped_column(String(20), default="processing")  # processing, ready, error
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )

    chunks: Mapped[list[KbChunk]] = relationship(
        back_populates="document", cascade="all, delete-orphan"
    )


class KbChunk(Base):
    __tablename__ = "kb_chunks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    document_id: Mapped[int] = mapped_column(ForeignKey("kb_documents.id"), nullable=False)
    chunk_text: Mapped[str] = mapped_column(Text, nullable=False)
    page_number: Mapped[int | None] = mapped_column(Integer, nullable=True)
    chunk_index: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )

    document: Mapped[KbDocument] = relationship(back_populates="chunks")


class ChatThread(Base):
    __tablename__ = "chat_threads"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    title: Mapped[str] = mapped_column(String(255), default="New Chat")
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime.datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now(), nullable=False
    )

    messages: Mapped[list[Query]] = relationship(
        back_populates="thread", cascade="all, delete-orphan",
        order_by="Query.created_at",
    )


class Query(Base):
    __tablename__ = "queries"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    thread_id: Mapped[int | None] = mapped_column(ForeignKey("chat_threads.id"), nullable=True)
    question: Mapped[str] = mapped_column(Text, nullable=False)
    connection_id: Mapped[int | None] = mapped_column(ForeignKey("connections.id"), nullable=True)
    sql_generated: Mapped[str | None] = mapped_column(Text, nullable=True)
    chart_spec: Mapped[str | None] = mapped_column(Text, nullable=True)  # JSON
    result_data: Mapped[str | None] = mapped_column(Text, nullable=True)  # JSON: {columns, rows}
    explanation: Mapped[str | None] = mapped_column(Text, nullable=True)
    intent: Mapped[str | None] = mapped_column(String(30), nullable=True)  # data_query, meta_query, clarification
    clarification: Mapped[str | None] = mapped_column(Text, nullable=True)  # JSON: {message, options[]}
    status: Mapped[str] = mapped_column(String(20), default="pending")  # pending, running, completed, clarification, error
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )

    thread: Mapped[ChatThread | None] = relationship(back_populates="messages")

    def get_chart_spec(self) -> dict[str, Any] | None:
        return json.loads(self.chart_spec) if self.chart_spec else None

    def get_result_data(self) -> dict[str, Any] | None:
        return json.loads(self.result_data) if self.result_data else None

    def get_clarification(self) -> dict[str, Any] | None:
        return json.loads(self.clarification) if self.clarification else None


class Dashboard(Base):
    __tablename__ = "dashboards"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )

    panels: Mapped[list[DashboardPanel]] = relationship(
        back_populates="dashboard", cascade="all, delete-orphan"
    )


class DashboardPanel(Base):
    __tablename__ = "dashboard_panels"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    dashboard_id: Mapped[int] = mapped_column(ForeignKey("dashboards.id"), nullable=False)
    query_id: Mapped[int] = mapped_column(ForeignKey("queries.id"), nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    layout: Mapped[str | None] = mapped_column(Text, nullable=True)  # JSON: {x, y, w, h}
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )

    dashboard: Mapped[Dashboard] = relationship(back_populates="panels")
    query: Mapped[Query] = relationship()


class AppSetting(Base):
    """Key-value store for app settings (LLM provider config, etc)."""
    __tablename__ = "app_settings"

    key: Mapped[str] = mapped_column(String(100), primary_key=True)
    value: Mapped[str] = mapped_column(Text, nullable=False)  # JSON
    updated_at: Mapped[datetime.datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now(), nullable=False
    )

    def get_value(self) -> Any:
        return json.loads(self.value) if self.value else None
