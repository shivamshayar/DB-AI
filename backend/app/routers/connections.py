from __future__ import annotations

import json
import logging

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.models import Connection
from app.schemas import ConnectionCreate, ConnectionListResponse, ConnectionResponse
from app.services.internal_toolbox import register_connection, unregister_connection, test_connection as toolbox_test
from app.services.toolbox_client import ToolboxClient

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/connections", tags=["connections"])


def _build_internal_toolbox_url(request: Request, connection_id: int) -> str:
    """Build the toolbox URL pointing to our own server."""
    # Use the same host the request came in on
    base = str(request.base_url).rstrip("/")
    return f"{base}/toolbox/{connection_id}"


def _register_in_toolbox(conn: Connection) -> None:
    """Register a connection's credentials in the internal toolbox engine pool."""
    register_connection(conn.id, {
        "source_type": conn.source_type,
        "host": conn.host,
        "port": conn.port,
        "database_name": conn.database_name,
        "username": conn.username,
        "password": conn.password,
        "ssl_mode": conn.ssl_mode,
        "file_path": conn.file_path,
    })


def _get_toolbox_client(conn: Connection) -> ToolboxClient:
    """Return a ToolboxClient pointing to either internal or external toolbox."""
    if not conn.toolbox_url:
        raise ValueError(f"Connection {conn.id} has no toolbox_url")
    return ToolboxClient(conn.toolbox_url)


def _get_client_for_query(conn: Connection) -> ToolboxClient:
    """Public helper for other routers to get a client for a connection.

    Ensures the internal toolbox engine is registered before returning.
    """
    if conn.toolbox_url and "/toolbox/" in conn.toolbox_url:
        _register_in_toolbox(conn)
    return _get_toolbox_client(conn)


@router.post("", response_model=ConnectionResponse)
async def create_connection(
    body: ConnectionCreate,
    request: Request,
    session: AsyncSession = Depends(get_session),
):
    # If user provided an external toolbox URL, use it directly
    # Otherwise, we'll create an internal toolbox for their credentials
    is_external_toolbox = bool(body.toolbox_url)

    conn = Connection(
        name=body.name,
        connection_type="toolbox",  # Always toolbox — internal or external
        source_type=body.source_type,
        host=body.host,
        port=body.port,
        database_name=body.database_name,
        username=body.username,
        password=body.password,
        ssl_mode=body.ssl_mode,
        extra_params=json.dumps(body.extra_params) if body.extra_params else None,
        file_path=body.file_path,
        toolbox_url=body.toolbox_url,  # May be None — will be set after commit
    )
    session.add(conn)
    await session.commit()
    await session.refresh(conn)

    # If no external toolbox URL, register in internal toolbox and set URL
    if not is_external_toolbox:
        _register_in_toolbox(conn)
        conn.toolbox_url = _build_internal_toolbox_url(request, conn.id)
        await session.commit()
        await session.refresh(conn)

    # Auto-test the connection
    test_result = {"ok": False, "message": "Not tested"}
    try:
        if is_external_toolbox:
            client = _get_toolbox_client(conn)
            await client.list_tools()
            test_result = {"ok": True, "message": "Toolbox connected"}
        else:
            test_result = toolbox_test(conn.id)
    except Exception as e:
        test_result = {"ok": False, "message": str(e)}

    resp = _to_response(conn)
    resp.test_result = test_result
    return resp


@router.get("", response_model=list[ConnectionListResponse])
async def list_connections(session: AsyncSession = Depends(get_session)):
    result = await session.execute(select(Connection).order_by(Connection.created_at.desc()))
    connections = result.scalars().all()
    return [
        ConnectionListResponse(
            id=c.id,
            name=c.name,
            connection_type=c.connection_type or "toolbox",
            source_type=c.source_type,
            host=c.host,
            database_name=c.database_name,
            has_schema=c.schema_cache is not None,
            created_at=c.created_at,
        )
        for c in connections
    ]


@router.get("/{connection_id}", response_model=ConnectionResponse)
async def get_connection(
    connection_id: int,
    session: AsyncSession = Depends(get_session),
):
    conn = await session.get(Connection, connection_id)
    if not conn:
        raise HTTPException(status_code=404, detail="Connection not found")
    return _to_response(conn)


