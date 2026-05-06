from __future__ import annotations

import json

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_session
from app.models import Dashboard, DashboardPanel, Query
from app.schemas import (
    DashboardCreate,
    DashboardListResponse,
    DashboardResponse,
    PanelCreate,
    PanelResponse,
    PanelUpdate,
)

router = APIRouter(prefix="/dashboards", tags=["dashboards"])


@router.post("", response_model=DashboardResponse)
async def create_dashboard(
    body: DashboardCreate,
    session: AsyncSession = Depends(get_session),
):
    dashboard = Dashboard(title=body.title, description=body.description or None)
    session.add(dashboard)
    await session.commit()
    await session.refresh(dashboard)
    return DashboardResponse(
        id=dashboard.id,
        title=dashboard.title,
        description=dashboard.description,
        panels=[],
        created_at=dashboard.created_at,
    )


@router.get("", response_model=list[DashboardListResponse])
async def list_dashboards(session: AsyncSession = Depends(get_session)):
    result = await session.execute(
        select(
            Dashboard.id,
            Dashboard.title,
            Dashboard.description,
            Dashboard.created_at,
            func.count(DashboardPanel.id).label("panel_count"),
        )
        .outerjoin(DashboardPanel)
        .group_by(Dashboard.id)
        .order_by(Dashboard.created_at.desc())
    )
    rows = result.all()
    return [
        DashboardListResponse(
            id=r.id,
            title=r.title,
            description=r.description,
            panel_count=r.panel_count,
            created_at=r.created_at,
        )
        for r in rows
    ]


@router.get("/{dashboard_id}", response_model=DashboardResponse)
async def get_dashboard(
    dashboard_id: int,
    session: AsyncSession = Depends(get_session),
):
    result = await session.execute(
        select(Dashboard)
        .where(Dashboard.id == dashboard_id)
        .options(selectinload(Dashboard.panels))
    )
    dashboard = result.scalar_one_or_none()
    if not dashboard:
        raise HTTPException(status_code=404, detail="Dashboard not found")
    return await _to_response(dashboard, session)


@router.delete("/{dashboard_id}")
async def delete_dashboard(
    dashboard_id: int,
    session: AsyncSession = Depends(get_session),
):
    dashboard = await session.get(Dashboard, dashboard_id)
    if not dashboard:
        raise HTTPException(status_code=404, detail="Dashboard not found")
    await session.delete(dashboard)
    await session.commit()
    return {"ok": True}


@router.post("/{dashboard_id}/panels", response_model=PanelResponse)
async def add_panel(
    dashboard_id: int,
    body: PanelCreate,
    session: AsyncSession = Depends(get_session),
):
    dashboard = await session.get(Dashboard, dashboard_id)
    if not dashboard:
        raise HTTPException(status_code=404, detail="Dashboard not found")

    query = await session.get(Query, body.query_id)
    if not query:
        raise HTTPException(status_code=404, detail="Query not found")

    panel = DashboardPanel(
        dashboard_id=dashboard_id,
        query_id=body.query_id,
        title=body.title,
        layout=json.dumps(body.layout) if body.layout else None,
    )
    session.add(panel)
    await session.commit()
    await session.refresh(panel)
    return _panel_to_response(panel, query)


@router.delete("/{dashboard_id}/panels/{panel_id}")
async def remove_panel(
    dashboard_id: int,
    panel_id: int,
    session: AsyncSession = Depends(get_session),
):
    panel = await session.get(DashboardPanel, panel_id)
    if not panel or panel.dashboard_id != dashboard_id:
        raise HTTPException(status_code=404, detail="Panel not found")
    await session.delete(panel)
    await session.commit()
    return {"ok": True}


@router.patch("/{dashboard_id}/panels/{panel_id}", response_model=PanelResponse)
async def update_panel(
    dashboard_id: int,
    panel_id: int,
    body: PanelUpdate,
    session: AsyncSession = Depends(get_session),
):
    panel = await session.get(DashboardPanel, panel_id)
    if not panel or panel.dashboard_id != dashboard_id:
        raise HTTPException(status_code=404, detail="Panel not found")

    if body.title is not None:
        panel.title = body.title
    if body.layout is not None:
        panel.layout = json.dumps(body.layout)

    await session.commit()
    await session.refresh(panel)

    query = await session.get(Query, panel.query_id)
    return _panel_to_response(panel, query)


def _panel_to_response(panel: DashboardPanel, query: Query | None) -> PanelResponse:
    layout = json.loads(panel.layout) if panel.layout else None
    return PanelResponse(
        id=panel.id,
        query_id=panel.query_id,
        title=panel.title,
        layout=layout,
        chart_spec=query.get_chart_spec() if query else None,
        result_data=query.get_result_data() if query else None,
        created_at=panel.created_at,
    )


async def _to_response(dashboard: Dashboard, session: AsyncSession) -> DashboardResponse:
    panels = []
    for panel in dashboard.panels:
        query = await session.get(Query, panel.query_id)
        panels.append(_panel_to_response(panel, query))

    return DashboardResponse(
        id=dashboard.id,
        title=dashboard.title,
        description=dashboard.description,
        panels=panels,
        created_at=dashboard.created_at,
    )
