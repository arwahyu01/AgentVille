from datetime import datetime, timedelta, timezone
from pathlib import Path

from sqlalchemy import or_
from sqlalchemy.orm import Session

from app import chatter
from app.agent_actions import sanitize_event
from app.agent_status import sync_agent_status
from app.models import Agent, Task, TaskEvent

ALLOWED_TRANSITIONS = {
    "pending": {"queued", "cancelled", "clarifying"},
    "clarifying": {"awaiting_approval", "cancelled"},
    "awaiting_approval": {"clarifying", "approved", "cancelled"},
    # A plan runs automatically, so the user can still pull an approved/queued request back
    # into clarifying (revise) instead of being stuck once the gate is gone.
    "approved": {"queued", "cancelled", "clarifying"},
    "queued": {"running", "cancelled", "clarifying"},
    "running": {"completed", "reviewing", "failed", "cancelled", "clarifying"},
    "reviewing": {"completed", "failed", "running"},
    "completed": set(),
    "failed": {"queued", "cancelled"},
    "cancelled": set(),
}

# Everything a user can stop from the single-page console. History is never deleted:
# "clear all tasks" only cancels what is still in flight.
ACTIVE_STATUSES = ("pending", "clarifying", "awaiting_approval", "approved", "queued",
                   "running", "reviewing")

# States that belong to the conversation workflow; only anchors (run_mode='conversation')
# may enter them — manual/AI tasks keep the Fase-2 subset.
CONVERSATION_STATES = {"clarifying", "awaiting_approval", "approved", "reviewing"}

class TransitionError(Exception):
    pass

PROJECT_ROOT = Path(__file__).resolve().parents[2]
ARTIFACTS_DIR = PROJECT_ROOT / "data" / "artifacts"
MAX_ARTIFACT_BYTES = 512 * 1024


def add_event(db: Session, task_id: int, event_type: str, message: str, *,
              conversation_id: int | None = None, agent_id: int | None = None,
              provider: str | None = None, model: str | None = None,
              step_index: int | None = None, actor_agent_id: int | None = None,
              recipient_agent_id: int | None = None, from_room: str | None = None,
              to_room: str | None = None) -> TaskEvent:
    if agent_id is None:
        # Without an agent on the frame the 3D office cannot tell who moved, so a plain
        # status change is attributed to the agent that owns the task.
        owner = db.get(Task, task_id)
        agent_id = owner.agent_id if owner is not None else None
    event = TaskEvent(task_id=task_id, event_type=str(event_type)[:32],
                      message=sanitize_event(message),
                      conversation_id=conversation_id, agent_id=agent_id,
                      provider=provider, model=model, step_index=step_index,
                      actor_agent_id=actor_agent_id, recipient_agent_id=recipient_agent_id,
                      from_room=from_room, to_room=to_room)
    db.add(event)
    return event


def seat_agent(db: Session, agent_id: int | None, *, room: str | None = None,
               workstation: str | None = None, step_index: int | None = None,
               target_room: str | None = None) -> None:
    """Pin an agent to a room/workstation (and optionally a travel target) so the office
    reflects assignment, not a guess. No-op for agents that do not exist."""
    if agent_id is None:
        return
    agent = db.get(Agent, agent_id)
    if agent is None:
        return
    if room is not None:
        agent.current_room = room
    if workstation is not None:
        agent.workstation = workstation
    if target_room is not None:
        agent.target_room = target_room
    if step_index is not None:
        agent.active_step_index = step_index
    agent.updated_at = datetime.now(timezone.utc)


def transition(db: Session, task: Task, new_status: str, message: str | None = None,
               event_type: str = "status_changed", *, conversation_id: int | None = None) -> Task:
    """Validate + apply a task status transition, record the event, sync agent status, commit."""
    if new_status not in ALLOWED_TRANSITIONS.get(task.status, set()):
        raise TransitionError(f"Invalid status transition: {task.status} -> {new_status}")
    if new_status in CONVERSATION_STATES and task.run_mode != "conversation":
        raise TransitionError(f"Status '{new_status}' is only valid for conversation tasks")
    old_status = task.status
    task.status = new_status
    task.updated_at = datetime.now(timezone.utc)
    add_event(db, task.id, event_type, message or f"Status changed: {old_status} -> {new_status}",
              conversation_id=conversation_id if conversation_id is not None else task.conversation_id)
    sync_agent_status(db)
    db.commit()
    db.refresh(task)
    return task


def force_transition(db: Session, task: Task, new_status: str, message: str,
                     event_type: str = "status_changed") -> Task:
    """For orchestrator recovery paths that must bypass the normal transition table (e.g. interrupted runs)."""
    task.status = new_status
    task.updated_at = datetime.now(timezone.utc)
    add_event(db, task.id, event_type, message)
    sync_agent_status(db)
    db.commit()
    db.refresh(task)
    return task


