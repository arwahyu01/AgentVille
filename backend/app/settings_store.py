from sqlalchemy.orm import Session

from app.database import DEFAULT_SETTINGS
from app.models import Settings

def get_setting(db: Session, key: str) -> str:
    row = db.get(Settings, key)
    if row is not None:
        return row.value
    return DEFAULT_SETTINGS.get(key, "")

def set_setting(db: Session, key: str, value: str) -> None:
    row = db.get(Settings, key)
    if row is None:
        db.add(Settings(key=key, value=value))
    else:
        row.value = value

def ai_enabled(db: Session) -> bool:
    return get_setting(db, "ai_enabled") == "1"

def ai_model(db: Session) -> str:
    return get_setting(db, "ai_model")

def ai_timeout_s(db: Session) -> int:
    try:
        return max(10, min(1800, int(get_setting(db, "ai_timeout_s"))))
    except ValueError:
        return 300

def ai_provider(db: Session) -> str:
    value = get_setting(db, "ai_provider")
    return value if value in ("opencode", "qoder") else "opencode"

def ai_model_for(db: Session, provider: str) -> str:
    return get_setting(db, "ai_model_qoder") if provider == "qoder" else get_setting(db, "ai_model")

def ai_fallback_enabled(db: Session) -> bool:
    return get_setting(db, "ai_fallback_enabled") == "1"

def ai_retry_max(db: Session) -> int:
    try:
        return max(0, min(3, int(get_setting(db, "ai_retry_max"))))
    except ValueError:
        return 1


def _int_setting(db: Session, key: str, default: int, lo: int, hi: int) -> int:
    try:
        return max(lo, min(hi, int(get_setting(db, key))))
    except (ValueError, TypeError):
        return default


def plan_max_steps(db: Session) -> int:
    return _int_setting(db, "max_plan_steps", 24, 1, 200)


def plan_max_depth(db: Session) -> int:
    return _int_setting(db, "max_delegation_depth", 4, 1, 50)


def max_concurrency(db: Session) -> int:
    """How many independent DAG nodes may run at once (bounded worker pool)."""
    return _int_setting(db, "max_concurrency", 3, 1, 16)


def lease_seconds(db: Session) -> int:
    """A claimed node's lease must be renewed (heartbeat) within this window or another
    worker may take it over after a crash/restart."""
    return _int_setting(db, "worker_lease_s", 120, 15, 3600)


def merge_policy(db: Session) -> str:
    value = get_setting(db, "merge_policy")
    return value if value in ("worktree", "lock", "shared") else "worktree"
