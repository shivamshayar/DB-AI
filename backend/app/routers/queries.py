from __future__ import annotations

import json
import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_session
from app.models import ChatThread, Query
from app.schemas import (
    QueryRequest, QueryResponse, QueryListResponse,
    ChatThreadResponse, ChatThreadDetailResponse,
)
from app.services.query_engine import QueryEngine

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/queries", tags=["queries"])


# ── Chat Threads ─────────────────────────────────────────────

@router.get("/threads", response_model=list[ChatThreadResponse])
async def list_threads(
    limit: int = 30,
    session: AsyncSession = Depends(get_session),
):
    result = await session.execute(
        select(ChatThread).order_by(ChatThread.updated_at.desc()).limit(limit)
    )
    threads = result.scalars().all()

    response = []
    for t in threads:
        # Get message count and last question
        msg_result = await session.execute(
            select(func.count(Query.id), func.max(Query.question))
            .where(Query.thread_id == t.id)
        )
        row = msg_result.one()
        response.append(ChatThreadResponse(
            id=t.id,
            title=t.title,
            created_at=t.created_at,
            updated_at=t.updated_at,
            message_count=row[0] or 0,
            last_question=row[1],
        ))
    return response


@router.get("/threads/{thread_id}", response_model=ChatThreadDetailResponse)
async def get_thread(
    thread_id: int,
    session: AsyncSession = Depends(get_session),
):
    result = await session.execute(
        select(ChatThread)
        .where(ChatThread.id == thread_id)
        .options(selectinload(ChatThread.messages))
    )
    thread = result.scalar_one_or_none()
    if not thread:
        raise HTTPException(status_code=404, detail="Thread not found")

    return ChatThreadDetailResponse(
        id=thread.id,
        title=thread.title,
        created_at=thread.created_at,
        messages=[_to_response(m) for m in thread.messages],
    )


@router.delete("/threads/{thread_id}")
async def delete_thread(
    thread_id: int,
    session: AsyncSession = Depends(get_session),
):
    thread = await session.get(ChatThread, thread_id)
    if not thread:
        raise HTTPException(status_code=404, detail="Thread not found")
    await session.delete(thread)
    await session.commit()
    return {"ok": True}


# ── Queries ──────────────────────────────────────────────────

@router.post("", response_model=QueryResponse)
async def submit_query(
    body: QueryRequest,
    session: AsyncSession = Depends(get_session),
):
    # Get or create thread
    thread_id = body.thread_id
    if not thread_id:
        # Auto-create a new thread, title from the first question
        title = body.question[:80] + ("..." if len(body.question) > 80 else "")
        thread = ChatThread(title=title)
        session.add(thread)
        await session.commit()
        await session.refresh(thread)
        thread_id = thread.id
    else:
        thread = await session.get(ChatThread, thread_id)
        if not thread:
            raise HTTPException(status_code=404, detail="Thread not found")

    # Create query record
    query = Query(
        thread_id=thread_id,
        question=body.question,
        connection_id=body.connection_id,
        status="running",
    )
    session.add(query)
    await session.commit()
    await session.refresh(query)

    # Run the pipeline
    engine = QueryEngine(session)
    try:
        result = await engine.process_question(
            question=body.question,
            connection_id=body.connection_id,
            context=body.context,
        )
        query.intent = result.get("intent")
        query.sql_generated = result.get("sql")
        query.chart_spec = json.dumps(result.get("chart_spec")) if result.get("chart_spec") else None
        query.result_data = json.dumps(result.get("result_data")) if result.get("result_data") else None
        query.explanation = result.get("explanation")

        clarification = result.get("clarification")
        if clarification:
            query.clarification = json.dumps(clarification)
            query.status = "clarification"
        else:
            query.status = "completed"
    except Exception as e:
        query.status = "error"
        query.error_message = f"{type(e).__name__}: {e}" if str(e) else type(e).__name__
        logger.exception("Query %s failed", query.id)

    # Update thread timestamp
    thread = await session.get(ChatThread, thread_id)
    if thread:
        thread.updated_at = query.created_at

    await session.commit()
    await session.refresh(query)
    return _to_response(query)


@router.get("", response_model=list[QueryListResponse])
async def list_queries(
    limit: int = 50,
    session: AsyncSession = Depends(get_session),
):
    result = await session.execute(
        select(Query).order_by(Query.created_at.desc()).limit(limit)
    )
    return result.scalars().all()


@router.get("/{query_id}", response_model=QueryResponse)
async def get_query(
    query_id: int,
    session: AsyncSession = Depends(get_session),
):
    query = await session.get(Query, query_id)
    if not query:
        raise HTTPException(status_code=404, detail="Query not found")
    return _to_response(query)


def _to_response(q: Query) -> QueryResponse:
    return QueryResponse(
        id=q.id,
        thread_id=q.thread_id,
        question=q.question,
        connection_id=q.connection_id,
        sql_generated=q.sql_generated,
        chart_spec=q.get_chart_spec(),
        result_data=q.get_result_data(),
        explanation=q.explanation,
        intent=q.intent,
        clarification=q.get_clarification(),
        status=q.status,
        error_message=q.error_message,
        created_at=q.created_at,
    )
