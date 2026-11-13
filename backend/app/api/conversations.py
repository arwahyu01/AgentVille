import json

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.conversation_service import (ConversationError, add_message, approve_plan,
                                      cancel_conversation, create_conversation, get_conversation,
                                      get_plan_row, list_messages, plan_history, request_revision)
from app.database import get_db
from app.models import Conversation, Task
from app.schemas import (ApproveRequest, ConversationCreate, ConversationRead, MessageCreate,
                         MessageRead, PlanRead, ReviseRequest)

router = APIRouter(tags=["conversations"])


def _http(e: ConversationError) -> HTTPException:
    return HTTPException(status_code=e.status_code, detail=str(e))


def _read(db: Session, conv) -> ConversationRead:
    anchor = db.get(Task, conv.anchor_task_id) if conv.anchor_task_id else None
    return ConversationRead(
        id=conv.id, channel=conv.channel, user_identity=conv.user_identity, title=conv.title,
        anchor_task_id=conv.anchor_task_id, current_plan_version=conv.current_plan_version,
        status=anchor.status if anchor else "unknown",
        created_at=conv.created_at, updated_at=conv.updated_at,
    )


def _plan_read(row) -> PlanRead:
    try:
        steps = json.loads(row.steps_json or "[]").get("steps", [])
    except (json.JSONDecodeError, AttributeError):
        steps = []
    return PlanRead(id=row.id, conversation_id=row.conversation_id, version=row.version,
                    status=row.status, summary=row.summary, created_at=row.created_at, steps=steps)


@router.post("/conversations", response_model=ConversationRead, status_code=201)
def create(payload: ConversationCreate, db: Session = Depends(get_db)):
    if not payload.first_message.strip():
        raise HTTPException(status_code=422, detail="first_message cannot be blank")
    conv = create_conversation(db, payload.first_message, channel=payload.channel)
    return _read(db, conv)


@router.get("/conversations", response_model=list[ConversationRead])
def list_conversations(db: Session = Depends(get_db)):
    return [_read(db, conv) for conv in db.query(Conversation).order_by(Conversation.id.desc()).all()]


@router.get("/conversations/{conversation_id}", response_model=ConversationRead)
def get_one(conversation_id: int, db: Session = Depends(get_db)):
    try:
        conv = get_conversation(db, conversation_id)
    except ConversationError as e:
        raise _http(e)
    return _read(db, conv)


@router.get("/conversations/{conversation_id}/messages", response_model=list[MessageRead])
def messages(conversation_id: int, db: Session = Depends(get_db)):
    try:
        rows = list_messages(db, conversation_id)
    except ConversationError as e:
        raise _http(e)
    return rows


@router.post("/conversations/{conversation_id}/messages", response_model=MessageRead, status_code=202)
def post_message(conversation_id: int, payload: MessageCreate, db: Session = Depends(get_db)):
    try:
        conv = get_conversation(db, conversation_id)
    except ConversationError as e:
        raise _http(e)
    anchor = db.get(Task, conv.anchor_task_id)
    if anchor is None or anchor.status != "clarifying":
        raise HTTPException(status_code=409, detail="The conversation is not in a clarifying state")
    msg = add_message(db, conv.id, payload.content.strip(), role="user")
    if msg is None:
        raise HTTPException(status_code=500, detail="Message could not be stored")
    return msg


@router.get("/conversations/{conversation_id}/plan", response_model=dict)
def plan(conversation_id: int, db: Session = Depends(get_db)):
    try:
        conv = get_conversation(db, conversation_id)
    except ConversationError as e:
        raise _http(e)
    current = get_plan_row(db, conv.id, conv.current_plan_version) if conv.current_plan_version else None
    return {"current": _plan_read(current).model_dump() if current else None,
            "history": [_plan_read(row).model_dump() for row in plan_history(db, conv.id)]}


@router.post("/conversations/{conversation_id}/approve", response_model=PlanRead)
def approve(conversation_id: int, payload: ApproveRequest, db: Session = Depends(get_db)):
    try:
        row = approve_plan(db, conversation_id, payload.plan_version)
    except ConversationError as e:
        raise _http(e)
    return _plan_read(row)


@router.post("/conversations/{conversation_id}/revise", response_model=ConversationRead)
def revise(conversation_id: int, payload: ReviseRequest, db: Session = Depends(get_db)):
    try:
        conv = request_revision(db, conversation_id, payload.notes.strip())
    except ConversationError as e:
        raise _http(e)
    return _read(db, conv)


@router.post("/conversations/{conversation_id}/cancel", response_model=ConversationRead)
def cancel(conversation_id: int, db: Session = Depends(get_db)):
    try:
        conv = cancel_conversation(db, conversation_id)
    except ConversationError as e:
        raise _http(e)
    return _read(db, conv)
