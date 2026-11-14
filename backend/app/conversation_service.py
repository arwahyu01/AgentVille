"""Conversation workflow: clarification turns, versioned plans, explicit approval.

The anchor Task's status IS the conversation lifecycle state — this module never
duplicates it. Child step tasks are only materialised once the anchor reaches
'approved', so tool execution is structurally gated behind user approval.
"""

from sqlalchemy.orm import Session

from app.models import Agent, Approval, Conversation, Message, Plan, Task
from app.plan_schema import TaskPlan
from app.rooms import room_for_role
from app.settings_store import plan_max_depth, plan_max_steps
from app.task_service import add_event, seat_agent, transition


class ConversationError(Exception):
    def __init__(self, message: str, status_code: int = 409) -> None:
        super().__init__(message)
        self.status_code = status_code


def _coordinator_id(db: Session) -> int | None:
    """Conversation-level work belongs to the Coordinator, so its journal frames — and
    the 3D office — can attribute planning turns to a real seated agent."""
    agent = (db.query(Agent).filter(Agent.role == "AI Coordinator")
             .order_by(Agent.id).first())
    return agent.id if agent else None


def _anchor(db: Session, conv: Conversation) -> Task:
    anchor = db.get(Task, conv.anchor_task_id) if conv.anchor_task_id else None
    if anchor is None:
        raise ConversationError("Conversation anchor task is missing", 500)
    return anchor


# Agents that are in the middle of real work stay at their desk; only the rest are called in.
_BUSY = ("working", "reviewing")
MEETING_SEATS = 8


def _plan_participants(db: Session, plan: TaskPlan) -> list[Agent]:
    """The Coordinator plus the first agent of every role the plan uses, skipping anyone who is
    busy with other work. Derived from the plan alone, so the same list comes back when the
    meeting ends and no participant list has to be stored."""
    by_role: dict[str, Agent] = {}
    for agent in db.query(Agent).order_by(Agent.id).all():
        by_role.setdefault(agent.role, agent)
    roles = ["AI Coordinator"] + [step.agent_role for step in plan.steps]
    seen: list[Agent] = []
    for role in roles:
        agent = by_role.get(role)
        if agent is not None and agent not in seen and agent.status not in _BUSY:
            seen.append(agent)
    return seen[:MEETING_SEATS]


def _plan_of(row: Plan | None) -> TaskPlan | None:
    try:
        return TaskPlan.model_validate_json(row.steps_json) if row is not None else None
    except ValueError:
        return None


def _start_plan_meeting(db: Session, conv: Conversation, anchor: Task, row: Plan, plan: TaskPlan) -> None:
    """While a plan waits for the user's decision, the people it involves gather in the meeting
    room. The journal frame also sets the topic shown on the room's big screen."""
    people = _plan_participants(db, plan)
    if not people:
        return
    names = ", ".join(a.name for a in people)
    topic = (row.summary or anchor.title or "rencana").strip().replace("\n", " ")
    add_event(db, anchor.id, "meeting_started",
              f"Rencana v{row.version}: {topic[:60]} (menunggu persetujuan · peserta: {names})",
              conversation_id=conv.id, to_room="meeting")
    for agent in people:
        seat_agent(db, agent.id, target_room="meeting")
    db.commit()


def _end_plan_meeting(db: Session, conv: Conversation, anchor: Task, row: Plan | None, outcome: str) -> None:
    plan = _plan_of(row)
    if plan is None:
        return
    people = _plan_participants_in_meeting(db, plan)
    if not people:
        return
    add_event(db, anchor.id, "meeting_ended", f"Rapat rencana selesai: {outcome}",
              conversation_id=conv.id, from_room="meeting")
    for agent in people:
        seat_agent(db, agent.id, room=room_for_role(agent.role), target_room="")
        agent.workstation = room_for_role(agent.role)
    db.commit()


def _plan_participants_in_meeting(db: Session, plan: TaskPlan) -> list[Agent]:
    """Same roles as the start, but only those actually called in (target room is the meeting)."""
    by_role: dict[str, Agent] = {}
    for agent in db.query(Agent).order_by(Agent.id).all():
        by_role.setdefault(agent.role, agent)
    out: list[Agent] = []
    for role in ["AI Coordinator"] + [step.agent_role for step in plan.steps]:
        agent = by_role.get(role)
        if agent is not None and agent not in out and agent.target_room == "meeting":
            out.append(agent)
    return out


def get_conversation(db: Session, conversation_id: int) -> Conversation:
    conv = db.get(Conversation, conversation_id)
    if conv is None:
        raise ConversationError("Conversation not found", 404)
    return conv


