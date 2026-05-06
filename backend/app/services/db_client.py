"""Direct database connection client using SQLAlchemy.

Supports PostgreSQL, MySQL, SQLite, MSSQL, and Oracle.
Handles schema introspection, profiling, and SQL execution
without needing an external MCP Toolbox server.
"""

from __future__ import annotations

import logging
from typing import Any

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.engine import Engine

logger = logging.getLogger(__name__)

# Maps source_type → SQLAlchemy driver URL prefix
DRIVER_MAP = {
    "postgresql": "postgresql+psycopg://{user}:{password}@{host}:{port}/{database}",
    "mysql": "mysql+aiomysql://{user}:{password}@{host}:{port}/{database}",
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


class DirectDbClient:
    """Connects to databases directly using SQLAlchemy drivers."""

    def __init__(self, config: dict[str, Any]):
        self._config = config
        self._engine: Engine | None = None

    def _get_engine(self) -> Engine:
        if self._engine:
            return self._engine

        source_type = self._config["source_type"]
        template = DRIVER_MAP.get(source_type)
        if not template:
            raise ValueError(f"Unsupported database type: {source_type}")

        if source_type == "sqlite":
            url = template.format(file_path=self._config.get("file_path", ""))
        else:
            url = template.format(
                user=self._config.get("username", ""),
                password=self._config.get("password", ""),
                host=self._config.get("host", "localhost"),
                port=self._config.get("port") or DEFAULT_PORTS.get(source_type, 5432),
                database=self._config.get("database_name", ""),
            )

        # Add SSL params for PostgreSQL
        connect_args: dict[str, Any] = {}
        ssl_mode = self._config.get("ssl_mode")
        if ssl_mode and source_type == "postgresql":
            connect_args["sslmode"] = ssl_mode

        self._engine = create_engine(
            url,
            connect_args=connect_args,
            pool_pre_ping=True,
            pool_size=2,
            max_overflow=3,
        )
        return self._engine

    async def test_connection(self) -> dict[str, Any]:
        """Test if the database is reachable."""
        engine = self._get_engine()
        try:
            with engine.connect() as conn:
                conn.execute(text("SELECT 1"))
            return {"ok": True, "message": "Connection successful"}
        except Exception as e:
            return {"ok": False, "message": str(e)}

    async def introspect_schema(self) -> dict[str, Any]:
        """Get all tables with their columns and types."""
        engine = self._get_engine()
        insp = inspect(engine)
        tables = []

        for table_name in insp.get_table_names():
            columns = []
            for col in insp.get_columns(table_name):
                columns.append({
                    "name": col["name"],
                    "type": str(col["type"]),
                    "nullable": col.get("nullable", True),
                    "primary_key": col.get("autoincrement", False) or False,
                })

            # Foreign keys
            fks = insp.get_foreign_keys(table_name)
            fk_info = []
            for fk in fks:
                fk_info.append({
                    "column": fk["constrained_columns"],
                    "references": f"{fk['referred_table']}.{fk['referred_columns']}",
                })

            tables.append({
                "name": table_name,
                "columns": columns,
                "foreign_keys": fk_info,
            })

        return {"tables": tables}

    async def execute_sql(self, sql: str) -> dict[str, Any]:
        """Execute a SQL query and return {columns, rows}."""
        engine = self._get_engine()
        try:
            with engine.connect() as conn:
                result = conn.execute(text(sql))
                columns = list(result.keys()) if result.returns_rows else []
                rows = [list(row) for row in result.fetchall()] if result.returns_rows else []
                return {"columns": columns, "rows": rows}
        except Exception as e:
            raise ValueError(str(e))

    async def profile_table(self, table_name: str) -> dict[str, Any]:
        """Profile a single table: row count, sample rows, column statistics."""
        profile: dict[str, Any] = {"name": table_name, "row_count": 0, "sample_rows": [], "columns": []}

        try:
            # Row count
            result = await self.execute_sql(f'SELECT COUNT(*) AS cnt FROM "{table_name}"')
            rows = result.get("rows", [])
            if rows:
                profile["row_count"] = rows[0][0]

            # Sample rows
            sample = await self.execute_sql(f'SELECT * FROM "{table_name}" LIMIT 3')
            profile["sample_rows"] = sample.get("rows", [])
            columns = sample.get("columns", [])

            # Batch column stats
            if columns:
                parts = [f'COUNT(DISTINCT "{c}") AS "{c}_dist"' for c in columns]
                try:
                    stats = await self.execute_sql(f'SELECT {", ".join(parts)} FROM "{table_name}"')
                    stats_row = stats.get("rows", [[]])[0]
                    for i, col_name in enumerate(columns):
                        col_stat: dict[str, Any] = {
                            "name": col_name,
                            "distinct_count": stats_row[i] if i < len(stats_row) else None,
                        }
                        profile["columns"].append(col_stat)
                except Exception:
                    for col_name in columns:
                        profile["columns"].append({"name": col_name, "distinct_count": None})
        except Exception as e:
            logger.warning("Failed to profile table %s: %s", table_name, e)

        return profile

    async def profile_all_tables(self, tables: list[dict[str, Any]]) -> dict[str, Any]:
        """Profile all tables."""
        profiles = []
        for table in tables:
            table_name = table.get("name", "")
            if table_name:
                profile = await self.profile_table(table_name)
                # Merge type info from schema
                schema_cols = {c["name"]: c for c in table.get("columns", [])}
                for col in profile.get("columns", []):
                    sc = schema_cols.get(col["name"], {})
                    col["type"] = sc.get("type", "UNKNOWN")
                profiles.append(profile)
        return {"tables": profiles}

    def close(self) -> None:
        if self._engine:
            self._engine.dispose()
            self._engine = None
