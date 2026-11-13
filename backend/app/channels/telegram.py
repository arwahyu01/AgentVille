"""Telegram as a full working channel: long-polling getUpdates, chat-allowlist,
update-id dedupe, a durable outbound queue (app.channels.outbox), commands for the
approval workflow, and bidirectional Coordinator conversation — replies go back to the
originating chat and are stored in the same conversation transcript. The bot token never
leaves the backend env.

Commands (all idempotent via update-id dedupe and outbox dedupe keys):
  /approve <plan_version>  approve the exact proposed plan version
  /revise <notes>          send the current proposal back to the Coordinator for redraft
  /cancel                  cancel the active request
  /status                  show lifecycle state, plan version and steps
  /help, /start            list commands

If TELEGRAM_BOT_TOKEN / TELEGRAM_ALLOWED_CHAT_IDS are unset the poller is never started and
/api/channels/status reports the reason — the rest of the app keeps working over the web API."""

import json
import logging
import os
import threading
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

import httpx
from dotenv import load_dotenv
from sqlalchemy.exc import IntegrityError

from app.channels import outbox
from app.channels.base import ChannelEvent
from app.channels.normalizer import ingest_message
from app.database import SessionLocal
from app.models import Conversation, Plan, TelegramOutbox, TelegramUpdate, Task

logger = logging.getLogger("agentville.telegram")

MAX_INBOUND_CHARS = 4000
MAX_OUTBOUND_CHARS = 4096
MILESTONE_STATUSES = {"awaiting_approval", "completed", "failed", "cancelled"}
BACKEND_ENV = Path(__file__).resolve().parents[2] / ".env"

HELP_TEXT = (
    "AgentVille commands:\n"
    "/status — current request state and plan\n"
    "/approve <version> — approve a proposed plan (approval always names the version)\n"
    "/revise <notes> — send the plan back for a redraft\n"
    "/cancel — cancel the active request\n"
    "Any other message goes to the Coordinator while it is asking questions."
)


@dataclass(frozen=True)
class TelegramSettings:
    token: str
    allowed_chats: frozenset[str] = field(default_factory=frozenset)


def load_settings(env: dict[str, str] | None = None) -> tuple[TelegramSettings | None, str]:
    if env is None:
        load_dotenv(BACKEND_ENV)
        env = dict(os.environ)
    token = (env.get("TELEGRAM_BOT_TOKEN") or "").strip()
    chats = frozenset(c.strip() for c in (env.get("TELEGRAM_ALLOWED_CHAT_IDS") or "").split(",") if c.strip())
    if not token:
        return None, "TELEGRAM_BOT_TOKEN is not set in backend/.env"
    if not chats:
        return None, "TELEGRAM_ALLOWED_CHAT_IDS is not set in backend/.env"
    return TelegramSettings(token=token, allowed_chats=chats), ""


