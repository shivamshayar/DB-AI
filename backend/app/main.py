from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.database import init_db
from app.routers import connections, dashboards, knowledge_base, metadata, queries, settings as settings_router
from app.services.internal_toolbox import router as toolbox_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialize database on startup."""
    await init_db()
    yield


app = FastAPI(
    title="DB Dashboard",
    description="Text-to-Chart Dashboard — ask questions, get SQL and charts",
    version="0.1.0",
    lifespan=lifespan,
)

# CORS
settings = get_settings()
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routers
app.include_router(connections.router, prefix="/api/v1")
app.include_router(metadata.router, prefix="/api/v1")
app.include_router(knowledge_base.router, prefix="/api/v1")
app.include_router(queries.router, prefix="/api/v1")
app.include_router(dashboards.router, prefix="/api/v1")
app.include_router(settings_router.router, prefix="/api/v1")
app.include_router(toolbox_router)


@app.get("/health")
async def health():
    return {"status": "ok"}
