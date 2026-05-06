"""Internal MCP Toolbox service.

A single shared Toolbox that manages SQLAlchemy engines for all database
connections. Mounted on the main FastAPI app, it exposes REST endpoints
at /toolbox/{connection_id}/... that are compatible with the toolbox-core
SDK's REST fallback mode.

When a user adds a database with credentials, the backend auto-generates
a toolbox_url pointing to itself (e.g. http://localhost:8080/toolbox/3).
The ToolboxClient then talks to these internal endpoints — no external
Toolbox server needed.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from fastapi import APIRouter, HTTPException, Path
from pydantic import BaseModel
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.engine import Engine

logger = logging.getLogger(__name__)

# ── Engine pool — one per connection ID ──────────────────────

_engines: dict[int, Engine] = {}

DRIVER_MAP = {
    "postgresql": "postgresql+psycopg://{user}:{password}@{host}:{port}/{database}",
    "mysql": "mysql+pymysql://{user}:{password}@{host}:{port}/{database}",
    "sqlite": "sqlite:///{file_path}",
    "mssql": "mssql+pymssql://{user}:{password}@{host}:{port}/{database}",
    "oracle": "oracle+oracledb://{user}:{password}@{host}:{port}/{database}",
}

DEFAULT_PORTS = {
    "postgresql": 5432,
    "mysql": 3306,
    "sqlite": None,
    "mssql": 1433,
    "oracle": 1521,
}


def register_connection(connection_id: int, config: dict[str, Any]) -> None:
    """Create and cache a SQLAlchemy engine for a connection."""
    if connection_id in _engines:
        _engines[connection_id].dispose()

    source_type = config["source_type"]
    template = DRIVER_MAP.get(source_type)
    if not template:
        raise ValueError(f"Unsupported database type: {source_type}")

    if source_type == "sqlite":
        url = template.format(file_path=config.get("file_path", ""))
    else:
        url = template.format(
            user=config.get("username", ""),
            password=config.get("password", ""),
            host=config.get("host", "localhost"),
            port=config.get("port") or DEFAULT_PORTS.get(source_type, 5432),
            database=config.get("database_name", ""),
        )

    connect_args: dict[str, Any] = {}
    ssl_mode = config.get("ssl_mode")
    if ssl_mode and source_type == "postgresql":
        connect_args["sslmode"] = ssl_mode

    engine = create_engine(
        url,
        connect_args=connect_args,
        pool_pre_ping=True,
        pool_size=2,
        max_overflow=3,
    )
    _engines[connection_id] = engine
    logger.info("Registered toolbox engine for connection %d (%s)", connection_id, source_type)


def unregister_connection(connection_id: int) -> None:
    """Remove and dispose a connection's engine."""
    engine = _engines.pop(connection_id, None)
    if engine:
        engine.dispose()
        logger.info("Unregistered toolbox engine for connection %d", connection_id)


def test_connection(connection_id: int) -> dict[str, Any]:
    """Test if a registered connection is reachable."""
    engine = _engines.get(connection_id)
    if not engine:
        return {"ok": False, "message": "Connection not registered in toolbox"}
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        return {"ok": True, "message": "Connection successful"}
    except Exception as e:
        return {"ok": False, "message": str(e)}


def _get_engine(connection_id: int) -> Engine:
    engine = _engines.get(connection_id)
    if not engine:
        raise HTTPException(status_code=404, detail=f"Connection {connection_id} not registered in toolbox")
    return engine


# ── REST API (mounted on main app) ──────────────────────────

router = APIRouter(prefix="/toolbox/{connection_id}", tags=["internal-toolbox"])


@router.get("/api/toolset")
def toolset(connection_id: int = Path(...)):
    """List available tools for a connection."""
    _get_engine(connection_id)  # verify it exists
    return {
        "serverVersion": "internal-1.0",
        "tools": {
            "list_tables": {
                "description": "List all tables in the database with their columns and types",
                "parameters": [],
            },
            "execute_sql": {
                "description": "Execute a SQL query against the database",
                "parameters": [
                    {"name": "sql", "type": "string", "description": "The SQL query to execute"},
                ],
            },
        },
    }


class ToolInvokeRequest(BaseModel):
    params: dict = {}


@router.post("/api/tool/{tool_name}/invoke")
def invoke_tool(
    tool_name: str,
    body: ToolInvokeRequest,
    connection_id: int = Path(...),
):
    """Invoke a tool (list_tables or execute_sql) on a connection."""
    engine = _get_engine(connection_id)

    try:
        if tool_name == "list_tables":
            insp = inspect(engine)
            tables = []
            for table_name in insp.get_table_names():
                columns = []
                for col in insp.get_columns(table_name):
                    columns.append({
                        "name": col["name"],
                        "type": str(col["type"]),
                    })
                fks = insp.get_foreign_keys(table_name)
                fk_info = [
                    {"column": fk["constrained_columns"], "references": f"{fk['referred_table']}.{fk['referred_columns']}"}
                    for fk in fks
                ]
                tables.append({"name": table_name, "columns": columns, "foreign_keys": fk_info})
            return {"result": json.dumps({"tables": tables})}

        elif tool_name == "execute_sql":
            sql = body.params.get("sql", "")
            if not sql:
                return {"error": "No SQL provided"}
            with engine.connect() as conn:
                result = conn.execute(text(sql))
                columns = list(result.keys()) if result.returns_rows else []
                rows = [list(row) for row in result.fetchall()] if result.returns_rows else []
            return {"result": json.dumps({"columns": columns, "rows": rows})}

        else:
            return {"error": f"Unknown tool: {tool_name}"}

    except Exception as e:
        logger.warning("Toolbox invoke error (conn=%d, tool=%s): %s", connection_id, tool_name, e)
        return {"error": str(e)}


@router.get("/health")
def health(connection_id: int = Path(...)):
    result = test_connection(connection_id)
    if not result["ok"]:
        raise HTTPException(status_code=503, detail=result["message"])
    return result
