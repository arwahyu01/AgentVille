"""Claude Code sessions as office characters.

Claude Code can POST each hook event to an HTTP endpoint (hook `type: "http"`). AgentVille turns
those events into a coarse status per session (idle / working / waiting / completed / failed /
ended) plus one short, human line of what the session is doing — the same honesty rule as the
rest of the office: nothing is drawn that a real event did not report.

Privacy: hook payloads can carry whole files (Write), full shell commands and full prompts.
Only redacted one-line summaries are stored; raw payloads are never persisted.
"""
from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from app.agent_actions import _base, redact, summarize_tool
from app.models import ClaudeEvent, ClaudeSession

KEEP_EVENTS = 40
STALE_AFTER = timedelta(minutes=15)
FORGET_AFTER = timedelta(hours=12)


def _event_line(event: str, payload: dict) -> tuple[str | None, str]:
    """Map one hook event to (new status or None to keep, summary or '' to skip journaling)."""
    if event == "SessionStart":
        return "idle", "Sesi dimulai" if payload.get("source") != "resume" else "Sesi dilanjutkan"
    if event == "UserPromptSubmit":
        return "working", redact(f"Tugas: {payload.get('prompt') or ''}", 90)
    if event == "PreToolUse":
        return "working", summarize_tool(payload.get("tool_name", ""), payload.get("tool_input"))
    if event == "PostToolUse":
        return "working", ""
    if event == "PermissionRequest":
        return "waiting", redact("Minta izin: " + summarize_tool(payload.get("tool_name", ""), payload.get("tool_input")))
    if event == "Notification":
        kind = payload.get("notification_type")
        message = redact(payload.get("message") or "")
        if kind == "permission_prompt":
            return "waiting", message or "Menunggu izin"
        if kind in ("idle_prompt", "elicitation_dialog"):
            return "waiting", message or "Menunggu balasan"
        return None, message
    if event == "SubagentStart":
        return "working", redact(f"Subagen mulai: {payload.get('agent_type') or ''}")
    if event == "Stop":
        last = redact(payload.get("last_assistant_message") or "", 90)
        return "completed", f"Selesai: {last}" if last else "Giliran selesai"
    if event == "StopFailure":
        return "failed", redact(f"Gagal: {payload.get('error') or payload.get('reason') or ''}")
    if event == "SessionEnd":
        return "ended", "Sesi ditutup"
    return None, ""


def apply_hook(db: Session, payload: dict, now: datetime | None = None) -> ClaudeSession | None:
    """Record one hook event. Returns the session row, or None when the payload is unusable."""
    session_id = str(payload.get("session_id") or "").strip()[:80]
    event = str(payload.get("hook_event_name") or "").strip()
    if not session_id or not event:
        return None
    now = now or datetime.now(timezone.utc)
    row = db.get(ClaudeSession, session_id)
    cwd = str(payload.get("cwd") or "")[:400]
    if row is None:
        row = ClaudeSession(session_id=session_id, cwd=cwd, project=redact(_base(cwd), 60) or "claude",
                            status="idle", activity="", permission_mode="", tool_count=0,
                            started_at=now, updated_at=now)
        db.add(row)
    elif cwd and not row.cwd:
        row.cwd, row.project = cwd, redact(_base(cwd), 60)
    status, summary = _event_line(event, payload)
    if event == "PostToolUse" and row.status != "waiting":
        status = None  # a finished tool call keeps the line of the call that started it
    if status:
        row.status = status
    if status == "ended":
        row.ended_at = now
    elif row.ended_at is not None and event in ("SessionStart", "UserPromptSubmit"):
        row.ended_at = None
    if event == "PreToolUse":
        row.tool_count += 1
    if payload.get("permission_mode"):
        row.permission_mode = str(payload["permission_mode"])[:24]
    if summary:
        row.activity = summary
        db.add(ClaudeEvent(session_id=session_id, event=event[:40], summary=summary, created_at=now))
    row.updated_at = now
    db.flush()
    _trim(db, session_id)
    return row


def _trim(db: Session, session_id: str) -> None:
    ids = [i for (i,) in db.query(ClaudeEvent.id).filter(ClaudeEvent.session_id == session_id)
           .order_by(ClaudeEvent.id.desc()).offset(KEEP_EVENTS).all()]
    if ids:
        db.query(ClaudeEvent).filter(ClaudeEvent.id.in_(ids)).delete(synchronize_session=False)


def _aware(stamp: datetime) -> datetime:
    return stamp if stamp.tzinfo else stamp.replace(tzinfo=timezone.utc)


def visible_sessions(db: Session, now: datetime | None = None, recent: int = 8) -> list[dict]:
    """Sessions worth drawing: not ended and heard from recently. A working/waiting session that
    went quiet is shown as idle rather than claiming work nobody reported."""
    now = now or datetime.now(timezone.utc)
    rows = (db.query(ClaudeSession).filter(ClaudeSession.ended_at.is_(None))
            .order_by(ClaudeSession.started_at).all())
    out = []
    for row in rows:
        age = now - _aware(row.updated_at)
        if age > FORGET_AFTER:
            continue
        status = row.status
        if status in ("working", "waiting") and age > STALE_AFTER:
            status = "idle"
        events = (db.query(ClaudeEvent).filter(ClaudeEvent.session_id == row.session_id)
                  .order_by(ClaudeEvent.id.desc()).limit(recent).all())
        out.append({
            "session_id": row.session_id,
            "project": row.project,
            "cwd": row.cwd,
            "status": status,
            "activity": row.activity,
            "permission_mode": row.permission_mode,
            "tool_count": row.tool_count,
            "started_at": _aware(row.started_at).isoformat(),
            "updated_at": _aware(row.updated_at).isoformat(),
            "events": [{"event": e.event, "summary": e.summary, "created_at": _aware(e.created_at).isoformat()}
                       for e in events],
        })
    return out
