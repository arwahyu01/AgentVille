"""Shared ingest path for normalized channel events.

One conversation per channel identity: incoming messages join the active (non-terminal)
conversation, or start a fresh one after the previous request finished."""

from sqlalchemy.orm import Session

from app.channels.base import ChannelEvent
from app import conversation_service
from app.models import Conversation, Task

TERMINAL_STATUSES = ("completed", "failed", "cancelled")


def ingest_message(db: Session, event: ChannelEvent) -> Conversation:
    conv = (db.query(Conversation)
            .filter(Conversation.channel == event.channel,
                    Conversation.user_identity == event.identity)
            .order_by(Conversation.id.desc()).first())
    if conv is not None:
        anchor = db.get(Task, conv.anchor_task_id) if conv.anchor_task_id else None
        if anchor is None or anchor.status in TERMINAL_STATUSES:
            conv = None
    if conv is None:
        return conversation_service.create_conversation(db, event.text, channel=event.channel,
                                                        user_identity=event.identity,
                                                        external_id=event.external_id)
    conversation_service.add_message(db, conv.id, event.text, external_id=event.external_id)
    return conv
