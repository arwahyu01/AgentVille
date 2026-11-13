"""Realtime event stream for the office: SSE frames built from the task_events journal.

The journal doubles as the replay buffer — task_events.id is the cursor, so a reconnecting
client can resume exactly where it left off via Last-Event-ID. The stream tails the database
(1s poll) instead of an in-memory bus: the orchestrator runs on its own thread and SQLite
already serialises the writes, so tailing is the honest single source of truth.

office_events (the simulation journal: patrols, cleaning) rides the same stream as
`event: office_event` frames. It has its own id sequence, so Last-Event-ID replay applies
to task events only; office frames start from the connection point."""

import asyncio
import json

from starlette.requests import Request

from app.database import SessionLocal
from app.models import OfficeEvent, TaskEvent

POLL_INTERVAL_S = 1.0
BATCH_LIMIT = 100


def payload(event: TaskEvent) -> dict:
    return {
        "id": event.id,
        "taskId": event.task_id,
        "type": event.event_type,
        "message": event.message,
        "conversationId": event.conversation_id,
        "agentId": event.agent_id,
        "provider": event.provider,
        "model": event.model,
        "stepIndex": event.step_index,
        "actorAgentId": event.actor_agent_id,
        "recipientAgentId": event.recipient_agent_id,
        "fromRoom": event.from_room,
        "toRoom": event.to_room,
        "createdAt": event.created_at.isoformat() if event.created_at else None,
    }


def office_payload(event: OfficeEvent) -> dict:
    return {
        "id": event.id,
        "dedupeKey": event.dedupe_key,
        "type": event.event_type,
        "message": event.message,
        "actorAgentId": event.actor_agent_id,
        "actorName": event.actor_name,
        "fromRoom": event.from_room,
        "toRoom": event.to_room,
        "area": event.area,
        "status": event.status,
        "createdAt": event.created_at.isoformat() if event.created_at else None,
    }


def latest_event_id() -> int:
    with SessionLocal() as db:
        row = db.query(TaskEvent).order_by(TaskEvent.id.desc()).first()
        return row.id if row else 0


def latest_office_id() -> int:
    with SessionLocal() as db:
        row = db.query(OfficeEvent).order_by(OfficeEvent.id.desc()).first()
        return row.id if row else 0


def fetch_after(cursor: int) -> list[TaskEvent]:
    with SessionLocal() as db:
        return (db.query(TaskEvent).filter(TaskEvent.id > cursor)
                .order_by(TaskEvent.id.asc()).limit(BATCH_LIMIT).all())


def fetch_office_after(cursor: int) -> list[OfficeEvent]:
    with SessionLocal() as db:
        return (db.query(OfficeEvent).filter(OfficeEvent.id > cursor)
                .order_by(OfficeEvent.id.asc()).limit(BATCH_LIMIT).all())


async def stream_events(request: Request, since: int | None):
    cursor = latest_event_id() if since is None else since
    office_cursor = latest_office_id()
    while True:
        if await request.is_disconnected():
            return
        rows = fetch_after(cursor)
        office_rows = fetch_office_after(office_cursor)
        if not rows and not office_rows:
            await asyncio.sleep(POLL_INTERVAL_S)
            continue
        for event in rows:
            cursor = event.id
            frame = f"id: {event.id}\nevent: task_event\ndata: {json.dumps(payload(event))}\n\n"
            yield frame
        for event in office_rows:
            office_cursor = event.id
            frame = f"event: office_event\ndata: {json.dumps(office_payload(event))}\n\n"
            yield frame