def create_conversation(db: Session, first_message: str, channel: str = "web",
                        user_identity: str = "local", external_id: str | None = None) -> Conversation:
    first_line = first_message.strip().splitlines()[0] if first_message.strip() else "New request"
    anchor = Task(title=first_line[:160], description=first_message.strip()[:4000],
                  status="pending", priority="normal", run_mode="conversation",
                  agent_id=_coordinator_id(db))
    db.add(anchor)
    db.flush()
    conv = Conversation(channel=channel, user_identity=user_identity,
                        title=first_line[:160], anchor_task_id=anchor.id)
    db.add(conv)
    db.flush()
    anchor.conversation_id = conv.id
    db.add(Message(conversation_id=conv.id, role="user", content=first_message.strip(),
                   channel=channel, external_id=external_id))
    add_event(db, anchor.id, "created", "Conversation started", conversation_id=conv.id)
    transition(db, anchor, "clarifying", "Coordinator started the conversation",
               event_type="conversation_started", conversation_id=conv.id)
    db.refresh(conv)
    return conv


def add_message(db: Session, conversation_id: int, content: str, role: str = "user",
                channel: str | None = None, external_id: str | None = None) -> Message | None:
    """Persist a message. Returns None when external_id was already stored (idempotent ingest)."""
    if external_id is not None:
        dup = (db.query(Message)
               .filter(Message.conversation_id == conversation_id, Message.external_id == external_id)
               .first())
        if dup is not None:
            return None
    conv = get_conversation(db, conversation_id)
    msg = Message(conversation_id=conv.id, role=role, content=content,
                  channel=channel or conv.channel, external_id=external_id)
    db.add(msg)
    db.commit()
    db.refresh(msg)
    return msg


def list_messages(db: Session, conversation_id: int) -> list[Message]:
    get_conversation(db, conversation_id)
    return (db.query(Message).filter(Message.conversation_id == conversation_id)
            .order_by(Message.id).all())


def get_plan_row(db: Session, conversation_id: int, version: int | None = None) -> Plan | None:
    query = db.query(Plan).filter(Plan.conversation_id == conversation_id)
    if version is None:
        query = query.order_by(Plan.version.desc())
    else:
        query = query.filter(Plan.version == version)
    return query.first()


def plan_history(db: Session, conversation_id: int) -> list[Plan]:
    get_conversation(db, conversation_id)
    return (db.query(Plan).filter(Plan.conversation_id == conversation_id)
            .order_by(Plan.version.desc()).all())


def propose_plan(db: Session, conversation_id: int, plan: TaskPlan, summary: str = "") -> Plan:
    """Validate and store a new plan version; supersedes any pending proposal."""
    conv = get_conversation(db, conversation_id)
    plan.validate_for_conversation()
    plan.validate_for_budget(plan_max_steps(db), plan_max_depth(db))
    anchor = _anchor(db, conv)
    if anchor.status == "awaiting_approval":
        _end_plan_meeting(db, conv, anchor, get_plan_row(db, conv.id, conv.current_plan_version), "diganti rencana baru")
        transition(db, anchor, "clarifying", "Previous proposal superseded by a new plan",
                   event_type="plan_superseded", conversation_id=conv.id)
    elif anchor.status != "clarifying":
        raise ConversationError(f"Cannot propose a plan while task is '{anchor.status}'")
    for old in db.query(Plan).filter(Plan.conversation_id == conv.id, Plan.status == "proposed").all():
        old.status = "superseded"
    version = conv.current_plan_version + 1
    conv.current_plan_version = version
    row = Plan(conversation_id=conv.id, version=version, status="proposed",
               summary=summary or plan.summary, steps_json=plan.model_dump_json())
    db.add(row)
    transition(db, anchor, "awaiting_approval",
               f"Plan v{version} proposed ({len(plan.steps)} steps) — waiting for approval",
               event_type="plan_proposed", conversation_id=conv.id)
    db.refresh(row)
    _start_plan_meeting(db, conv, anchor, row, plan)
    return row


