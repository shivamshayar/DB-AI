from __future__ import annotations

import logging
import os
from typing import Any

import chromadb
import fitz  # PyMuPDF

from app.config import get_settings

logger = logging.getLogger(__name__)

CHUNK_SIZE = 500  # approximate tokens (chars / 4)
CHUNK_OVERLAP = 50


class KbService:
    """Knowledge base service: file processing, chunking, embedding, and search."""

    def __init__(self) -> None:
        settings = get_settings()
        os.makedirs(settings.chromadb_path, exist_ok=True)
        self._client = chromadb.PersistentClient(path=settings.chromadb_path)
        self._collection = self._client.get_or_create_collection(
            name="knowledge_base",
            metadata={"hnsw:space": "cosine"},
        )

    async def process_file(self, file_path: str, document_id: str, file_type: str) -> None:
        """Extract text from file, chunk it, and store embeddings in ChromaDB."""
        if file_type == "pdf":
            chunks = self._extract_pdf(file_path)
        elif file_type in ("txt", "md"):
            chunks = self._extract_text(file_path)
        elif file_type == "csv":
            chunks = self._extract_csv(file_path)
        else:
            raise ValueError(f"Unsupported file type: {file_type}")

        if not chunks:
            logger.warning("No text extracted from %s", file_path)
            return

        # Store in ChromaDB
        ids = [f"{document_id}_chunk_{i}" for i in range(len(chunks))]
        documents = [c["text"] for c in chunks]
        metadatas = [
            {
                "document_id": document_id,
                "page_number": c.get("page_number") or 0,
                "chunk_index": i,
            }
            for i, c in enumerate(chunks)
        ]

        self._collection.add(
            ids=ids,
            documents=documents,
            metadatas=metadatas,
        )
        logger.info("Stored %d chunks for document %s", len(chunks), document_id)

    def search(self, query: str, top_k: int = 5) -> list[dict[str, Any]]:
        """Semantic search across all knowledge base chunks."""
        if self._collection.count() == 0:
            return []

        results = self._collection.query(
            query_texts=[query],
            n_results=min(top_k, self._collection.count()),
        )

        items = []
        documents = results.get("documents", [[]])[0]
        metadatas = results.get("metadatas", [[]])[0]
        distances = results.get("distances", [[]])[0]

        for doc, meta, dist in zip(documents, metadatas, distances):
            items.append({
                "chunk_text": doc,
                "document_id": meta.get("document_id", ""),
                "page_number": meta.get("page_number"),
                "score": round(1 - dist, 4),  # cosine distance → similarity
            })
        return items

    def delete_document(self, document_id: str) -> None:
        """Remove all chunks for a document from the vector store."""
        try:
            self._collection.delete(where={"document_id": document_id})
        except Exception as e:
            logger.warning("Failed to delete chunks for document %s: %s", document_id, e)

    # ── Text extraction ──────────────────────────────────────

    def _extract_pdf(self, file_path: str) -> list[dict[str, Any]]:
        """Extract text from PDF page by page, then chunk."""
        chunks = []
        doc = fitz.open(file_path)
        for page_num in range(len(doc)):
            page = doc[page_num]
            text = page.get_text()
            if text.strip():
                page_chunks = self._chunk_text(text, page_number=page_num + 1)
                chunks.extend(page_chunks)
        doc.close()
        return chunks

    def _extract_text(self, file_path: str) -> list[dict[str, Any]]:
        """Read a plain text / markdown file and chunk it."""
        with open(file_path, "r", encoding="utf-8", errors="replace") as f:
            text = f.read()
        return self._chunk_text(text)

    def _extract_csv(self, file_path: str) -> list[dict[str, Any]]:
        """Read a CSV file as text and chunk it (preserves tabular structure)."""
        with open(file_path, "r", encoding="utf-8", errors="replace") as f:
            text = f.read()
        return self._chunk_text(text)

    def _chunk_text(
        self,
        text: str,
        page_number: int | None = None,
    ) -> list[dict[str, Any]]:
        """Split text into overlapping chunks of ~CHUNK_SIZE characters."""
        char_size = CHUNK_SIZE * 4  # rough char-to-token ratio
        overlap = CHUNK_OVERLAP * 4
        chunks = []
        start = 0
        while start < len(text):
            end = start + char_size
            chunk_text = text[start:end].strip()
            if chunk_text:
                chunks.append({
                    "text": chunk_text,
                    "page_number": page_number,
                })
            start = end - overlap
        return chunks
