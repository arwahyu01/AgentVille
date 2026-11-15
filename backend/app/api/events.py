from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.database import get_db
from app.events import stream_events
from app.models import Agent, OfficeEvent, Task, TaskEvent
from app.schemas import OfficeEventRead, TeamEventRead

router = APIRouter(prefix="/events", tags=["events"])


@router.get("/stream")
async def event_stream(request: Request, since: int | None = Query(None, ge=0)):
    if since is None:
        header = request.headers.get("last-event-id")
        if header and header.isdigit():
            since = int(header)
    return StreamingResponse(
        stream_events(request, since),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive", "X-Accel-Buffering": "no"},
    )


@router.get("/office", response_model=list[OfficeEventRead])
def list_office_events(limit: int = Query(50, ge=1, le=200),
                       since_id: int | None = Query(None, ge=0),
                       db: Session = Depends(get_db)):
    """Office simulation journal (patrols, cleaning) — newest first."""
    query = db.query(OfficeEvent)
    if since_id is not None:
        query = query.filter(OfficeEvent.id > since_id)
    return query.order_by(OfficeEvent.id.desc()).limit(limit).all()


@router.get("/team", response_model=list[TeamEventRead])
def list_team_events(limit: int = Query(60, ge=1, le=200),
                     conversation_id: int | None = Query(None, ge=1),
                     task_id: int | None = Query(None, ge=1),
                     include_actions: bool = Query(False),
                     db: Session = Depends(get_db)):
    """The team work transcript: persisted journal frames with the speaker's name/role,
    the recipient and the task title attached, newest first. This is the history feed for the
    Percakapan Tim panel; live updates ride the existing /events/stream."""
    query = (db.query(TaskEvent, Task, Agent)
             .outerjoin(Task, Task.id == TaskEvent.task_id)
             .outerjoin(Agent, Agent.id == TaskEvent.agent_id))
    if conversation_id is not None:
        query = query.filter(TaskEvent.conversation_id == conversation_id)
    if task_id is not None:
        query = query.filter(TaskEvent.task_id == task_id)
    if not include_actions:
        # Per-tool `action_*` frames feed the office view; in the transcript they would push the
        # milestones (plans, handoffs, QC) out of the newest-60 window.
        query = query.filter(~TaskEvent.event_type.like("action\\_%", escape="\\"))
    rows = query.order_by(TaskEvent.id.desc()).limit(limit).all()
    # Recipient/actor names are needed by the feed to show "Leader → Byte" lines; one lookup
    # per distinct agent keeps this a single extra query instead of one per row.
    ids = {ev.recipient_agent_id for ev, _t, _a in rows if ev.recipient_agent_id}
    names = {a.id: a.name for a in db.query(Agent).filter(Agent.id.in_(ids)).all()} if ids else {}
    return [
        TeamEventRead(id=ev.id, task_id=ev.task_id, task_title=task.title if task else "",
                      event_type=ev.event_type, message=ev.message, created_at=ev.created_at,
                      agent_id=ev.agent_id, agent_name=agent.name if agent else None,
                      agent_role=agent.role if agent else None, step_index=ev.step_index,
                      provider=ev.provider, model=ev.model,
                      actor_agent_id=ev.actor_agent_id,
                      actor_name=agent.name if agent else names.get(ev.actor_agent_id) if ev.actor_agent_id else None,
                      recipient_agent_id=ev.recipient_agent_id,
                      recipient_name=names.get(ev.recipient_agent_id) if ev.recipient_agent_id else None,
                      conversation_id=ev.conversation_id)
        for ev, task, agent in rows
    ]
