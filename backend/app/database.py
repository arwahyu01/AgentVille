import os
from pathlib import Path

from sqlalchemy import create_engine, event, inspect, text
from sqlalchemy.orm import DeclarativeBase, sessionmaker

PROJECT_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = PROJECT_ROOT / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)
DATABASE_URL = os.getenv("AGENTVILLE_DATABASE_URL", f"sqlite:///{(DATA_DIR / 'agentville.db').as_posix()}")

connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}
engine = create_engine(DATABASE_URL, connect_args=connect_args, future=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)

@event.listens_for(engine, "connect")
def _enable_sqlite_fkeys(dbapi_connection, connection_record):
    if DATABASE_URL.startswith("sqlite"):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        # WAL keeps API reads fast while the orchestrator thread writes per step.
        cursor.execute("PRAGMA journal_mode=WAL")
        # Readers/wait on writers instead of failing instantly during concurrent bursts.
        cursor.execute("PRAGMA busy_timeout=5000")
        cursor.close()

class Base(DeclarativeBase):
    pass

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# Additive column migrations for databases created by earlier versions.
# create_all() only creates new tables; existing tables get patched here.
# SQLite requires a constant default for ALTER TABLE ADD COLUMN.
COLUMN_MIGRATIONS = {
    "agents": {
        "created_at": "DATETIME DEFAULT '1970-01-01 00:00:00'",
        "updated_at": "DATETIME DEFAULT '1970-01-01 00:00:00'",
        "current_room": "TEXT DEFAULT ''",
        "target_room": "TEXT DEFAULT ''",
        "workstation": "TEXT DEFAULT ''",
        "active_step_index": "INTEGER",
    },
    "tasks": {
        "parent_id": "INTEGER",
        "run_mode": "TEXT DEFAULT 'manual'",
        "plan_json": "TEXT DEFAULT ''",
        "result": "TEXT DEFAULT ''",
        "artifact_path": "TEXT DEFAULT ''",
        "conversation_id": "INTEGER",
        "plan_step_index": "INTEGER",
        "required": "TEXT DEFAULT '1'",
        "acceptance_criteria": "TEXT DEFAULT ''",
        "provider_used": "TEXT",
        "model_used": "TEXT",
        "depends_on_json": "TEXT DEFAULT ''",
        "lease_owner": "TEXT",
        "lease_expires_at": "DATETIME",
        "heartbeat_at": "DATETIME",
        "attempt": "INTEGER DEFAULT 0",
        "branch": "TEXT DEFAULT ''",
        "worktree_path": "TEXT DEFAULT ''",
        "qc_rerun_requested": "INTEGER DEFAULT 0",
    },
    "qc_reviews": {
        "artifacts_json": "TEXT DEFAULT ''",
        "provider": "TEXT",
        "model": "TEXT",
    },
    "task_events": {
        "conversation_id": "INTEGER",
        "agent_id": "INTEGER",
        "provider": "TEXT",
        "model": "TEXT",
        "step_index": "INTEGER",
        "actor_agent_id": "INTEGER",
        "recipient_agent_id": "INTEGER",
        "from_room": "TEXT",
        "to_room": "TEXT",
    },
}

INDEX_MIGRATIONS = [
    "CREATE INDEX IF NOT EXISTS ix_tasks_agent_id ON tasks(agent_id)",
    "CREATE INDEX IF NOT EXISTS ix_tasks_status ON tasks(status)",
    "CREATE INDEX IF NOT EXISTS ix_tasks_parent_id ON tasks(parent_id)",
    "CREATE INDEX IF NOT EXISTS ix_tasks_conversation_id ON tasks(conversation_id)",
    "CREATE INDEX IF NOT EXISTS ix_task_events_task_id ON task_events(task_id)",
    "CREATE INDEX IF NOT EXISTS ix_task_events_conversation_id ON task_events(conversation_id)",
    "CREATE INDEX IF NOT EXISTS ix_messages_conversation_id ON messages(conversation_id)",
    "CREATE INDEX IF NOT EXISTS ix_plans_conversation_id ON plans(conversation_id)",
    "CREATE INDEX IF NOT EXISTS ix_approvals_plan_id ON approvals(plan_id)",
    "CREATE INDEX IF NOT EXISTS ix_qc_reviews_task_id ON qc_reviews(task_id)",
    "CREATE INDEX IF NOT EXISTS ix_office_events_dedupe_key ON office_events(dedupe_key)",
    "CREATE INDEX IF NOT EXISTS ix_office_events_created_at ON office_events(created_at)",
]