@router.patch("/{connection_id}", response_model=ConnectionResponse)
async def update_connection(
    connection_id: int,
    body: ConnectionCreate,
    request: Request,
    session: AsyncSession = Depends(get_session),
):
    """Update an existing connection's credentials. Re-registers the engine."""
    conn = await session.get(Connection, connection_id)
    if not conn:
        raise HTTPException(status_code=404, detail="Connection not found")

    is_external_toolbox = bool(body.toolbox_url)

    conn.name = body.name
    conn.source_type = body.source_type
    conn.host = body.host
    conn.port = body.port
    conn.database_name = body.database_name
    if body.password:  # only update password if provided (empty = keep old)
        conn.password = body.password
    conn.username = body.username
    conn.ssl_mode = body.ssl_mode
    conn.file_path = body.file_path
    conn.toolbox_url = body.toolbox_url
    conn.connection_type = "toolbox" if is_external_toolbox else "toolbox"  # always toolbox

    if not is_external_toolbox:
        _register_in_toolbox(conn)
        conn.toolbox_url = _build_internal_toolbox_url(request, conn.id)
    else:
        unregister_connection(conn.id)

    # Schema cache may be invalid for the new connection — clear it
    conn.schema_cache = None
    conn.schema_profile = None

    await session.commit()
    await session.refresh(conn)
    return _to_response(conn)


@router.delete("/{connection_id}")
async def delete_connection(
    connection_id: int,
    session: AsyncSession = Depends(get_session),
):
    conn = await session.get(Connection, connection_id)
    if not conn:
        raise HTTPException(status_code=404, detail="Connection not found")
    unregister_connection(connection_id)
    await session.delete(conn)
    await session.commit()
    return {"ok": True}


@router.post("/{connection_id}/test")
async def test_connection_endpoint(
    connection_id: int,
    request: Request,
    session: AsyncSession = Depends(get_session),
):
    conn = await session.get(Connection, connection_id)
    if not conn:
        raise HTTPException(status_code=404, detail="Connection not found")

    # Ensure registered in internal toolbox
    _ensure_registered(conn, request)

    try:
        client = _get_toolbox_client(conn)
        tools = await client.list_tools()
        return {"ok": True, "message": "Connection successful", "tools": tools}
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Connection failed: {e}")


@router.post("/{connection_id}/sync-schema", response_model=ConnectionResponse)
async def sync_schema(
    connection_id: int,
    request: Request,
    session: AsyncSession = Depends(get_session),
):
    conn = await session.get(Connection, connection_id)
    if not conn:
        raise HTTPException(status_code=404, detail="Connection not found")

    # Ensure registered in internal toolbox
    _ensure_registered(conn, request)

    client = _get_toolbox_client(conn)

    schema = await client.introspect_schema()
    conn.schema_cache = json.dumps(schema)

    profile = await client.profile_all_tables(schema.get("tables", []))
    conn.schema_profile = json.dumps(profile)

    await session.commit()
    await session.refresh(conn)
    return _to_response(conn)


@router.get("/{connection_id}/schema")
async def get_schema(
    connection_id: int,
    session: AsyncSession = Depends(get_session),
):
    conn = await session.get(Connection, connection_id)
    if not conn:
        raise HTTPException(status_code=404, detail="Connection not found")
    return {
        "schema": conn.get_schema_cache(),
        "profile": conn.get_schema_profile(),
    }


def _ensure_registered(conn: Connection, request: Request) -> None:
    """Make sure a connection is registered in the internal toolbox.

    On server restart, the in-memory engine pool is empty.
    This re-registers connections lazily when they're accessed.
    """
    if conn.toolbox_url and "/toolbox/" in conn.toolbox_url:
        # Internal toolbox — ensure engine is registered
        _register_in_toolbox(conn)
        # Update URL in case server port changed
        new_url = _build_internal_toolbox_url(request, conn.id)
        if conn.toolbox_url != new_url:
            conn.toolbox_url = new_url


def _to_response(conn: Connection) -> ConnectionResponse:
    return ConnectionResponse(
        id=conn.id,
        name=conn.name,
        connection_type=conn.connection_type or "toolbox",
        source_type=conn.source_type,
        host=conn.host,
        port=conn.port,
        database_name=conn.database_name,
        username=conn.username,
        ssl_mode=conn.ssl_mode,
        file_path=conn.file_path,
        toolbox_url=conn.toolbox_url,
        schema_cache=conn.get_schema_cache(),
        schema_profile=conn.get_schema_profile(),
        created_at=conn.created_at,
    )
