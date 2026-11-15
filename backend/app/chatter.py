"""Realistic agent chatter, optional and budget-aware.

The pipeline writes honest, templated journal lines (`say()`). This module can rewrite a
line with the configured text model so the team feed reads like people talking. It is off
by default, and it never blocks the orchestrator: the static line is stored immediately and
the model's version replaces it in place when it arrives.

Modes:
  static     — no model call at all (0 tokens)
  milestone  — only the moments a human would actually speak up (handoff, escalation, QC)
  full       — every spoken line is rewritten

The model is asked to preserve the facts of the static line, so a failed or weird response
simply leaves the honest template in place.
"""

from __future__ import annotations

import logging
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, replace

from app import settings_store
from app.ai import registry
from app.ai.base import AIProvider
from app.ai.personas import persona_for_role
from app.database import SessionLocal
from app.models import Agent, Task, TaskEvent

logger = logging.getLogger(__name__)

MODE_STATIC = "static"
MODE_MILESTONE = "milestone"
MODE_FULL = "full"
MODES = (MODE_STATIC, MODE_MILESTONE, MODE_FULL)

# Events where someone is genuinely speaking. `full` rewrites all of them; `milestone` only
# the ones that change the course of the work.
_SPOKEN = {
    "agent_chat", "needs_help", "reassigned",
    "handoff_requested", "handoff_accepted", "meeting_started", "meeting_ended",
}
_MILESTONES = {
    "needs_help", "reassigned", "handoff_requested", "handoff_accepted",
    "meeting_started", "meeting_ended",
}

_MAX_PENDING = 6
_EXECUTOR = ThreadPoolExecutor(max_workers=2, thread_name_prefix="agent-chatter")
_PENDING_LOCK = threading.Lock()
_PENDING = 0


@dataclass(frozen=True)
class Line:
    event_id: int
    speaker: str
    role: str
    recipient: str | None
    event_type: str
    static_message: str
    task_title: str


def should_narrate(mode: str, event_type: str) -> bool:
    if mode == MODE_FULL:
        return event_type in _SPOKEN
    if mode == MODE_MILESTONE:
        return event_type in _MILESTONES
    return False


def maybe_schedule(db, event: TaskEvent) -> None:
    """Called right after a spoken line is added. Cheap no-op unless real chatter is on."""
    try:
        if not settings_store.ai_enabled(db):
            return
        mode = settings_store.agent_chat_mode(db)
        if not should_narrate(mode, event.event_type):
            return
        db.flush()
        speaker = db.get(Agent, event.actor_agent_id or event.agent_id)
        recipient = db.get(Agent, event.recipient_agent_id) if event.recipient_agent_id else None
        task = db.get(Task, event.task_id)
        ctx = Line(
            event_id=event.id,
            speaker=speaker.name if speaker else "Anggota tim",
            role=speaker.role if speaker else "AI Coordinator",
            recipient=recipient.name if recipient else None,
            event_type=event.event_type,
            static_message=event.message,
            task_title=task.title if task else "",
        )
    except Exception:  # never let narration break the real work
        logger.exception("agent chatter could not be scheduled")
        return
    _submit(ctx)


def _submit(ctx: Line) -> None:
    global _PENDING
    with _PENDING_LOCK:
        if _PENDING >= _MAX_PENDING:
            # Under load, honest templates are better than a growing backlog of model calls.
            return
        _PENDING += 1
    _EXECUTOR.submit(_job, ctx)


def _job(ctx: Line) -> None:
    global _PENDING
    try:
        narrate(ctx)
    except Exception:
        logger.exception("agent chatter failed")
    finally:
        with _PENDING_LOCK:
            _PENDING -= 1


def _prompt(ctx: Line) -> str:
    recipient = ctx.recipient or "tim"
    return (
        "Konteks kantor (hanya ini yang boleh kamu pakai; jangan mengarang detail lain):\n"
        f"- Pekerjaan: {ctx.task_title or 'pekerjaan kantor'}\n"
        f"- Pembicara: {ctx.speaker} ({ctx.role})\n"
        f"- Penerima: {recipient}\n"
        f"- Jenis peristiwa: {ctx.event_type}\n"
        f"- Fakta yang harus disampaikan: {ctx.static_message}\n\n"
        "Tulis ulang fakta itu sebagai satu kalimat lisan spontan dalam Bahasa Indonesia, "
        "gaya rekan kerja yang saling bicara. Maksimal 160 karakter. Pertahankan semua fakta "
        "penting (angka, langkah, penyebab, nama). Jangan menambah file, hasil, atau status "
        "yang tidak ada. Tanpa markdown, tanpa tanda kutip, tanpa emoji. Balas hanya kalimatnya."
    )


def _clean(text: str) -> str:
    line = " ".join((text or "").strip().split())
    line = line.strip('"').strip("'").strip()
    line = re.sub(r"^(jawaban|kalimat|output)\s*:\s*", "", line, flags=re.IGNORECASE)
    if not line or len(line) > 300:
        return ""
    return line


def narrate(ctx: Line, session_factory=None, provider: AIProvider | None = None) -> str | None:
    """Rewrite one stored line. Returns the new text, or None when nothing changed."""
    make_session = session_factory or SessionLocal
    with make_session() as db:
        # The caller may still be committing when the worker starts; wait for the row.
        event = None
        for _ in range(6):
            event = db.get(TaskEvent, ctx.event_id)
            if event is not None:
                break
            db.rollback()
            time.sleep(0.15)
        if event is None:
            return None
        if not settings_store.ai_enabled(db):
            return None
        if not should_narrate(settings_store.agent_chat_mode(db), ctx.event_type):
            return None
        provider_name = settings_store.ai_provider(db)
        model = settings_store.ai_model_for(db, provider_name)
        engine = provider or registry.make_provider(provider_name)
        persona = replace(persona_for_role(ctx.role, ctx.speaker, "text"), model=model)
        result = engine.run(persona, _prompt(ctx), timeout_s=min(30, settings_store.ai_timeout_s(db)))
        text = _clean(result.text) if result.ok else ""
        if not text:
            return None
        event.message = text
        event.provider = result.provider or provider_name
        event.model = result.model or model
        db.commit()
        return text
