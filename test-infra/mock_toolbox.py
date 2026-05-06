"""
Mock MCP Toolbox server — wraps a SQLite database and exposes
list_tables, describe_table, and execute_sql as REST endpoints
compatible with toolbox-core SDK.
"""

import json
import sqlite3
import os
import sys

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

DB_PATH = os.path.join(os.path.dirname(__file__), "test_factory.db")

app = FastAPI(title="Mock MCP Toolbox")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


def get_conn():
    return sqlite3.connect(DB_PATH)


# ── Toolbox-core compatible endpoints ────────────────────────
# The toolbox-core SDK expects:
#   GET /api/toolset  → list of tools
#   POST /api/tool/{name}/invoke  → invoke a tool


@app.get("/api/toolset")
def list_toolset():
    """Return the list of available tools (toolbox-core format)."""
    return {
        "serverVersion": "mock-1.0",
        "tools": {
            "list_tables": {
                "description": "List all tables in the database",
                "parameters": [],
            },
            "execute_sql": {
                "description": "Execute a SQL query",
                "parameters": [
                    {"name": "sql", "type": "string", "description": "SQL query to execute"},
                ],
            },
        },
    }


class ToolInvokeRequest(BaseModel):
    params: dict = {}


@app.post("/api/tool/{tool_name}/invoke")
def invoke_tool(tool_name: str, body: ToolInvokeRequest):
    conn = get_conn()
    conn.row_factory = sqlite3.Row

    try:
        if tool_name == "list_tables":
            cursor = conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
            )
            tables = []
            for row in cursor:
                table_name = row["name"]
                cols_cursor = conn.execute(f"PRAGMA table_info({table_name})")
                columns = [
                    {"name": col["name"], "type": col["type"]}
                    for col in cols_cursor
                ]
                tables.append({"name": table_name, "columns": columns})
            return {"result": json.dumps({"tables": tables})}

        elif tool_name == "execute_sql":
            sql = body.params.get("sql", "")
            cursor = conn.execute(sql)
            columns = [desc[0] for desc in cursor.description] if cursor.description else []
            rows = [list(row) for row in cursor.fetchall()]
            return {"result": json.dumps({"columns": columns, "rows": rows})}

        else:
            return {"error": f"Unknown tool: {tool_name}"}
    except Exception as e:
        return {"error": str(e)}
    finally:
        conn.close()


@app.get("/health")
def health():
    return {"status": "ok"}


if __name__ == "__main__":
    import uvicorn

    # Seed DB if it doesn't exist
    if not os.path.exists(DB_PATH):
        print("Seeding test database...")
        from seed_test_db import create_db
        create_db()

    port = int(sys.argv[1]) if len(sys.argv) > 1 else 5050
    print(f"Mock Toolbox running on port {port}, DB: {DB_PATH}")
    uvicorn.run(app, host="0.0.0.0", port=port)