def _apply_migrations(conn):
    inspector = inspect(conn)
    tables = set(inspector.get_table_names())
    for table, columns in COLUMN_MIGRATIONS.items():
        if table not in tables:
            continue
        existing = {c["name"] for c in inspector.get_columns(table)}
        for name, ddl in columns.items():
            if name not in existing:
                conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {name} {ddl}"))
    for statement in INDEX_MIGRATIONS:
        conn.execute(text(statement))

def init_db():
    from app import models  # noqa: F401
    Base.metadata.create_all(bind=engine)
    with engine.begin() as conn:
        _apply_migrations(conn)
    seed_defaults()
    seed_settings()

DEFAULT_AGENTS = [
    ("Atlas", "AI Coordinator", -4.2, -0.25),
    ("Byte", "Developer", -1.4, -0.25),
    ("Sage", "Researcher", 1.4, -0.25),
    ("Nova", "Data Analyst", 4.2, -0.25),
    ("Quill", "Administrator", -4.2, 2.65),
    ("Pixel", "Content Creator", -1.4, 2.65),
    ("Proof", "Reviewer", 1.4, 2.65),
    ("Scout", "Product Analyst", 4.2, 2.65),
    ("Ink", "UI/UX Designer", -4.2, 5.55),
    ("Blaze", "Frontend Developer", -1.4, 5.55),
    ("Forge", "Backend Developer", 1.4, 5.55),
    ("Gauge", "QA Engineer", 4.2, 5.55),
    # Office staff for the simulation only. These roles are deliberately absent from
    # plan_schema.ROLES, so the planner can never bind a project step to them and no
    # real PC resource is touched by their "work".
    ("Dusty", "Housekeeping", -4.2, 8.2),
    ("Sentra", "Security", 7.0, -6.4),
]

# Legacy seeds placed agents on a 3x2 grid; the office now uses a 4+3 layout.
# Agents still sitting on the old coordinates are moved to their new workstation.
LEGACY_POSITIONS = {
    "Atlas": (-2.8, -0.25, -4.2, -0.25),
    "Nova": (0.0, -0.25, 4.2, -0.25),
    "Pixel": (2.8, -0.25, -1.4, 2.65),
    "Byte": (-2.8, 2.6, -1.4, -0.25),
}

def seed_defaults():
    from app.models import Agent
    with SessionLocal() as db:
        existing = {name for (name,) in db.query(Agent.name).all()}
        added = False
        for name, role, x, z in DEFAULT_AGENTS:
            if name not in existing:
                db.add(Agent(name=name, role=role, status="idle", position_x=x, position_z=z))
                added = True
        for agent in db.query(Agent).all():
            legacy = LEGACY_POSITIONS.get(agent.name)
            if legacy and (agent.position_x, agent.position_z) == (legacy[0], legacy[1]):
                agent.position_x, agent.position_z = legacy[2], legacy[3]
                added = True
        if added:
            db.commit()

DEFAULT_SETTINGS = {
    "ai_enabled": "0",
    "ai_model": "opencode/big-pickle",
    "ai_timeout_s": "300",
    "ai_provider": "opencode",
    "ai_model_qoder": "Efficient",
    "ai_model_claude": "sonnet",
    "ai_fallback_enabled": "0",
    "ai_retry_max": "1",
    # Agent chatter: "static" keeps templated lines (0 tokens), "milestone" lets the model
    # speak at handoffs/escalations/QC, "full" rewrites every spoken line.
    "agent_chat_mode": "static",
    "workspace_root": "",
    "max_plan_steps": "24",
    "max_delegation_depth": "4",
    "max_concurrency": "3",
    "max_parallel_jobs": "4",
    "worker_lease_s": "120",
    "merge_policy": "worktree",
    # Office simulation cadence (seconds per schedule slot). The daemon is deterministic:
    # slot = wall_clock // tick, so restarts resume the same timetable without duplicates.
    "office_ops_enabled": "1",
    "office_patrol_tick_s": "60",
    "office_cleaning_tick_s": "90",
}

def seed_settings():
    from app.models import Settings
    with SessionLocal() as db:
        existing = {key for (key,) in db.query(Settings.key).all()}
        for key, value in DEFAULT_SETTINGS.items():
            if key not in existing:
                db.add(Settings(key=key, value=value))
        db.commit()
