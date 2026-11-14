from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.database import init_db
from app.office_ops import OfficeOps
from app.orchestrator import Orchestrator
from app.channels import telegram
from app.api import agents, ai, channels, characters, claude, conversations, events, health, tasks

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
    poller = telegram.start_from_env()
    app.state.telegram_poller = poller
    try:
        yield
    finally:
        telegram.stop_poller()
        office_ops.stop()
        orchestrator.stop()
        orchestrator.join(timeout=5)

app = FastAPI(title="AgentVille API", version="0.2.0", lifespan=lifespan)

# Local development only. If deployed beyond localhost, add authentication and tighten CORS.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=False,
    allow_methods=["GET", "POST", "PATCH", "OPTIONS"],
    allow_headers=["Content-Type"],
)

app.include_router(health.router, prefix="/api")
app.include_router(agents.router, prefix="/api")
app.include_router(tasks.router, prefix="/api")
app.include_router(ai.router, prefix="/api")
app.include_router(characters.router, prefix="/api")
app.include_router(events.router, prefix="/api")
app.include_router(channels.router, prefix="/api")
app.include_router(conversations.router, prefix="/api")
app.include_router(claude.router, prefix="/api")