def cancel_tree(db: Session, task: Task, message: str = "Cancelled by user") -> Task:
    """Cancel one task and everything it spawned. Step tasks are scheduled by the
    orchestrator, so leaving them behind would keep the office working on a dead request."""
    if task.status not in ACTIVE_STATUSES:
        return task
    for child in db.query(Task).filter(Task.parent_id == task.id).all():
        if child.status in ("pending", "queued", "running", "reviewing"):
            force_transition(db, child, "cancelled", "Cancelled with its parent request")
    return transition(db, task, "cancelled", message, "cancelled")


def clear_active_tasks(db: Session) -> dict:
    """Stop every in-flight request but keep the journal and result history intact."""
    anchors = (db.query(Task)
               .filter(Task.parent_id.is_(None), Task.status.in_(ACTIVE_STATUSES))
               .order_by(Task.id).all())
    stopped: list[int] = []
    for task in anchors:
        try:
            cancel_tree(db, task, "Stopped from the console (clear tasks)")
            stopped.append(task.id)
        except TransitionError:
            continue
    return {"stopped": stopped, "count": len(stopped)}


def active_agent(db: Session, role: str) -> Agent | None:
    """First agent holding the role — the roster maps one seat per role."""
    return db.query(Agent).filter(Agent.role == role).order_by(Agent.id).first()


def say(db: Session, task_id: int, speaker: Agent | None, message: str, *,
        recipient: Agent | None = None, conversation_id: int | None = None,
        event_type: str = "agent_chat", step_index: int | None = None) -> TaskEvent:
    """One spoken line from an agent, stored as journal data so the team feed and the
    office can replay the conversation exactly as it happened. When real chatter is on,
    the honest template is stored now and a background model call may rewrite it."""
    event = add_event(db, task_id, event_type, message,
                      conversation_id=conversation_id,
                      agent_id=speaker.id if speaker else None,
                      step_index=step_index,
                      actor_agent_id=speaker.id if speaker else None,
                      recipient_agent_id=recipient.id if recipient else None)
    chatter.maybe_schedule(db, event)
    return event


def save_result(db: Session, task: Task, text: str) -> Task:
    """Store the AI output on the task and persist it as an artifact file (capped in size)."""
    clipped = text[:MAX_ARTIFACT_BYTES]
    task.result = clipped
    ARTIFACTS_DIR.mkdir(parents=True, exist_ok=True)
    artifact = ARTIFACTS_DIR / f"task-{task.id}.md"
    header = f"# {task.title}\n\nAgent: {task.agent.name if task.agent else 'unassigned'}\nRun mode: {task.run_mode}\n\n---\n\n"
    artifact.write_text(header + clipped, encoding="utf-8")
    try:
        task.artifact_path = str(artifact.relative_to(PROJECT_ROOT))
    except ValueError:
        task.artifact_path = str(artifact)
    task.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(task)
    return task


# -- scheduler leases ----------------------------------------------------------
#
# A lease is a time-boxed atomic claim: exactly one worker can move a node from
# unclaimed (or an expired lease) to claimed, so a restart or a second worker can never
# run the same node twice. The reclaim window also revives nodes whose owner died.


def _now() -> datetime:
    return datetime.now(timezone.utc)


def claim_task(db: Session, task_id: int, owner: str, lease_s: int) -> bool:
    """Atomically take the lease for task_id. Returns True only for the winning caller."""
    now = _now()
    freed = or_(
        Task.lease_owner.is_(None),
        Task.lease_owner == owner,
        Task.lease_expires_at.is_(None),
        Task.lease_expires_at < now,
    )
    rows = (db.query(Task)
            .filter(Task.id == task_id, freed)
            .update({"lease_owner": owner, "lease_expires_at": now + timedelta(seconds=lease_s),
                     "heartbeat_at": now},
                    synchronize_session=False))
    db.commit()
    return rows == 1


def heartbeat(db: Session, task_id: int, owner: str, lease_s: int) -> bool:
    """Extend the lease, but only if this owner still holds it (guards against a stolen one)."""
    now = _now()
    rows = (db.query(Task)
            .filter(Task.id == task_id, Task.lease_owner == owner)
            .update({"lease_expires_at": now + timedelta(seconds=lease_s), "heartbeat_at": now},
                    synchronize_session=False))
    db.commit()
    return rows == 1


def release_lease(db: Session, task_id: int, owner: str | None = None) -> None:
    """Clear the lease on completion/failure so the node never blocks a re-run."""
    query = db.query(Task).filter(Task.id == task_id)
    if owner is not None:
        query = query.filter(Task.lease_owner == owner)
    query.update({"lease_owner": None, "lease_expires_at": None}, synchronize_session=False)
    db.commit()