class TelegramPoller(threading.Thread):
    """Long-polls the Bot API on a daemon thread and flushes the durable outbox on a
    companion thread. The http client is injectable so tests run against
    httpx.MockTransport with zero network access."""

    def __init__(self, settings: TelegramSettings, session_factory=None, http: httpx.Client | None = None,
                 poll_timeout_s: int = 25) -> None:
        super().__init__(daemon=True, name="agentville-telegram")
        self.settings = settings
        self.session_factory = session_factory or SessionLocal
        self._http = http or httpx.Client(base_url=f"https://api.telegram.org/bot{settings.token}", timeout=httpx.Timeout(poll_timeout_s + 10, connect=10))
        self._http_lock = threading.Lock()
        self.poll_timeout_s = poll_timeout_s
        self._stop_event = threading.Event()
        self._offset = 0
        self._last_statuses: dict[int, str] = {}
        self.started = False

    def stop(self) -> None:
        self._stop_event.set()

    def run(self) -> None:
        self.started = True
        self._offset = self._resume_offset()
        flusher = threading.Thread(target=self._flush_loop, daemon=True, name="agentville-telegram-outbox")
        flusher.start()
        while not self._stop_event.is_set():
            try:
                self.poll_once()
                self.check_milestones()
            except Exception as e:
                logger.warning("telegram poll failed: %s", e)
                self._stop_event.wait(5.0)
            else:
                self._stop_event.wait(0.1)

    def _flush_loop(self) -> None:
        while not self._stop_event.is_set():
            try:
                self.flush_outbox()
            except Exception as e:
                logger.warning("telegram outbox flush failed: %s", e)
            self._stop_event.wait(2.0)

    def _resume_offset(self) -> int:
        with self.session_factory() as db:
            from sqlalchemy import func
            last = db.query(func.max(TelegramUpdate.update_id)).scalar()
        return (last + 1) if last else 0

    # -- HTTP primitives (shared with the flusher thread) ----------------------

    def _call(self, method: str, payload: dict) -> tuple[bool, int | None, str]:
        """POST a Bot API method; returns (ok, result message id, error)."""
        try:
            with self._http_lock:
                response = self._http.post(method, json=payload)
            body = response.json()
        except (httpx.HTTPError, ValueError) as e:
            return False, None, str(e)[:300]
        if response.status_code >= 400 or not body.get("ok", False):
            return False, None, str(body)[:300]
        message_id = (body.get("result") or {}).get("message_id")
        return True, message_id, ""

    def send_message(self, chat_id: str, text: str) -> None:
        self._call("/sendMessage", {"chat_id": chat_id, "text": text[:MAX_OUTBOUND_CHARS]})

    # -- inbound ---------------------------------------------------------------

    def poll_once(self) -> None:
        with self._http_lock:
            response = self._http.get("/getUpdates",
                                      params={"offset": self._offset, "timeout": self.poll_timeout_s})
        response.raise_for_status()
        payload = response.json()
        if not payload.get("ok", False):
            raise RuntimeError(f"getUpdates error: {str(payload)[:200]}")
        for update in payload.get("result", []):
            self.handle_update(update)
            self._offset = max(self._offset, int(update.get("update_id", 0)) + 1)

    def handle_update(self, update: dict) -> None:
        update_id = int(update.get("update_id", 0))
        message = update.get("message") or {}
        chat_id = str((message.get("chat") or {}).get("id", ""))
        text = (message.get("text") or "").strip()
        with self.session_factory() as db:
            if db.query(TelegramUpdate).filter(TelegramUpdate.update_id == update_id).first():
                return
            try:
                db.add(TelegramUpdate(update_id=update_id, chat_id=chat_id))
                db.commit()
            except IntegrityError:
                db.rollback()
                return
        if not chat_id or not text:
            return
        if chat_id not in self.settings.allowed_chats:
            self.send_message(chat_id, "Sorry, this AgentVille bot is not authorized for this chat.")
            return
        if len(text) > MAX_INBOUND_CHARS:
            self.send_message(chat_id, f"Message too long ({len(text)} chars; limit {MAX_INBOUND_CHARS}).")
            return
        if text.startswith("/"):
            self.handle_command(chat_id, text, update_id)
            return
        event = ChannelEvent(channel="telegram", external_id=str(update_id),
                             identity=f"telegram:{chat_id}", text=text[:MAX_INBOUND_CHARS])
        with self.session_factory() as db:
            conv = ingest_message(db, event)
            self._ack_non_clarifying(db, conv, update_id)

    def _active_conversation(self, db, chat_id: str) -> Conversation | None:
        """Newest non-terminal Telegram conversation for this chat (same rule as the normalizer)."""
        identity = f"telegram:{chat_id}"
        for conv in (db.query(Conversation)
                     .filter(Conversation.channel == "telegram", Conversation.user_identity == identity)
                     .order_by(Conversation.id.desc()).all()):
            anchor = db.get(Task, conv.anchor_task_id) if conv.anchor_task_id else None
            if anchor is None or anchor.status in ("completed", "failed", "cancelled"):
                continue
            return conv
        return None

    def _ack_non_clarifying(self, db, conv: Conversation, update_id: int) -> None:
        """Plain text is never stored-and-ignored: outside 'clarifying' the user gets an
        explicit direction instead of silence, keyed to the stored message for idempotency."""
        anchor = db.get(Task, conv.anchor_task_id) if conv.anchor_task_id else None
        if anchor is None:
            return
        from app.models import Message
        msg = (db.query(Message).filter(Message.conversation_id == conv.id,
                                        Message.external_id == str(update_id)).first())
        if msg is None:
            return
        version = conv.current_plan_version
        if anchor.status == "awaiting_approval":
            outbox.enqueue(db, conv.id,
                           f"I saved your note, but plan v{version} is awaiting your decision. "
                           f"Reply /approve {version} to run exactly that version, "
                           "/revise <notes> to have the Coordinator redraft, or /status to review it. "
                           "Your note is used after /revise.",
                           f"approval-hint-{msg.id}")
        elif anchor.status in ("approved", "queued", "running", "reviewing"):
            outbox.enqueue(db, conv.id,
                           f"Work is underway ({anchor.status}) — /status for progress. "
                           "/cancel stops it.",
                           f"running-hint-{msg.id}")

    # -- commands ---------------------------------------------------------------

    def handle_command(self, chat_id: str, text: str, update_id: int) -> None:
        name, _, arg = text[1:].partition(" ")
        name = name.split("@", 1)[0].lower()
        arg = arg.strip()
        dedupe = f"cmd-{update_id}"
        with self.session_factory() as db:
            conv = self._active_conversation(db, chat_id)
            if name in ("start", "help"):
                reply = HELP_TEXT
            elif name == "status":
                reply = self._status_text(db, conv)
            elif conv is None:
                reply = "There is no active request on this bot. Send a message describing the work first."
            elif name == "approve":
                reply = self._cmd_approve(db, conv, arg, chat_id)
            elif name == "revise":
                reply = self._cmd_revise(db, conv, arg, chat_id)
            elif name == "cancel":
                reply = self._cmd_cancel(db, conv, chat_id)
            else:
                reply = f"Unknown command /{name}.\n{HELP_TEXT}"
            if conv is not None:
                outbox.enqueue(db, conv.id, reply, dedupe)
            else:
                outbox.enqueue_chat(db, chat_id, reply, dedupe)

    def _cmd_approve(self, db, conv: Conversation, arg: str, chat_id: str) -> str:
        from app.conversation_service import ConversationError, approve_plan
        if not arg.isdigit():
            return (f"Approval must name the plan version, e.g. /approve {conv.current_plan_version} "
                    f"(current proposal). Use /status to review it first.")
        try:
            row = approve_plan(db, conv.id, int(arg), decided_by=f"telegram:{chat_id}")
        except ConversationError as e:
            return f"Could not approve: {e}\nUse /status to see the current state."
        return (f"Plan v{row.version} approved — execution started. "
                "I will report progress and the final result here.")

    def _cmd_revise(self, db, conv: Conversation, arg: str, chat_id: str) -> str:
        from app.conversation_service import ConversationError, request_revision
        if not arg:
            return "Tell me what to change, e.g. /revise use SQLite instead of Postgres"
        try:
            request_revision(db, conv.id, arg, decided_by=f"telegram:{chat_id}")
        except ConversationError as e:
            return f"Could not request a revision: {e}"
        return "Revision noted — the Coordinator will redraft and send a new proposal here."

    def _cmd_cancel(self, db, conv: Conversation, chat_id: str) -> str:
        from app.conversation_service import ConversationError, cancel_conversation
        try:
            cancel_conversation(db, conv.id)
        except ConversationError as e:
            return f"Could not cancel: {e}"
        return "Request cancelled. Send a new message whenever you want to start over."

    def _status_text(self, db, conv: Conversation | None) -> str:
        if conv is None:
            return "No active request on this bot — send a message to start one."
        anchor = db.get(Task, conv.anchor_task_id) if conv.anchor_task_id else None
        lines = [f"Request: “{conv.title[:80]}”",
                 f"Status: {anchor.status if anchor else 'unknown'} (plan v{conv.current_plan_version})"]
        row = (db.query(Plan).filter(Plan.conversation_id == conv.id,
                                     Plan.version == conv.current_plan_version).first()
               if conv.current_plan_version else None)
        if row is not None:
            if row.summary:
                lines.append(f"Summary: {row.summary[:200]}")
            try:
                steps = json.loads(row.steps_json or "{}").get("steps", [])
            except (json.JSONDecodeError, AttributeError):
                steps = []
            for index, step in enumerate(steps):
                tools = " · writes files" if step.get("uses_tools") else ""
                lines.append(f"  {index}. [{step.get('agent_role', '?')}] {step.get('title', '')}{tools}")
            if anchor is not None and anchor.status == "awaiting_approval":
                lines.append(f"Approve with: /approve {conv.current_plan_version}")
        return "\n".join(lines)

    # -- outbound queue -----------------------------------------------------------

    def flush_outbox(self, limit: int = 10) -> int:
        """Deliver pending outbox rows; retry with attempt cap, record message ids."""
        with self.session_factory() as db:
            rows = outbox.due_rows(db, limit=limit)
            work = [(row.id, row.chat_id, row.text) for row in rows]
        delivered = 0
        for row_id, chat_id, text in work:
            ok, message_id, error = self._call("/sendMessage",
                                               {"chat_id": chat_id, "text": text[:MAX_OUTBOUND_CHARS]})
            with self.session_factory() as db:
                row = db.get(TelegramOutbox, row_id)
                if row is None:
                    continue
                if ok:
                    row.status = "sent"
                    row.telegram_message_id = message_id
                    row.sent_at = datetime.now(timezone.utc)
                else:
                    row.attempts += 1
                    row.last_error = error[:500]
                    if row.attempts >= outbox.MAX_ATTEMPTS:
                        row.status = "failed"
                delivered += 1 if ok else 0
                db.commit()
        return delivered

    # -- milestone notifications -----------------------------------------------------

    def check_milestones(self) -> None:
        with self.session_factory() as db:
            conversations = db.query(Conversation).filter(Conversation.channel == "telegram").all()
            pending: list[tuple[int, str, str, int]] = []
            for conv in conversations:
                anchor = db.get(Task, conv.anchor_task_id) if conv.anchor_task_id else None
                if anchor is None:
                    continue
                status = anchor.status
                if self._last_statuses.get(conv.id) == status:
                    continue
                first_seen = conv.id not in self._last_statuses
                self._last_statuses[conv.id] = status
                if first_seen:
                    continue  # history that predates this process is not a milestone
                pending.append((conv.id, status, self._milestone_text(db, conv, anchor),
                                conv.current_plan_version))
            for conv_id, status, text, version in pending:
                # Persisted dedupe keyed by plan version too: /revise -> new proposal v+1
                # must notify again, while a restart re-seeing the same state must not.
                outbox.enqueue(db, conv_id, text, f"milestone-{conv_id}-{status}-{version}")

    @staticmethod
    def _milestone_text(db, conv: Conversation, anchor: Task) -> str:
        title = conv.title[:80]
        version = conv.current_plan_version
        if anchor.status == "awaiting_approval":
            return (f"A plan proposal is ready: “{title}”\n"
                    f"Review it with /status, then run /approve {version} or /revise <notes>.")
        if anchor.status == "completed":
            excerpt = (anchor.result or "")[:600]
            return (f"Work completed and passed QC: “{title}”\n{excerpt}"
                    if excerpt else f"Work completed and passed QC: “{title}”")
        if anchor.status == "failed":
            return f"The run failed: “{title}”\n{str(anchor.result or 'See /status for details.')[:400]}"
        if anchor.status == "cancelled":
            return f"The request was cancelled: “{title}”"
        return f"{anchor.status}: “{title}”"


_active_poller: TelegramPoller | None = None


def get_active_poller() -> TelegramPoller | None:
    return _active_poller


def start_from_env() -> TelegramPoller | None:
    """Called from the app lifespan: starts the poller only when the bot is configured."""
    global _active_poller
    settings, reason = load_settings()
    if settings is None:
        logger.info("telegram channel disabled: %s", reason)
        return None
    _active_poller = TelegramPoller(settings)
    _active_poller.start()
    return _active_poller


def stop_poller() -> None:
    global _active_poller
    if _active_poller is not None:
        _active_poller.stop()
        _active_poller.join(timeout=30)
        _active_poller = None


def status() -> dict:
    settings, reason = load_settings()
    poller = _active_poller
    pending = 0
    try:
        with SessionLocal() as db:
            from sqlalchemy import func
            pending = db.query(func.count(TelegramOutbox.id)).filter(
                TelegramOutbox.status == "pending").scalar() or 0
    except Exception:
        pending = 0
    return {
        "configured": settings is not None,
        "reason": None if settings is not None else reason,
        "running": bool(poller is not None and poller.started and poller.is_alive()),
        "allowed_chats": len(settings.allowed_chats) if settings else 0,
        "outbox_pending": int(pending),
    }
