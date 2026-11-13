from sqlalchemy import create_engine, inspect, text

from app.database import Base, _apply_migrations


def test_additive_migration_patches_old_schema(tmp_path):
    db_path = tmp_path / "old.db"
    engine = create_engine(f"sqlite:///{db_path.as_posix()}")
    with engine.begin() as conn:
        # Fase-2 era tables: no conversation columns, no new tables.
        conn.execute(text(
            "CREATE TABLE tasks (id INTEGER PRIMARY KEY, title VARCHAR(160) NOT NULL,"
            " description TEXT NOT NULL DEFAULT '', status VARCHAR(24) NOT NULL DEFAULT 'pending',"
            " priority VARCHAR(16) NOT NULL DEFAULT 'normal', agent_id INTEGER, created_at DATETIME,"
            " updated_at DATETIME)"))
        conn.execute(text("INSERT INTO tasks (id, title) VALUES (1, 'legacy task')"))
        conn.execute(text(
            "CREATE TABLE task_events (id INTEGER PRIMARY KEY, task_id INTEGER NOT NULL,"
            " event_type VARCHAR(32) NOT NULL, message TEXT NOT NULL, created_at DATETIME)"))
        conn.execute(text(
            "CREATE TABLE qc_reviews (id INTEGER PRIMARY KEY, task_id INTEGER NOT NULL,"
            " plan_id INTEGER, iteration INTEGER NOT NULL DEFAULT 1,"
            " verdict VARCHAR(16) NOT NULL, criteria_json TEXT NOT NULL DEFAULT '',"
            " findings TEXT NOT NULL DEFAULT '', evidence TEXT NOT NULL DEFAULT '',"
            " created_at DATETIME)"))
    Base.metadata.create_all(engine)
    with engine.begin() as conn:
        _apply_migrations(conn)
    cols = {c["name"] for c in inspect(engine).get_columns("tasks")}
    assert {"conversation_id", "plan_step_index", "required", "acceptance_criteria",
            "provider_used", "model_used", "parent_id", "run_mode",
            "qc_rerun_requested"} <= cols
    event_cols = {c["name"] for c in inspect(engine).get_columns("task_events")}
    assert {"conversation_id", "agent_id", "provider", "model", "step_index"} <= event_cols
    qc_cols = {c["name"] for c in inspect(engine).get_columns("qc_reviews")}
    assert {"artifacts_json", "provider", "model"} <= qc_cols
    tables = set(inspect(engine).get_table_names())
    assert {"conversations", "messages", "plans", "approvals", "qc_reviews", "telegram_updates"} <= tables
    with engine.connect() as conn:
        row = conn.execute(text("SELECT title, required FROM tasks WHERE id=1")).one()
    assert row[0] == "legacy task" and row[1] == "1"
