from __future__ import annotations

import json
import logging
import re
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Connection, TableMetadata
from app.services.internal_toolbox import register_connection
from app.services.kb_service import KbService
from app.services.llm_service import LlmService
from app.services.toolbox_client import ToolboxClient

logger = logging.getLogger(__name__)

MAX_SQL_RETRIES = 3

# ── Intent patterns (checked before LLM) ─────────────────────

META_PATTERNS: list[tuple[str, str]] = [
    # (regex pattern, intent_key)
    (r"\b(show|list|give|get|display|what are)\b.*(all\s+)?tables?\b", "list_tables"),
    (r"\b(describe|schema|structure|columns?|fields?)\b.*\btable\b", "describe_table"),
    (r"\b(how many|count)\b.*\b(tables?|rows?)\b.*\b(database|db|each)\b", "table_stats"),
    (r"\b(which|what)\b.*\b(databases?|connections?|sources?)\b.*(connected|available|have)", "list_connections"),
]

AMBIGUOUS_PATTERNS: list[tuple[str, str]] = [
    (r"^(show|get|give)\s+(me\s+)?(the\s+)?data$", "too_vague"),
    (r"^(show|get|give)\s+(me\s+)?(everything|all)$", "too_vague"),
]


def classify_intent(question: str, connections: list[dict[str, Any]]) -> dict[str, Any]:
    """Classify the user's question into an intent before calling the LLM.

    Returns:
      {"intent": "data_query"} — normal LLM pipeline
      {"intent": "meta_query", "action": "list_tables", ...} — answer from schema
      {"intent": "clarification", "message": ..., "options": [...]} — ask user
    """
    q = question.strip().lower()

    # Check for meta-queries (questions about the database itself)
    for pattern, action in META_PATTERNS:
        if re.search(pattern, q, re.IGNORECASE):
            return {"intent": "meta_query", "action": action}

    # Check for ambiguous queries that need clarification
    for pattern, reason in AMBIGUOUS_PATTERNS:
        if re.search(pattern, q, re.IGNORECASE):
            return {
                "intent": "clarification",
                "reason": reason,
            }

    # Multi-connection ambiguity: if >1 connection and no connection_id specified,
    # and the question doesn't clearly indicate which database to use
    # → this is handled inside process_question with LLM assistance

    return {"intent": "data_query"}


