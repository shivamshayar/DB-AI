from __future__ import annotations

import json

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.models import Connection, TableMetadata
from app.schemas import MetadataResponse, MetadataUpdate, TableMetadataItem, ColumnMetadataItem

router = APIRouter(prefix="/connections/{connection_id}/metadata", tags=["metadata"])


@router.get("", response_model=MetadataResponse)
async def get_metadata(
    connection_id: int,
    session: AsyncSession = Depends(get_session),
):
    conn = await session.get(Connection, connection_id)
    if not conn:
        raise HTTPException(status_code=404, detail="Connection not found")

    result = await session.execute(
        select(TableMetadata).where(TableMetadata.connection_id == connection_id)
    )
    rows = result.scalars().all()

    tables = []
    for row in rows:
        col_meta = row.get_column_metadata() or []
        tables.append(
            TableMetadataItem(
                table_name=row.table_name,
                description=row.description or "",
                columns=[ColumnMetadataItem(**c) for c in col_meta],
            )
        )

    return MetadataResponse(connection_id=connection_id, tables=tables)


@router.put("", response_model=MetadataResponse)
async def update_metadata(
    connection_id: int,
    body: MetadataUpdate,
    session: AsyncSession = Depends(get_session),
):
    conn = await session.get(Connection, connection_id)
    if not conn:
        raise HTTPException(status_code=404, detail="Connection not found")

    # Delete existing metadata for this connection
    result = await session.execute(
        select(TableMetadata).where(TableMetadata.connection_id == connection_id)
    )
    for row in result.scalars().all():
        await session.delete(row)

    # Insert new metadata
    for table in body.tables:
        tm = TableMetadata(
            connection_id=connection_id,
            table_name=table.table_name,
            description=table.description,
            column_metadata=json.dumps([c.model_dump() for c in table.columns]),
        )
        session.add(tm)

    await session.commit()
    return MetadataResponse(connection_id=connection_id, tables=body.tables)