def proposal_message(db: Session, conv: Conversation, row: Plan, plan: TaskPlan) -> str:
    """The full proposal as one readable message: scope, who owns each step, execution
    order with dependencies, acceptance criteria and the exact version to approve. This is
    the text stored in the transcript and queued to Telegram; the outbox splits it into
    Telegram-sized chunks in stable order."""
    names: dict[str, str] = {}
    for agent in db.query(Agent).order_by(Agent.id).all():
        names.setdefault(agent.role, agent.name)
    lines = [
        f"Proposal v{row.version} — “{conv.title[:80]}”",
        f"Scope: {row.summary or plan.summary or 'see the steps below'}",
        "",
        f"Plan in execution order ({len(plan.steps)} steps):",
    ]
    for index, step in enumerate(plan.steps):
        owner = step.agent_role + (f" · {names[step.agent_role]}" if step.agent_role in names else "")
        deps = ", ".join(f"#{d}" for d in step.depends_on) if step.depends_on else "nothing — starts right away"
        tools = " · writes files in the workspace" if step.uses_tools else ""
        lines.append(f"{index}. {step.title} — {owner}")
        lines.append(f"   Does: {step.instruction[:300]}")
        lines.append(f"   Depends on: {deps}{tools}")
        for criterion in step.acceptance_criteria:
            lines.append(f"   Accept: {criterion[:200]}")
    if plan.acceptance_criteria:
        lines.extend(["", "Overall acceptance criteria:"])
        lines.extend(f"- {criterion[:200]}" for criterion in plan.acceptance_criteria)
    lines.append("")
    if conv.channel == "telegram":
        lines.append(f"Approve with: /approve {row.version} — or send /revise <notes> for a redraft.")
    else:
        lines.append(f"Approve version {row.version} in the Requests panel, or ask for a revision first.")
    return "\n".join(lines)


def approve_plan(db: Session, conversation_id: int, plan_version: int,
                 decided_by: str = "local") -> Plan:
    conv = get_conversation(db, conversation_id)
    if plan_version != conv.current_plan_version or conv.current_plan_version == 0:
        raise ConversationError(f"Plan v{plan_version} is not the current proposal (v{conv.current_plan_version})")
    row = get_plan_row(db, conv.id, plan_version)
    if row is None:
        raise ConversationError("Plan version not found", 404)
    existing = (db.query(Approval)
                .filter(Approval.plan_id == row.id, Approval.decision == "approved").first())
    anchor = _anchor(db, conv)
    if existing is not None:
        if anchor.status in ("approved", "queued", "running", "reviewing", "completed"):
            return row
        raise ConversationError(f"Approval already recorded but task is '{anchor.status}'", 409)
    if anchor.status != "awaiting_approval":
        raise ConversationError(f"Nothing awaiting approval (task is '{anchor.status}')")
    if row.status != "proposed":
        raise ConversationError(f"Plan v{plan_version} is '{row.status}', not approvable")
    row.status = "approved"
    db.add(Approval(plan_id=row.id, conversation_id=conv.id, decision="approved", decided_by=decided_by))
    transition(db, anchor, "approved", f"Plan v{plan_version} approved by {decided_by}",
               event_type="plan_approved", conversation_id=conv.id)
    _end_plan_meeting(db, conv, anchor, row, f"v{plan_version} disetujui")
    db.refresh(row)
    return row


def request_revision(db: Session, conversation_id: int, notes: str,
                     decided_by: str = "local") -> Conversation:
    conv = get_conversation(db, conversation_id)
    anchor = _anchor(db, conv)
    if anchor.status != "awaiting_approval":
        raise ConversationError(f"Cannot request a revision while task is '{anchor.status}'")
    row = get_plan_row(db, conv.id, conv.current_plan_version)
    if row is not None:
        db.add(Approval(plan_id=row.id, conversation_id=conv.id, decision="revision",
                        decided_by=decided_by, reason=notes[:2000]))
    db.add(Message(conversation_id=conv.id, role="user", content=notes, channel=conv.channel))
    transition(db, anchor, "clarifying", "Revision requested; Coordinator will redraft",
               event_type="revision_requested", conversation_id=conv.id)
    _end_plan_meeting(db, conv, anchor, row, "revisi diminta")
    db.refresh(conv)
    return conv


def cancel_conversation(db: Session, conversation_id: int) -> Conversation:
    conv = get_conversation(db, conversation_id)
    anchor = _anchor(db, conv)
    if anchor.status in ("completed", "failed", "cancelled"):
        raise ConversationError(f"Conversation already finished ({anchor.status})")
    pending = db.query(Plan).filter(Plan.conversation_id == conv.id, Plan.status == "proposed").all()
    for row in pending:
        row.status = "cancelled"
    transition(db, anchor, "cancelled", "Conversation cancelled",
               event_type="conversation_cancelled", conversation_id=conv.id)
    if pending:
        _end_plan_meeting(db, conv, anchor, pending[-1], "dibatalkan")
    db.refresh(conv)
    return conv