class QueryEngine:
    """Agentic query engine that classifies intent, handles meta-queries
    directly, asks for clarification when needed, and auto-retries SQL errors.

    Flow:
    1. Classify intent (meta / clarification / data_query)
    2. Meta-query → answer directly from cached schema (no LLM needed)
    3. Clarification → return options for the user to pick
    4. Data query → LLM pipeline with auto-retry on SQL errors
    """

    def __init__(self, session: AsyncSession) -> None:
        self._session = session
        self._llm = LlmService()
        self._kb = KbService()

    async def process_question(
        self,
        question: str,
        connection_id: int | None = None,
        context: str | None = None,
    ) -> dict[str, Any]:
        """Main entry point. Returns a result dict with keys:
        sql, chart_spec, result_data, explanation, intent, clarification
        """
        connections = await self._load_connections(connection_id)
        if not connections:
            raise ValueError("No database connections found. Please add a connection first.")

        # If context is provided, prepend it to the question (follow-up from clarification)
        effective_question = f"{context}\n{question}" if context else question

        # ── 1. Classify intent ────────────────────────────────
        intent = classify_intent(question, connections)
        logger.info("Intent for '%s': %s", question[:80], intent)

        if intent["intent"] == "meta_query":
            return await self._handle_meta_query(intent, connections, connection_id)

        if intent["intent"] == "clarification":
            return self._handle_clarification(intent, question, connections, connection_id)

        # ── 2. Data query: check if we need clarification ─────
        needs_clarification = self._check_needs_clarification(
            question, connections, connection_id
        )
        if needs_clarification:
            return needs_clarification

        # ── 3. LLM pipeline ──────────────────────────────────
        return await self._run_llm_pipeline(effective_question, connections, connection_id)

    # ── Meta-query handler ───────────────────────────────────

    async def _handle_meta_query(
        self,
        intent: dict[str, Any],
        connections: list[dict[str, Any]],
        connection_id: int | None,
    ) -> dict[str, Any]:
        """Answer questions about database structure directly from cached schema."""
        action = intent["action"]

        if action == "list_connections":
            rows = [[c["name"], c["source_type"], c["toolbox_url"]] for c in connections]
            return {
                "intent": "meta_query",
                "sql": None,
                "chart_spec": None,
                "result_data": {
                    "columns": ["Connection Name", "Database Type", "Toolbox URL"],
                    "rows": rows,
                },
                "explanation": f"You have {len(rows)} database connection(s) configured.",
                "clarification": None,
            }

        if action == "list_tables":
            # If multiple connections and no specific one selected, show all with source
            if len(connections) > 1 and not connection_id:
                rows = []
                for c in connections:
                    schema = c.get("schema") or {}
                    profile_map = {
                        t["name"]: t for t in (c.get("profile") or {}).get("tables", [])
                    }
                    for t in schema.get("tables", []):
                        row_count = profile_map.get(t["name"], {}).get("row_count", "?")
                        col_count = len(t.get("columns", []))
                        rows.append([c["name"], t["name"], col_count, row_count])
                return {
                    "intent": "meta_query",
                    "sql": None,
                    "chart_spec": None,
                    "result_data": {
                        "columns": ["Connection", "Table Name", "Columns", "Rows"],
                        "rows": rows,
                    },
                    "explanation": f"Found {len(rows)} table(s) across {len(connections)} connection(s).",
                    "clarification": None,
                }
            else:
                conn = connections[0]
                schema = conn.get("schema") or {}
                profile_map = {
                    t["name"]: t for t in (conn.get("profile") or {}).get("tables", [])
                }
                rows = []
                for t in schema.get("tables", []):
                    prof = profile_map.get(t["name"], {})
                    rows.append([t["name"], len(t.get("columns", [])), prof.get("row_count", "?")])
                return {
                    "intent": "meta_query",
                    "sql": None,
                    "chart_spec": None,
                    "result_data": {
                        "columns": ["Table Name", "Columns", "Rows"],
                        "rows": rows,
                    },
                    "explanation": f"Database '{conn['name']}' has {len(rows)} table(s).",
                    "clarification": None,
                }

        if action == "describe_table":
            # Try to find the table name in the question
            all_tables = {}
            for c in connections:
                for t in (c.get("schema") or {}).get("tables", []):
                    all_tables[t["name"].lower()] = (c, t)

            # Find which table the user is asking about
            found = None
            for tname in all_tables:
                if tname in intent.get("question", "").lower() or tname in "":
                    found = all_tables[tname]
                    break

            if not found:
                # Can't determine which table — ask
                table_names = list(all_tables.keys())
                return {
                    "intent": "clarification",
                    "sql": None,
                    "chart_spec": None,
                    "result_data": None,
                    "explanation": None,
                    "clarification": {
                        "message": "Which table would you like to describe?",
                        "options": [
                            {"label": name, "value": f"Describe the {name} table"}
                            for name in table_names[:10]
                        ],
                    },
                }

            conn, table = found
            profile_map = {
                t["name"]: t for t in (conn.get("profile") or {}).get("tables", [])
            }
            prof = profile_map.get(table["name"], {})
            rows = []
            for col in table.get("columns", []):
                prof_col = next(
                    (pc for pc in prof.get("columns", []) if pc.get("name") == col["name"]),
                    {},
                )
                rows.append([
                    col["name"],
                    col.get("type", "?"),
                    prof_col.get("distinct_count", "?"),
                ])
            return {
                "intent": "meta_query",
                "sql": None,
                "chart_spec": None,
                "result_data": {
                    "columns": ["Column Name", "Type", "Distinct Values"],
                    "rows": rows,
                },
                "explanation": (
                    f"Table '{table['name']}' in '{conn['name']}' has {len(rows)} column(s) "
                    f"and {prof.get('row_count', '?')} row(s)."
                ),
                "clarification": None,
            }

        if action == "table_stats":
            rows = []
            for c in connections:
                for t in (c.get("profile") or {}).get("tables", []):
                    rows.append([c["name"], t["name"], t.get("row_count", "?")])
            return {
                "intent": "meta_query",
                "sql": None,
                "chart_spec": None,
                "result_data": {
                    "columns": ["Connection", "Table", "Row Count"],
                    "rows": rows,
                },
                "explanation": f"Row counts across {len(connections)} connection(s).",
                "clarification": None,
            }

        # Fallback to LLM
        return await self._run_llm_pipeline(intent.get("question", ""), connections, None)

    # ── Clarification handler ────────────────────────────────

    def _handle_clarification(
        self,
        intent: dict[str, Any],
        question: str,
        connections: list[dict[str, Any]],
        connection_id: int | None,
    ) -> dict[str, Any]:
        """Build a clarification response when the question is too vague."""
        # Collect all table names for suggestions
        table_names = []
        for c in connections:
            for t in (c.get("schema") or {}).get("tables", []):
                table_names.append(f"{t['name']} ({c['name']})")

        return {
            "intent": "clarification",
            "sql": None,
            "chart_spec": None,
            "result_data": None,
            "explanation": None,
            "clarification": {
                "message": "Your question is a bit broad. Could you be more specific? Here are some things you can ask:",
                "options": [
                    {"label": "Show all tables", "value": "Show me all tables in all databases"},
                    {"label": "List connections", "value": "What databases are connected?"},
                    *[
                        {"label": f"Explore {name}", "value": f"What data is in the {name.split(' ')[0]} table?"}
                        for name in table_names[:4]
                    ],
                ],
            },
        }

    def _check_needs_clarification(
        self,
        question: str,
        connections: list[dict[str, Any]],
        connection_id: int | None,
    ) -> dict[str, Any] | None:
        """Check if we need to ask the user for clarification before running the LLM."""
        # Multiple connections, no specific one selected
        if len(connections) > 1 and not connection_id:
            # Check if the question clearly references a specific database
            q_lower = question.lower()
            matching_conns = [
                c for c in connections
                if c["name"].lower() in q_lower
            ]
            if not matching_conns:
                return {
                    "intent": "clarification",
                    "sql": None,
                    "chart_spec": None,
                    "result_data": None,
                    "explanation": None,
                    "clarification": {
                        "message": f"You have {len(connections)} databases connected. Which one should I query?",
                        "options": [
                            {
                                "label": f"{c['name']} ({c['source_type']})",
                                "value": f"Query the {c['name']} database: {question}",
                            }
                            for c in connections
                        ] + [
                            {"label": "Search all databases", "value": question},
                        ],
                    },
                }

        # No schema synced for the target connection
        target = connections[0] if len(connections) == 1 else None
        if connection_id:
            target = next((c for c in connections if c["id"] == connection_id), None)
        if target and not target.get("schema"):
            return {
                "intent": "clarification",
                "sql": None,
                "chart_spec": None,
                "result_data": None,
                "explanation": None,
                "clarification": {
                    "message": (
                        f"The connection '{target['name']}' hasn't been synced yet. "
                        "Please go to Connections and click 'Sync Schema' first."
                    ),
                    "options": [
                        {"label": "Go to Connections", "value": "__navigate:/connections"},
                    ],
                },
            }

        return None

    # ── LLM pipeline (with auto-retry) ───────────────────────

    async def _run_llm_pipeline(
        self,
        question: str,
        connections: list[dict[str, Any]],
        connection_id: int | None,
    ) -> dict[str, Any]:
        """Full LLM pipeline: table selection → SQL generation → execution → retry."""
        # Stage 1: Select relevant tables
        schema_summary = self._llm.build_schema_summary(connections)
        selected_tables = await self._llm.select_relevant_tables(question, schema_summary)

        if not selected_tables:
            raise ValueError("Could not identify relevant tables for your question.")

        # Search knowledge base
        kb_chunks = self._kb.search(question, top_k=5)

        # Stage 2: Generate SQL + chart spec
        full_context = self._llm.build_full_context(selected_tables, connections, kb_chunks)
        llm_result = await self._llm.generate_sql_and_chart(question, full_context)

        sql = llm_result.get("sql", "")
        if not sql:
            raise ValueError("LLM did not generate a SQL query.")

        # Execute with auto-retry
        target_conn = self._resolve_connection(selected_tables, connections)
        client = self._get_client(target_conn)

        result_data = None
        last_error = ""

        for attempt in range(1, MAX_SQL_RETRIES + 1):
            try:
                result_data = await client.execute_sql(sql)
                if attempt > 1:
                    logger.info("SQL succeeded on attempt %d after %d repair(s)", attempt, attempt - 1)
                break
            except Exception as e:
                last_error = str(e)
                logger.warning(
                    "SQL failed (attempt %d/%d): %s | SQL: %s",
                    attempt, MAX_SQL_RETRIES, last_error, sql[:200],
                )
                if attempt < MAX_SQL_RETRIES:
                    try:
                        repair = await self._llm.repair_sql(
                            question=question,
                            full_context=full_context,
                            failed_sql=sql,
                            error_message=last_error,
                            attempt=attempt,
                        )
                        new_sql = repair.get("sql", "")
                        if new_sql and new_sql != sql:
                            logger.info("LLM repaired SQL (attempt %d)", attempt)
                            sql = new_sql
                            if repair.get("chart_spec"):
                                llm_result["chart_spec"] = repair["chart_spec"]
                            if repair.get("explanation"):
                                llm_result["explanation"] = repair["explanation"]
                        else:
                            break
                    except Exception as repair_err:
                        logger.warning("LLM repair failed: %s", repair_err)
                        break

        if result_data is None:
            raise ValueError(f"SQL execution failed after {MAX_SQL_RETRIES} attempts: {last_error}")

        return {
            "intent": "data_query",
            "sql": sql,
            "chart_spec": llm_result.get("chart_spec"),
            "result_data": result_data,
            "explanation": llm_result.get("explanation", ""),
            "clarification": None,
        }

    # ── Helpers ───────────────────────────────────────────────

    async def _load_connections(self, connection_id: int | None) -> list[dict[str, Any]]:
        if connection_id:
            conn = await self._session.get(Connection, connection_id)
            if not conn:
                raise ValueError(f"Connection {connection_id} not found")
            conns = [conn]
        else:
            result = await self._session.execute(select(Connection))
            conns = list(result.scalars().all())

        connections = []
        for conn in conns:
            meta_result = await self._session.execute(
                select(TableMetadata).where(TableMetadata.connection_id == conn.id)
            )
            meta_rows = meta_result.scalars().all()
            metadata_tables = [
                {
                    "table_name": m.table_name,
                    "description": m.description or "",
                    "columns": m.get_column_metadata() or [],
                }
                for m in meta_rows
            ]
            connections.append({
                "id": conn.id,
                "name": conn.name,
                "connection_type": conn.connection_type or "direct",
                "toolbox_url": conn.toolbox_url,
                "source_type": conn.source_type,
                "host": conn.host,
                "port": conn.port,
                "database_name": conn.database_name,
                "username": conn.username,
                "password": conn.password,
                "ssl_mode": conn.ssl_mode,
                "file_path": conn.file_path,
                "schema": conn.get_schema_cache(),
                "profile": conn.get_schema_profile(),
                "metadata": {"tables": metadata_tables},
            })
        return connections

    def _get_client(self, conn: dict[str, Any]):
        """Return a ToolboxClient for the connection.

        All connections go through the MCP Toolbox protocol — either our
        internal toolbox (for user-provided credentials) or an external one.
        Lazily registers the engine in the internal toolbox if needed.
        """
        toolbox_url = conn.get("toolbox_url")
        if not toolbox_url:
            raise ValueError(f"Connection '{conn.get('name')}' has no toolbox_url configured")

        # If it's an internal toolbox URL, ensure the engine is registered
        if "/toolbox/" in toolbox_url:
            register_connection(conn["id"], {
                "source_type": conn.get("source_type"),
                "host": conn.get("host"),
                "port": conn.get("port"),
                "database_name": conn.get("database_name"),
                "username": conn.get("username"),
                "password": conn.get("password"),
                "ssl_mode": conn.get("ssl_mode"),
                "file_path": conn.get("file_path"),
            })

        return ToolboxClient(toolbox_url)

    def _resolve_connection(
        self, selected_tables: list[dict[str, Any]], connections: list[dict[str, Any]]
    ) -> dict[str, Any]:
        if len(connections) == 1:
            return connections[0]
        if selected_tables:
            conn_name = selected_tables[0].get("connection_name", "")
            for conn in connections:
                if conn["name"] == conn_name:
                    return conn
        return connections[0]
