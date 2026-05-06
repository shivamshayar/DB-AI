# DB Dashboard — Text-to-Chart AI

A single-user local application that lets you ask questions about your databases in plain English and get back SQL queries, charts, and insights — powered by your choice of LLM (Ollama, OpenAI, or Anthropic Claude).

## Features

- **Multi-database support** — Connect PostgreSQL, MySQL, SQLite, MS SQL Server, or Oracle databases via credentials
- **Configurable LLM provider** — Choose Ollama (local), OpenAI, or Anthropic Claude from the Settings modal
- **Auto-managed MCP Toolbox** — Backend internally exposes databases via MCP-compatible REST endpoints; no separate Toolbox server needed
- **Knowledge base** — Upload PDFs, Markdown, CSV, or text files with domain knowledge (formulas, business rules)
- **Schema metadata** — Annotate tables and columns with business descriptions for better AI understanding
- **Agentic queries** — Auto-detects meta-queries vs data-queries, asks clarification questions, and self-corrects SQL errors with up to 3 retries
- **Chat threads** — ChatGPT-style conversation threads with persistent history
- **Charts + dashboards** — Auto-generates Recharts visualizations and pin them to dashboards

## Architecture

```
┌─────────────┐         ┌─────────────────────────────────┐
│  Next.js    │──HTTP──▶│  FastAPI Backend (port 8080)    │
│  (port 3000)│         │  ┌────────────────────────────┐ │
└─────────────┘         │  │ Query Engine               │ │
                        │  │  ↓                          │ │
                        │  │ LLM Service                 │ │
                        │  │  ├── Ollama Provider        │ │
                        │  │  ├── OpenAI Provider        │ │
                        │  │  └── Anthropic Provider     │ │
                        │  └────────────────────────────┘ │
                        │  ┌────────────────────────────┐ │
                        │  │ Internal MCP Toolbox        │ │
                        │  │  /toolbox/{conn_id}/...     │ │
                        │  │  ├── PostgreSQL (asyncpg)   │ │
                        │  │  ├── MySQL (aiomysql)       │ │
                        │  │  ├── SQLite (aiosqlite)     │ │
                        │  │  └── ...                    │ │
                        │  └────────────────────────────┘ │
                        │  ┌────────────────────────────┐ │
                        │  │ ChromaDB (vector store)     │ │
                        │  │  for KB semantic search     │ │
                        │  └────────────────────────────┘ │
                        └─────────────────────────────────┘
                                    ↓
                            User's databases
```

## Quick Start

### Prerequisites

- Python 3.10+
- Node.js 20+
- (Optional) Ollama installed and running with a model pulled (e.g. `ollama pull llama3.2`)

### Backend

```bash
cd backend
python -m venv .venv
.venv/Scripts/activate     # Windows
# source .venv/bin/activate  # Linux/Mac
pip install -r requirements.txt
uvicorn app.main:app --port 8080
```

### Frontend

```bash
cd frontend
npm install
NEXT_PUBLIC_API_URL=http://localhost:8080 npm run dev
```

Open http://localhost:3000

### Docker Compose (alternative)

```bash
docker compose up
```

## Configuration

All LLM settings are managed from the **Settings** modal in the UI:

- **Ollama** — Set base URL (default `http://localhost:11434`) and model name (e.g. `llama3.2`)
- **OpenAI** — Provide API key from https://platform.openai.com/api-keys
- **Anthropic** — Provide API key from https://console.anthropic.com

Settings are stored in the app's SQLite database and take effect immediately.

## Project Structure

```
DB Dashboard2/
├── backend/
│   ├── app/
│   │   ├── main.py                      # FastAPI app + router mounting
│   │   ├── config.py                    # Pydantic settings
│   │   ├── database.py                  # Async SQLite engine
│   │   ├── models.py                    # ORM models
│   │   ├── schemas.py                   # Pydantic request/response
│   │   ├── routers/                     # API endpoints
│   │   │   ├── connections.py           # DB connection CRUD
│   │   │   ├── knowledge_base.py        # KB document upload + search
│   │   │   ├── metadata.py              # Schema annotations
│   │   │   ├── queries.py               # Question submission + threads
│   │   │   ├── dashboards.py            # Dashboard CRUD
│   │   │   └── settings.py              # LLM config endpoints
│   │   └── services/
│   │       ├── internal_toolbox.py      # In-process MCP Toolbox
│   │       ├── db_client.py             # SQLAlchemy DB client
│   │       ├── llm_providers.py         # Ollama/OpenAI/Anthropic
│   │       ├── llm_service.py           # Two-stage SQL generation
│   │       ├── kb_service.py            # PDF/text → ChromaDB
│   │       ├── query_engine.py          # Agentic orchestrator
│   │       └── settings_store.py        # Key-value settings
│   └── requirements.txt
├── frontend/
│   ├── app/
│   │   ├── (console)/                   # Main app routes
│   │   │   ├── chat/page.tsx            # Chat thread view
│   │   │   └── layout.tsx               # AppShell wrapper
│   │   ├── components/
│   │   │   ├── AppShell.tsx             # Sidebar + top header
│   │   │   ├── FullScreenModal.tsx      # Modal wrapper
│   │   │   ├── ChartPanel.tsx           # Recharts renderer
│   │   │   └── panels/                  # Modal contents
│   │   │       ├── ConnectionsPanel.tsx
│   │   │       ├── KnowledgeBasePanel.tsx
│   │   │       ├── MetadataPanel.tsx
│   │   │       ├── DashboardsPanel.tsx
│   │   │       └── SettingsPanel.tsx
│   │   └── lib/
│   │       ├── api.ts                   # HTTP client
│   │       └── types.ts                 # TS types
│   ├── tests/                           # Playwright E2E tests
│   └── package.json
├── test-infra/
│   ├── seed_test_db.py                  # Generates sample factory data
│   └── mock_toolbox.py                  # External MCP Toolbox mock
└── docker-compose.yml
```

## Tests

```bash
cd frontend
npx playwright test
```

Test suites:
- `app.spec.ts` — Smoke tests (UI loads, navigation works)
- `e2e-toolbox.spec.ts` — Internal toolbox flow (connection → schema → query)
- `e2e-real-world.spec.ts` — Multi-connection + multi-document scenario
- `e2e-accuracy.spec.ts` — Real LLM accuracy tests against test database
- `llm-settings.spec.ts` — LLM provider configuration

## License

MIT
