from __future__ import annotations

import json
import logging
from typing import Any

from app.services.llm_providers import LlmProvider, build_provider
from app.services.settings_store import get_llm_config

logger = logging.getLogger(__name__)


class LlmService:
    """Two-stage LLM service for text-to-SQL and chart generation.

    Supports multiple providers (Ollama, OpenAI, Anthropic) based on the
    active LLM config in app_settings. The provider is loaded lazily on
    first use so settings changes take effect immediately.
    """

    def __init__(self, provider: LlmProvider | None = None) -> None:
        self._provider: LlmProvider | None = provider

    async def _get_provider(self) -> LlmProvider:
        if self._provider is None:
            config = await get_llm_config()
            self._provider = build_provider(config)
        return self._provider

    # ── Stage 1: Schema Selection ────────────────────────────

    def build_schema_summary(self, connections: list[dict[str, Any]]) -> str:
        """Build a compact schema summary for Stage 1 (table selection).

        Only includes table names, row counts, and user descriptions — no sample data.
        """
        lines = []
        for conn in connections:
            lines.append(f'[Connection: "{conn["name"]}" ({conn["source_type"]})]')

            profile = conn.get("profile", {})
            metadata = conn.get("metadata", {})
            tables = profile.get("tables", []) if profile else []
            schema_tables = conn.get("schema", {}).get("tables", []) if conn.get("schema") else []

            # Merge schema and profile info
            table_info = {}
            for t in schema_tables:
                name = t.get("name", "")
                table_info[name] = {"columns": [c.get("name", "") for c in t.get("columns", [])]}
            for t in tables:
                name = t.get("name", "")
                if name in table_info:
                    table_info[name]["row_count"] = t.get("row_count", "?")
                else:
                    table_info[name] = {"row_count": t.get("row_count", "?"), "columns": []}

            # Add metadata descriptions
            meta_tables = metadata.get("tables", []) if metadata else []
            meta_map = {m.get("table_name", ""): m for m in meta_tables}

            for tname, tinfo in table_info.items():
                desc = meta_map.get(tname, {}).get("description", "")
                row_count = tinfo.get("row_count", "?")
                col_names = ", ".join(tinfo.get("columns", [])[:10])
                suffix = ", ..." if len(tinfo.get("columns", [])) > 10 else ""
                desc_part = f" — {desc}" if desc else ""
                lines.append(f"  - {tname} ({row_count} rows, columns: {col_names}{suffix}){desc_part}")

            lines.append("")
        return "\n".join(lines)

    async def select_relevant_tables(
        self, question: str, schema_summary: str
    ) -> list[dict[str, Any]]:
        """Stage 1: Given a question and compact schema summaries, identify relevant tables."""
        system_prompt = (
            "You are a database expert. Given the user's question, identify which database "
            "connections and tables are needed to answer it.\n\n"
            "Available databases and tables:\n"
            f"{schema_summary}\n\n"
            "Reply with ONLY valid JSON in this format:\n"
            '{"selected_tables": [{"connection_name": "...", "tables": ["table1", "table2"]}]}\n\n'
            "Rules:\n"
            "- Select only the tables that are directly relevant to the question\n"
            "- If multiple connections are needed, include entries for each\n"
            "- If unsure, include tables that might be relevant rather than excluding them"
        )

        provider = await self._get_provider()
        content = await provider.chat(system=system_prompt, user=question, json_mode=True)

        try:
            result = json.loads(content)
            return result.get("selected_tables", [])
        except (json.JSONDecodeError, AttributeError) as e:
            logger.error("Failed to parse Stage 1 response: %s", e)
            return []

    # ── Stage 2: SQL + Chart Generation ──────────────────────

    def build_full_context(
        self,
        selected_tables: list[dict[str, Any]],
        connections: list[dict[str, Any]],
        kb_chunks: list[dict[str, Any]],
    ) -> str:
        """Build rich context for Stage 2 — only for selected tables.

        Includes: columns, types, sample rows, statistics, user descriptions, KB chunks.
        """
        lines = []

        conn_map = {c["name"]: c for c in connections}

        for selection in selected_tables:
            conn_name = selection.get("connection_name", "")
            conn = conn_map.get(conn_name)
            if not conn:
                continue

            lines.append(f'Database: {conn_name} ({conn["source_type"]} dialect)')
            lines.append("")

            profile = conn.get("profile", {})
            metadata = conn.get("metadata", {})
            profile_tables = {t["name"]: t for t in (profile.get("tables", []) if profile else [])}
            schema_tables = {
                t["name"]: t for t in (conn.get("schema", {}).get("tables", []) if conn.get("schema") else [])
            }
            meta_tables = {
                m.get("table_name", ""): m
                for m in (metadata.get("tables", []) if metadata else [])
            }

            for table_name in selection.get("tables", []):
                prof = profile_tables.get(table_name, {})
                schema = schema_tables.get(table_name, {})
                meta = meta_tables.get(table_name, {})

                row_count = prof.get("row_count", "?")
                table_desc = meta.get("description", "")
                lines.append(f"Table: {table_name} ({row_count} rows)")
                if table_desc:
                    lines.append(f"  Description: {table_desc}")

                # Columns with types, stats, descriptions
                schema_cols = {c["name"]: c for c in schema.get("columns", [])}
                profile_cols = {c["name"]: c for c in prof.get("columns", [])}
                meta_cols = {
                    c.get("column_name", ""): c
                    for c in meta.get("columns", [])
                }

                all_col_names = list(schema_cols.keys()) or list(profile_cols.keys())
                lines.append("  Columns:")
                for col_name in all_col_names:
                    sc = schema_cols.get(col_name, {})
                    pc = profile_cols.get(col_name, {})
                    mc = meta_cols.get(col_name, {})

                    col_type = sc.get("type", pc.get("type", "UNKNOWN"))
                    dist = pc.get("distinct_count", "")
                    dist_part = f", {dist} distinct" if dist else ""

                    # Min/max/avg for numeric types
                    stats_parts = []
                    for stat in ("min", "max", "avg"):
                        val = pc.get(stat)
                        if val is not None:
                            stats_parts.append(f"{stat}={val}")
                    stats_str = f", {', '.join(stats_parts)}" if stats_parts else ""

                    # Sample values for categorical columns
                    samples = pc.get("sample_values")
                    samples_str = f", samples: {samples}" if samples else ""

                    # User description
                    col_desc = mc.get("description", "")
                    desc_str = f' — "{col_desc}"' if col_desc else ""

                    lines.append(
                        f"    - {col_name} ({col_type}{dist_part}{stats_str}{samples_str}){desc_str}"
                    )

                # Sample rows
                sample_rows = prof.get("sample_rows", [])
                if sample_rows:
                    lines.append(f"  Sample rows: {json.dumps(sample_rows[:2], default=str)}")

                lines.append("")

        # Knowledge base context
        if kb_chunks:
            lines.append("Domain Knowledge:")
            for chunk in kb_chunks:
                lines.append(f"  - {chunk.get('chunk_text', '')[:500]}")
            lines.append("")

        return "\n".join(lines)

    async def generate_sql_and_chart(
        self, question: str, full_context: str
    ) -> dict[str, Any]:
        """Stage 2: Generate SQL query and chart specification."""
        system_prompt = (
            "You are an expert SQL analyst. Generate a SQL query and chart specification "
            "to answer the user's question.\n\n"
            f"{full_context}\n\n"
            "Reply with ONLY valid JSON in this exact format:\n"
            "{\n"
            '  "sql": "SELECT ... FROM ...",\n'
            '  "chart_spec": {\n'
            '    "chart_type": "bar",\n'
            '    "title": "Chart Title",\n'
            '    "x_axis": {"field": "column_name", "label": "X Label"},\n'
            '    "y_axis": {"field": "column_name", "label": "Y Label"},\n'
            '    "series": [{"field": "column_name", "label": "Series Label", "color": "#3b82f6"}]\n'
            "  },\n"
            '  "explanation": "Brief explanation of what the query does and how it answers the question"\n'
            "}\n\n"
            "Rules:\n"
            "- Use the correct SQL dialect for the database specified above\n"
            "- Use proper column names exactly as shown in the schema\n"
            "- Apply any relevant formulas or rules from the Domain Knowledge section\n"
            "- chart_type must be one of: bar, line, area, pie, scatter\n"
            "- The x_axis and y_axis fields must match column aliases in your SQL SELECT\n"
            "- Keep the SQL readable and add aliases for calculated columns\n"
            "- If the question requires data from multiple tables, use JOINs\n"
            "- Limit results to a reasonable number of rows for chart readability"
        )

        provider = await self._get_provider()
        content = await provider.chat(system=system_prompt, user=question, json_mode=True)

        try:
            result = json.loads(content)
            return {
                "sql": result.get("sql", ""),
                "chart_spec": result.get("chart_spec", {}),
                "explanation": result.get("explanation", ""),
            }
        except (json.JSONDecodeError, AttributeError) as e:
            logger.error("Failed to parse Stage 2 response: %s", e)
            raise ValueError(f"LLM returned invalid JSON: {e}")

    # ── SQL Repair (auto-retry on error) ─────────────────────

    async def repair_sql(
        self,
        question: str,
        full_context: str,
        failed_sql: str,
        error_message: str,
        attempt: int,
    ) -> dict[str, Any]:
        """Ask the LLM to fix a SQL query that failed execution.

        Sends the original question, schema context, the broken SQL,
        and the database error message so the LLM can self-correct.
        """
        system_prompt = (
            "You are an expert SQL analyst. A previous SQL query failed with an error. "
            "Fix the query based on the error message and the database schema.\n\n"
            f"{full_context}\n\n"
            "Reply with ONLY valid JSON in this exact format:\n"
            "{\n"
            '  "sql": "SELECT ... FROM ...",\n'
            '  "chart_spec": {\n'
            '    "chart_type": "bar",\n'
            '    "title": "Chart Title",\n'
            '    "x_axis": {"field": "column_name", "label": "X Label"},\n'
            '    "y_axis": {"field": "column_name", "label": "Y Label"},\n'
            '    "series": [{"field": "column_name", "label": "Series Label", "color": "#3b82f6"}]\n'
            "  },\n"
            '  "explanation": "Brief explanation of what the query does"\n'
            "}\n\n"
            "CRITICAL RULES:\n"
            "- ONLY use table names and column names that appear in the schema above\n"
            "- Do NOT invent or guess table or column names\n"
            "- Fix the specific error described below\n"
            "- Keep the same intent as the original query"
        )

        user_msg = (
            f"Original question: {question}\n\n"
            f"Failed SQL (attempt {attempt}):\n{failed_sql}\n\n"
            f"Database error:\n{error_message}\n\n"
            "Please fix the SQL query. Use ONLY the tables and columns listed in the schema above."
        )

        logger.info("Repair attempt %d for SQL: %s | Error: %s", attempt, failed_sql[:100], error_message[:100])

        provider = await self._get_provider()
        content = await provider.chat(system=system_prompt, user=user_msg, json_mode=True)

        try:
            result = json.loads(content)
            return {
                "sql": result.get("sql", ""),
                "chart_spec": result.get("chart_spec", {}),
                "explanation": result.get("explanation", ""),
            }
        except (json.JSONDecodeError, AttributeError) as e:
            logger.error("Failed to parse repair response: %s", e)
            raise ValueError(f"LLM returned invalid JSON during repair: {e}")
