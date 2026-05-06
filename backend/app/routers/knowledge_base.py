from __future__ import annotations

import logging
import os
import uuid

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form

logger = logging.getLogger(__name__)
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.database import get_session
from app.models import KbDocument
from app.schemas import KbDocumentResponse, KbSearchRequest, KbSearchResult
from app.services.kb_service import KbService

router = APIRouter(prefix="/kb", tags=["knowledge-base"])

ALLOWED_EXTENSIONS = {".pdf", ".txt", ".md", ".csv"}


@router.post("/documents", response_model=KbDocumentResponse)
async def upload_document(
    file: UploadFile = File(...),
    title: str = Form(""),
    session: AsyncSession = Depends(get_session),
):
    if not file.filename:
        raise HTTPException(status_code=400, detail="No file provided")

    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type: {ext}. Allowed: {', '.join(ALLOWED_EXTENSIONS)}",
        )

    settings = get_settings()
    os.makedirs(settings.upload_dir, exist_ok=True)

    # Save file
    file_id = uuid.uuid4().hex[:12]
    safe_name = f"{file_id}_{file.filename}"
    file_path = os.path.join(settings.upload_dir, safe_name)

    content = await file.read()
    with open(file_path, "wb") as f:
        f.write(content)

    # Create document record
    doc = KbDocument(
        title=title or file.filename,
        file_name=file.filename,
        file_path=file_path,
        file_type=ext.lstrip("."),
        status="processing",
    )
    session.add(doc)
    await session.commit()
    await session.refresh(doc)

    # Process the file (extract text, chunk, embed)
    try:
        kb_service = KbService()
        await kb_service.process_file(file_path, str(doc.id), ext.lstrip("."))
        doc.status = "ready"
    except Exception as e:
        doc.status = "error"
        logger.exception("Failed to process document %s: %s", doc.id, e)

    await session.commit()
    await session.refresh(doc)
    return doc


@router.get("/documents", response_model=list[KbDocumentResponse])
async def list_documents(session: AsyncSession = Depends(get_session)):
    result = await session.execute(
        select(KbDocument).order_by(KbDocument.created_at.desc())
    )
    return result.scalars().all()


@router.delete("/documents/{document_id}")
async def delete_document(
    document_id: int,
    session: AsyncSession = Depends(get_session),
):
    doc = await session.get(KbDocument, document_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    # Remove from vector store
    kb_service = KbService()
    kb_service.delete_document(str(document_id))

    # Remove file from disk
    if os.path.exists(doc.file_path):
        os.remove(doc.file_path)

    await session.delete(doc)
    await session.commit()
    return {"ok": True}


@router.post("/search", response_model=list[KbSearchResult])
async def search_kb(
    body: KbSearchRequest,
    session: AsyncSession = Depends(get_session),
):
    kb_service = KbService()
    results = kb_service.search(body.query, body.top_k)

    # Enrich with document titles
    enriched = []
    for r in results:
        doc_id = r.get("document_id")
        doc = await session.get(KbDocument, int(doc_id)) if doc_id else None
        enriched.append(
            KbSearchResult(
                chunk_text=r["chunk_text"],
                document_title=doc.title if doc else "Unknown",
                page_number=r.get("page_number"),
                score=r.get("score", 0.0),
            )
        )
    return enriched
