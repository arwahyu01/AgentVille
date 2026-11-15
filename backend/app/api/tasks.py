from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app import settings_store
from app.database import get_db
from app.models import Agent, Conversation, Plan, Task
from app.schemas import (ClearTasksResult, ExecuteRequest, QcReviewRead, ReassignRequest, TaskCreate,
                         TaskRead, TaskUpdate, TaskEventRead, TaskResultRead)
from app.task_service import (ACTIVE_STATUSES, ALLOWED_TRANSITIONS, CONVERSATION_STATES, add_event,
                              cancel_tree, clear_active_tasks, say, seat_agent, transition,
                              TransitionError)

router = APIRouter(tags=["tasks"])

@router.get("/tasks", response_model=list[TaskRead])
def list_tasks(db: Session = Depends(get_db)):
    return db.query(Task).order_by(Task.updated_at.desc(), Task.id.desc()).all()

@router.post("/tasks", response_model=TaskRead, status_code=201)
def create_task(payload: TaskCreate, db: Session = Depends(get_db)):
    if payload.agent_id is not None and db.get(Agent, payload.agent_id) is None:
        raise HTTPException(status_code=404, detail="Agent not found")
    title = payload.title.strip()
    if not title:
        raise HTTPException(status_code=422, detail="Title cannot be blank")
    task = Task(title=title, description=payload.description.strip(), priority=payload.priority, agent_id=payload.agent_id)
    db.add(task)
    db.flush()
    add_event(db, task.id, "created", "Task created")
    db.commit()
    db.refresh(task)
    return task

