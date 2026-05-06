from __future__ import annotations

import json
import logging
from typing import Any

import httpx

logger = logging.getLogger(__name__)


class ToolboxClient:
    """Client for database toolbox servers.

    Supports two modes:
    - MCP Toolbox (toolbox-core SDK) for production use
    - Simple REST API fallback for testing / lightweight deployments

    The mode is auto-detected: if the server has /api/toolset it uses REST mode,
    otherwise it tries the MCP protocol.
    """

    def __init__(self, toolbox_url: str):
        self.toolbox_url = toolbox_url.rstrip("/")
        self._mode: str | None = None  # "rest" or "mcp"

    async def _detect_mode(self) -> str:
        """Auto-detect whether server speaks REST or MCP protocol."""
        if self._mode:
            return self._mode
        try:
            async with httpx.AsyncClient(timeout=5) as http:
                resp = await http.get(f"{self.toolbox_url}/api/toolset")
                if resp.status_code == 200:
                    self._mode = "rest"
                    return "rest"
        except Exception:
            pass
        self._mode = "mcp"
        return "mcp"

    async def list_tools(self) -> list[str]:
        """List available tools from the toolbox server."""
        mode = await self._detect_mode()
        if mode == "rest":
            return await self._rest_list_tools()
        return await self._mcp_list_tools()

    async def introspect_schema(self) -> dict[str, Any]:
        """Discover tables, columns, and types from the database."""
        mode = await self._detect_mode()
        if mode == "rest":
            return await self._rest_introspect()
        return await self._mcp_introspect()

    async def execute_sql(self, sql: str) -> dict[str, Any]:
        """Execute a SQL query and return {columns, rows}."""
        mode = await self._detect_mode()
        if mode == "rest":
            return await self._rest_execute_sql(sql)
        return await self._mcp_execute_sql(sql)

    async def profile_table(self, table_name: str) -> dict[str, Any]:
        """Profile a single table: row count, sample rows, column statistics."""
        profile: dict[str, Any] = {"name": table_name, "row_count": 0, "sample_rows": [], "columns": []}

        try:
            count_result = await self.execute_sql(f"SELECT COUNT(*) AS cnt FROM {table_name}")
            rows = count_result.get("rows", [])
            if rows:
                profile["row_count"] = rows[0][0] if isinstance(rows[0], list) else rows[0].get("cnt", 0)

            sample_result = await self.execute_sql(f"SELECT * FROM {table_name} LIMIT 3")
            profile["sample_rows"] = sample_result.get("rows", [])
            columns = sample_result.get("columns", [])

            # Batch column stats in a single query for speed
            col_names = [col if isinstance(col, str) else col.get("name", "") for col in columns]
            if col_names:
                parts = [f'COUNT(DISTINCT "{c}") AS "{c}_dist"' for c in col_names]
                try:
                    stats_result = await self.execute_sql(
                        f"SELECT {', '.join(parts)} FROM {table_name}"
                    )
                    stats_row = stats_result.get("rows", [[]])[0]
                    stats_cols = stats_result.get("columns", [])
                    dist_map = {}
                    for i, sc in enumerate(stats_cols):
                        val = stats_row[i] if isinstance(stats_row, list) else stats_row.get(sc, 0)
                        col_base = sc.replace("_dist", "") if sc.endswith("_dist") else col_names[i] if i < len(col_names) else ""
                        dist_map[col_base] = val
                except Exception:
                    dist_map = {}

                for col_name in col_names:
                    col_stat: dict[str, Any] = {"name": col_name, "distinct_count": dist_map.get(col_name)}
                    profile["columns"].append(col_stat)

        except Exception as e:
            logger.warning("Failed to profile table %s: %s", table_name, e)

        return profile

    async def profile_all_tables(self, tables: list[dict[str, Any]]) -> dict[str, Any]:
        """Profile all tables in a schema."""
        profiles = []
        for table in tables:
            table_name = table.get("name", "") if isinstance(table, dict) else str(table)
            if table_name:
                profile = await self.profile_table(table_name)
                if isinstance(table, dict):
                    schema_cols = {c["name"]: c for c in table.get("columns", [])}
                    for col in profile.get("columns", []):
                        sc = schema_cols.get(col["name"], {})
                        col["type"] = sc.get("type", "UNKNOWN")
                profiles.append(profile)
        return {"tables": profiles}

    # ── REST mode (simple HTTP API) ──────────────────────────

    async def _rest_list_tools(self) -> list[str]:
        async with httpx.AsyncClient(timeout=10) as http:
            resp = await http.get(f"{self.toolbox_url}/api/toolset")
            data = resp.json()
            return list(data.get("tools", {}).keys())

    async def _rest_introspect(self) -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=30) as http:
            resp = await http.post(
                f"{self.toolbox_url}/api/tool/list_tables/invoke",
                json={"params": {}},
            )
            data = resp.json()
            result = data.get("result", "{}")
            if isinstance(result, str):
                return json.loads(result)
            return result

    async def _rest_execute_sql(self, sql: str) -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=30) as http:
            resp = await http.post(
                f"{self.toolbox_url}/api/tool/execute_sql/invoke",
                json={"params": {"sql": sql}},
            )
            data = resp.json()
            if "error" in data and data["error"]:
                raise ValueError(data["error"])
            result = data.get("result", "{}")
            if isinstance(result, str):
                return json.loads(result)
            return result

    # ── MCP mode (toolbox-core SDK) ──────────────────────────

    async def _mcp_list_tools(self) -> list[str]:
        from toolbox_core import ToolboxClient as _ToolboxClient
        async with _ToolboxClient(self.toolbox_url) as client:
            tools = await client.load_toolset()
            return [t.name for t in tools]

    async def _mcp_introspect(self) -> dict[str, Any]:
        from toolbox_core import ToolboxClient as _ToolboxClient
        async with _ToolboxClient(self.toolbox_url) as client:
            tools = await client.load_toolset()
            tool_names = [t.name for t in tools]

            if "list_tables" in tool_names:
                tool = await client.load_tool("list_tables")
                result = await tool()
                return self._parse_schema_result(result)

            if "execute_sql" in tool_names:
                tool = await client.load_tool("execute_sql")
                result = await tool(
                    sql="SELECT table_name, column_name, data_type "
                    "FROM information_schema.columns "
                    "ORDER BY table_name, ordinal_position"
                )
                return self._parse_information_schema(result)

            return {"tables": []}

    async def _mcp_execute_sql(self, sql: str) -> dict[str, Any]:
        from toolbox_core import ToolboxClient as _ToolboxClient
        async with _ToolboxClient(self.toolbox_url) as client:
            tool = await client.load_tool("execute_sql")
            result = await tool(sql=sql)
            return self._parse_query_result(result)

    # ── Parsing helpers ──────────────────────────────────────

    def _parse_schema_result(self, result: Any) -> dict[str, Any]:
        if isinstance(result, dict) and "tables" in result:
            return result
        text = str(result)
        try:
            return json.loads(text)
        except (json.JSONDecodeError, ValueError):
            pass
        return {"tables": []}

    def _parse_information_schema(self, result: Any) -> dict[str, Any]:
        tables_map: dict[str, list[dict[str, str]]] = {}
        rows = result.get("rows", []) if isinstance(result, dict) else []
        for row in rows:
            if isinstance(row, (list, tuple)):
                table_name, col_name, data_type = row[0], row[1], row[2]
            elif isinstance(row, dict):
                table_name = row.get("table_name", "")
                col_name = row.get("column_name", "")
                data_type = row.get("data_type", "UNKNOWN")
            else:
                continue
            tables_map.setdefault(table_name, []).append({"name": col_name, "type": data_type})
        return {"tables": [{"name": n, "columns": c} for n, c in tables_map.items()]}

    def _parse_query_result(self, result: Any) -> dict[str, Any]:
        if isinstance(result, dict):
            return {"columns": result.get("columns", []), "rows": result.get("rows", [])}
        try:
            parsed = json.loads(str(result))
            if isinstance(parsed, dict):
                return {"columns": parsed.get("columns", []), "rows": parsed.get("rows", [])}
        except (json.JSONDecodeError, ValueError):
            pass
        return {"columns": [], "rows": []}
