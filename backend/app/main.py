from contextlib import asynccontextmanager

import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import auth
from app.database import init_db
from app.office_ops import OfficeOps
from app.orchestrator import Orchestrator
from app.publishing.scheduler import NewsScheduler
from app.channels import telegram
from app.api import (agents, ai, auth as auth_api, channels, characters, claude, conversations,
                     events, health, integrations, preview, publishing, tasks)

@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    orchestrator = Orchestrator()
    orchestrator.start()
    app.state.orchestrator = orchestrator
    # Office simulation runs regardless of ai_enabled: patrols and cleaning are
    # journal-recorded simulation state, never PC or file operations.
    office_ops = OfficeOps()
    office_ops.start()
    app.state.office_ops = office_ops
    news_scheduler = NewsScheduler()
    news_scheduler.start()
    app.state.news_scheduler = news_scheduler
    poller = telegram.start_from_env()
    app.state.telegram_poller = poller
    try:
        yield
    finally:
        telegram.stop_poller()
        news_scheduler.stop()
        office_ops.stop()
        orchestrator.stop()
        orchestrator.join(timeout=5)

app = FastAPI(title="AgentVille API", version="0.2.0", lifespan=lifespan)

# Registered first so CORS (added last) stays outermost and can answer preflight requests
# before the session gate sees them.
app.add_middleware(auth.AuthMiddleware)

_origins = [o.strip() for o in os.getenv(
    "AGENTVILLE_CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Last-Event-ID"],
)

app.include_router(auth_api.router, prefix="/api")
app.include_router(health.router, prefix="/api")
app.include_router(agents.router, prefix="/api")
app.include_router(tasks.router, prefix="/api")
app.include_router(preview.router, prefix="/api")
app.include_router(ai.router, prefix="/api")
app.include_router(characters.router, prefix="/api")
app.include_router(events.router, prefix="/api")
app.include_router(channels.router, prefix="/api")
app.include_router(conversations.router, prefix="/api")
app.include_router(integrations.router, prefix="/api")
app.include_router(publishing.router, prefix="/api")
app.include_router(claude.router, prefix="/api")
