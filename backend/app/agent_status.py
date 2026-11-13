from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.models import Agent, Task
from app.rooms import OPERATIONAL_ROLES

def _sortable(dt: datetime) -> datetime:
    # SQLite returns naive datetimes while in-process assignments are tz-aware.
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt

def sync_agent_status(db: Session, agent_id: int | None = None) -> None:
    """Derive each agent's status from its assigned tasks. Single source of truth: the database.
    Office staff (Housekeeping/Security) are excluded: they have no project tasks, and their
    status belongs to the office simulation daemon."""
    query = db.query(Agent).filter(Agent.role.notin_(OPERATIONAL_ROLES))
    if agent_id is not None:
        query = query.filter(Agent.id == agent_id)
    agents = query.all()
    if not agents:
        return
    tasks = db.query(Task).filter(Task.agent_id.in_([a.id for a in agents])).all()
    by_agent: dict[int, list[Task]] = {}
    for task in tasks:
        by_agent.setdefault(task.agent_id, []).append(task)
    now = datetime.now(timezone.utc)
    for agent in agents:
        agent_tasks = by_agent.get(agent.id, [])
        statuses = {t.status for t in agent_tasks}
        if "running" in statuses:
            new_status = "working"
        elif "reviewing" in statuses:
            new_status = "reviewing"
        elif {"queued", "pending", "approved", "clarifying", "awaiting_approval"} & statuses:
            # A conversation parked in clarifying/awaiting_approval means the Coordinator is
            # genuinely blocked on the user — showing it idle would misreport the office.
            new_status = "waiting"
        else:
            last = max(agent_tasks, key=lambda t: (_sortable(t.updated_at), t.id), default=None)
            if last is None:
                new_status = "idle"
            elif last.status == "completed":
                new_status = "completed"
            elif last.status == "failed":
                new_status = "failed"
            else:
                new_status = "idle"
        if agent.status != new_status:
            agent.status = new_status
            agent.updated_at = now