@router.get("/tasks/{task_id}", response_model=TaskRead)
def get_task(task_id: int, db: Session = Depends(get_db)):
    task = db.get(Task, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")
    return task

@router.get("/tasks/{task_id}/result", response_model=TaskResultRead)
def get_task_result(task_id: int, db: Session = Depends(get_db)):
    task = db.get(Task, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")
    children = db.query(Task).filter(Task.parent_id == task_id).order_by(Task.id).all()
    from app.models import QcReview
    from app.task_service import ARTIFACTS_DIR
    plan_steps = []
    if task.plan_json:
        import json
        try:
            parsed = json.loads(task.plan_json)
            plan_steps = parsed.get("steps", []) if isinstance(parsed, dict) else []
        except ValueError:
            plan_steps = []
    diff_file = ARTIFACTS_DIR / f"task-{task_id}.diff.txt"
    from app.api.preview import build_preview
    return TaskResultRead(
        id=task.id, title=task.title, status=task.status, run_mode=task.run_mode,
        result=task.result, artifact_path=task.artifact_path,
        children=[TaskRead.model_validate(child) for child in children],
        plan_steps=plan_steps,
        qc_reviews=[QcReviewRead.model_validate(r) for r in
                    db.query(QcReview).filter(QcReview.task_id == task_id).order_by(QcReview.iteration).all()],
        diff_path=str(diff_file.relative_to(ARTIFACTS_DIR.parents[1])) if diff_file.exists() else "",
        preview=build_preview(task, db),
    )

@router.post("/tasks/{task_id}/execute", response_model=TaskRead)
def execute_task(task_id: int, payload: ExecuteRequest, db: Session = Depends(get_db)):
    """Hand a task to the AI orchestrator: validate here, enqueue, let the worker thread execute."""
    if not settings_store.ai_enabled(db):
        raise HTTPException(status_code=409, detail="AI engine is disabled. Enable it in AI settings first.")
    task = db.get(Task, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")
    if task.parent_id is not None:
        raise HTTPException(status_code=422, detail="Subtasks are scheduled by the planner, not executed directly")
    if task.run_mode == "conversation":
        raise HTTPException(status_code=422, detail="Conversation tasks are driven through the approval flow, not /execute")
    if task.status not in ("pending", "failed"):
        raise HTTPException(status_code=409, detail=f"Task cannot start from status {task.status}")
    task.run_mode = "ai_plan" if payload.mode == "plan" else "ai"
    try:
        task = transition(db, task, "queued", f"Execution requested (mode: {payload.mode})", "execution_requested")
    except TransitionError as e:
        raise HTTPException(status_code=409, detail=str(e))
    return task

@router.post("/tasks/{task_id}/qc-rerun", response_model=TaskRead)
def rerun_qc(task_id: int, db: Session = Depends(get_db)):
    """Queue a QC-only rerun for a failed conversation anchor.

    This never revises a step and never edits the workspace: it asks for a fresh,
    evidence-backed review of the work that already exists.
    """
    if not settings_store.ai_enabled(db):
        raise HTTPException(status_code=409, detail="AI engine is disabled. Enable it in AI settings first.")
    task = db.get(Task, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")
    if task.parent_id is not None:
        raise HTTPException(status_code=422, detail="Subtasks are reviewed with their parent, not directly")
    if task.run_mode != "conversation":
        raise HTTPException(status_code=422, detail="QC rerun is only available for conversation tasks")
    if task.status != "failed":
        raise HTTPException(status_code=409, detail=f"QC rerun is only available for a failed task, not {task.status}")
    conv = db.get(Conversation, task.conversation_id) if task.conversation_id else None
    if conv is None:
        raise HTTPException(status_code=422, detail="Conversation is missing for this task")
    plan_row = (db.query(Plan)
                .filter(Plan.conversation_id == conv.id,
                        Plan.version == conv.current_plan_version).first())
    if plan_row is None or plan_row.status != "approved":
        raise HTTPException(status_code=409, detail="No approved plan version to review")
    task.qc_rerun_requested = True
    try:
        task = transition(db, task, "queued", "QC-only rerun requested", "qc_rerun_requested")
    except TransitionError as e:
        db.rollback()
        raise HTTPException(status_code=409, detail=str(e))
    return task

@router.patch("/tasks/{task_id}", response_model=TaskRead)
def update_task(task_id: int, payload: TaskUpdate, db: Session = Depends(get_db)):
    task = db.get(Task, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")
    changes = payload.model_dump(exclude_unset=True)
    new_status = changes.get("status")
    status_changed = False
    if new_status is not None and new_status != task.status:
        if new_status not in ALLOWED_TRANSITIONS.get(task.status, set()):
            raise HTTPException(status_code=409, detail=f"Invalid status transition: {task.status} -> {new_status}")
        if new_status in CONVERSATION_STATES and task.run_mode != "conversation":
            raise HTTPException(status_code=409, detail=f"Status '{new_status}' is only valid for conversation tasks")
        status_changed = True
    if "agent_id" in changes and changes["agent_id"] is not None and db.get(Agent, changes["agent_id"]) is None:
        raise HTTPException(status_code=404, detail="Agent not found")
    old_status = task.status
    for key, value in changes.items():
        if key == "title" and value is not None:
            value = value.strip()
            if not value:
                raise HTTPException(status_code=422, detail="Title cannot be blank")
        setattr(task, key, value)
    task.updated_at = datetime.now(timezone.utc)
    if status_changed:
        add_event(db, task.id, "status_changed", f"Status changed: {old_status} -> {new_status}")
    else:
        add_event(db, task.id, "updated", "Task updated: " + ", ".join(changes.keys()))
    db.commit()
    db.refresh(task)
    return task

@router.post("/tasks/{task_id}/cancel", response_model=TaskRead)
def cancel_task(task_id: int, db: Session = Depends(get_db)):
    task = db.get(Task, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")
    try:
        task = transition(db, task, "cancelled", "Task cancelled by user", "cancelled")
    except TransitionError:
        raise HTTPException(status_code=409, detail=f"Task cannot be cancelled from status {task.status}")
    return task


@router.post("/tasks/{task_id}/stop", response_model=TaskRead)
def stop_task(task_id: int, db: Session = Depends(get_db)):
    """Stop one running request together with every step it spawned; history is kept."""
    task = db.get(Task, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")
    if task.status not in ACTIVE_STATUSES:
        raise HTTPException(status_code=409, detail=f"Task is not running (status {task.status})")
    try:
        task = cancel_tree(db, task, "Stopped from the console")
    except TransitionError as e:
        raise HTTPException(status_code=409, detail=str(e))
    return db.get(Task, task_id)


@router.post("/tasks/clear", response_model=ClearTasksResult)
def clear_tasks(db: Session = Depends(get_db)):
    """"Clear all tasks" = stop everything in flight. Completed/failed/cancelled history stays."""
    return ClearTasksResult(**clear_active_tasks(db))


@router.post("/tasks/{task_id}/reassign", response_model=TaskRead)
def reassign_task(task_id: int, payload: ReassignRequest, db: Session = Depends(get_db)):
    """Leader hand-over: give a step task to another employee and let it retry immediately.

    The instruction is recorded as an agent_chat frame addressed to the new owner, so the team
    feed shows the rescue exactly as it happened (who was told, why, by whom)."""
    task = db.get(Task, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")
    agent = db.get(Agent, payload.agent_id)
    if agent is None:
        raise HTTPException(status_code=404, detail="Agent not found")
    leader = db.query(Agent).filter(Agent.role == "AI Coordinator").order_by(Agent.id).first()
    previous = db.get(Agent, task.agent_id) if task.agent_id else None
    task.agent_id = agent.id
    task.updated_at = datetime.now(timezone.utc)
    if task.status in ("pending", "queued"):
        task.status = "queued"
    elif task.status in ("failed", "cancelled"):
        task.status = "queued"
    note = payload.note.strip() or "pekerjaan ini dialihkan karena pemegang sebelumnya tidak selesai"
    say(db, task.id, leader,
        f"{agent.name}, ambil alih \"{task.title[:120]}\" dari "
        f"{previous.name if previous else 'pemegang sebelumnya'}. Alasan: {note}. "
        "Kerjakan sampai tuntas dan laporkan hasilnya.",
        recipient=agent, conversation_id=task.conversation_id,
        step_index=task.plan_step_index)
    add_event(db, task.id, "reassigned",
              f"{task.title[:120]} dialihkan ke {agent.name} ({agent.role})",
              conversation_id=task.conversation_id, agent_id=agent.id,
              step_index=task.plan_step_index, actor_agent_id=leader.id if leader else None,
              recipient_agent_id=agent.id)
    room = agent.current_room or ""
    if room:
        seat_agent(db, agent.id, room=room, step_index=task.plan_step_index)
    db.commit()
    db.refresh(task)
    return task

@router.get("/tasks/{task_id}/events", response_model=list[TaskEventRead])
def list_task_events(task_id: int, db: Session = Depends(get_db)):
    if db.get(Task, task_id) is None:
        raise HTTPException(status_code=404, detail="Task not found")
    from app.models import TaskEvent
    return db.query(TaskEvent).filter(TaskEvent.task_id == task_id).order_by(TaskEvent.id.asc()).all()
