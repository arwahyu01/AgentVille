import json

import httpx
import pytest

from app.channels import telegram
from app.channels.outbox import split_message
from app.channels.telegram import TelegramPoller, TelegramSettings, load_settings
from app import conversation_service
from app.models import Conversation, Message, TelegramOutbox, Task


def make_poller(session_factory, updates, allowed=("111",)):
    """Poller wired to an httpx.MockTransport — no network in tests."""
    sent: list[dict] = []
    batches = list(updates)

    def handler(request):
        if request.url.path.endswith("/getUpdates"):
            batch = batches.pop(0) if batches else []
            return httpx.Response(200, json={"ok": True, "result": batch})
        if request.url.path.endswith("/sendMessage"):
            sent.append(json.loads(request.content.decode("utf-8")))
            return httpx.Response(200, json={"ok": True, "result": {"message_id": len(sent)}})
        raise AssertionError(f"unexpected call {request.url.path}")

    client = httpx.Client(transport=httpx.MockTransport(handler),
                          base_url="https://api.telegram.org/botTEST")
    settings = TelegramSettings(token="TEST", allowed_chats=frozenset(allowed))
    return TelegramPoller(settings, session_factory=session_factory, http=client, poll_timeout_s=1), sent


def update(update_id, chat_id, text):
    return {"update_id": update_id, "message": {"chat": {"id": chat_id}, "text": text}}


def deliver(poller, sent):
    """Flush the durable outbox through the mock transport."""
    poller.flush_outbox(limit=50)
    return sent


def propose(session_factory, summary="plan it"):
    """Move the single telegram conversation to awaiting_approval with a stored plan."""
    from app.plan_schema import TaskPlan, PlanStep
    with session_factory() as db:
        conv = db.query(Conversation).one()
        task_plan = TaskPlan(steps=[PlanStep(title="Do the thing", instruction="do it",
                                             agent_role="AI Coordinator")],
                             acceptance_criteria=["it is done"])
        row = conversation_service.propose_plan(db, conv.id, task_plan, summary=summary)
    return row


# -- configuration --------------------------------------------------------------


def test_load_settings_requires_token_and_chats():
    settings, reason = load_settings(env={})
    assert settings is None and "TELEGRAM_BOT_TOKEN" in reason
    settings, reason = load_settings(env={"TELEGRAM_BOT_TOKEN": "t", "TELEGRAM_ALLOWED_CHAT_IDS": " "})
    assert settings is None and "TELEGRAM_ALLOWED_CHAT_IDS" in reason
    settings, reason = load_settings(env={"TELEGRAM_BOT_TOKEN": "t", "TELEGRAM_ALLOWED_CHAT_IDS": "1, 2"})
    assert settings is not None and settings.allowed_chats == frozenset({"1", "2"}) and reason == ""


def test_channel_status_reports_not_configured(client, monkeypatch):
    monkeypatch.setattr(telegram, "load_settings", lambda env=None: (None, "TELEGRAM_BOT_TOKEN is not set"))
    body = client.get("/api/channels/status").json()
    assert body["telegram"]["configured"] is False
    assert body["telegram"]["reason"] == "TELEGRAM_BOT_TOKEN is not set"
    assert body["telegram"]["running"] is False


# -- inbound --------------------------------------------------------------------


def test_unauthorized_chat_gets_one_reply_and_no_conversation(session_factory):
    poller, sent = make_poller(session_factory, [])
    poller.handle_update(update(1, 999, "hello"))
    assert len(sent) == 1 and "not authorized" in sent[0]["text"]
    with session_factory() as db:
        assert db.query(Conversation).count() == 0


def test_ingest_creates_conversation_and_dedupes_update_ids(session_factory):
    poller, sent = make_poller(session_factory, [])
    upd = update(10, 111, "Draft a weekly status report")
    poller.handle_update(upd)
    poller.handle_update(upd)  # same update_id replayed — must be ignored
    with session_factory() as db:
        convs = db.query(Conversation).all()
        assert len(convs) == 1 and convs[0].channel == "telegram" and convs[0].user_identity == "telegram:111"
        msgs = db.query(Message).filter(Message.conversation_id == convs[0].id).all()
        assert len(msgs) == 1 and msgs[0].external_id == "10"
    assert sent == []  # plain inbound messages never trigger an immediate outbound send


def test_oversize_message_rejected(session_factory):
    poller, sent = make_poller(session_factory, [])
    poller.handle_update(update(11, 111, "x" * 5000))
    assert len(sent) == 1 and "too long" in sent[0]["text"]
    with session_factory() as db:
        assert db.query(Conversation).count() == 0


def test_poll_once_processes_batch_and_advances_offset(session_factory):
    batch = [update(1, 111, "first"), update(2, 111, "second")]
    poller, sent = make_poller(session_factory, [batch])
    poller.poll_once()
    assert poller._offset == 3
    with session_factory() as db:
        convs = db.query(Conversation).all()
        assert len(convs) == 1
        assert db.query(Message).filter(Message.conversation_id == convs[0].id).count() == 2


def test_new_message_after_finished_request_starts_new_conversation(session_factory):
    poller, sent = make_poller(session_factory, [])
    poller.handle_update(update(1, 111, "old request"))
    with session_factory() as db:
        conv = db.query(Conversation).one()
        anchor = db.get(Task, conv.anchor_task_id)
        anchor.status = "completed"
        db.commit()
    poller.handle_update(update(2, 111, "brand new request"))
    with session_factory() as db:
        assert db.query(Conversation).count() == 2


# -- coordinator replies reach the chat ---------------------------------------------


def test_awaiting_approval_text_is_not_silently_ignored(session_factory):
    poller, sent = make_poller(session_factory, [])
    poller.handle_update(update(1, 111, "make the thing"))
    propose(session_factory)
    poller.handle_update(update(2, 111, "actually make it blue"))
    deliver(poller, sent)
    assert len(sent) == 1 and "/approve 1" in sent[0]["text"] and "saved" in sent[0]["text"].lower()
    with session_factory() as db:
        msgs = db.query(Message).all()
        assert any("blue" in m.content for m in msgs)  # note is kept in the transcript
    deliver(poller, sent)
    assert len(sent) == 1  # second flush delivers nothing new — dedupe keys are unique


def test_approve_command_gates_on_exact_version(session_factory):
    poller, sent = make_poller(session_factory, [])
    poller.handle_update(update(1, 111, "make the thing"))
    propose(session_factory)
    poller.handle_command("111", "/approve 99", update_id=2)   # wrong version
    deliver(poller, sent)
    assert len(sent) == 1 and "Could not approve" in sent[0]["text"]
    poller.handle_command("111", "/approve 1", update_id=3)
    deliver(poller, sent)
    assert len(sent) == 2 and "approved" in sent[1]["text"]
    with session_factory() as db:
        anchor = db.get(Task, db.query(Conversation).one().anchor_task_id)
        assert anchor.status == "approved"


def test_approve_command_is_idempotent_on_update_replay(session_factory):
    poller, sent = make_poller(session_factory, [])
    poller.handle_update(update(1, 111, "make the thing"))
    propose(session_factory)
    upd = update(5, 111, "/approve 1")
    poller.handle_update(upd)
    poller.handle_update(upd)  # replay — update-id dedupe stops it before the command runs
    deliver(poller, sent)
    assert len(sent) == 1 and "approved" in sent[0]["text"]
    with session_factory() as db:
        from app.models import Approval
        assert db.query(Approval).count() == 1


def test_revise_and_cancel_and_status_commands(session_factory):
    poller, sent = make_poller(session_factory, [])
    poller.handle_update(update(1, 111, "make the thing"))
    propose(session_factory)
    poller.handle_command("111", "/status", update_id=2)
    deliver(poller, sent)
    assert "Status: awaiting_approval" in sent[-1]["text"] and "0. [AI Coordinator]" in sent[-1]["text"]
    poller.handle_command("111", "/revise use a smaller scope", update_id=3)
    deliver(poller, sent)
    assert "redraft" in sent[-1]["text"]
    with session_factory() as db:
        anchor = db.get(Task, db.query(Conversation).one().anchor_task_id)
        assert anchor.status == "clarifying"  # revision cancels approval of the old version path
    poller.handle_command("111", "/cancel", update_id=4)
    deliver(poller, sent)
    assert "cancelled" in sent[-1]["text"].lower()
    with session_factory() as db:
        anchor = db.get(Task, db.query(Conversation).one().anchor_task_id)
        assert anchor.status == "cancelled"


def test_help_without_conversation_replies_directly(session_factory):
    poller, sent = make_poller(session_factory, [])
    poller.handle_command("111", "/start", update_id=1)
    deliver(poller, sent)
    assert len(sent) == 1 and "/approve" in sent[0]["text"]


# -- outbox durability and chunking ------------------------------------------------


def test_outbox_splits_long_messages_on_boundaries(session_factory):
    poller, sent = make_poller(session_factory, [])
    poller.handle_update(update(1, 111, "make the thing"))
    long_text = ("\n".join(f"line {i} " + "x" * 60 for i in range(200)))  # > 4000 chars
    from app.channels import outbox
    with session_factory() as db:
        conv = db.query(Conversation).one()
        outbox.enqueue(db, conv.id, long_text, "long-1")
    poller.flush_outbox(limit=10)
    assert len(sent) >= 2
    for msg in sent:
        assert len(msg["text"]) <= 4096
    recombined = "".join(m["text"] for m in sent)
    assert "line 0" in recombined and "line 199" in recombined
    with session_factory() as db:
        rows = db.query(TelegramOutbox).all()
        assert all(r.status == "sent" and r.telegram_message_id for r in rows)


def test_outbox_dedupe_key_blocks_double_delivery(session_factory):
    poller, sent = make_poller(session_factory, [])
    poller.handle_update(update(1, 111, "make the thing"))
    from app.channels import outbox
    with session_factory() as db:
        conv = db.query(Conversation).one()
        outbox.enqueue(db, conv.id, "hello", "k1")
        outbox.enqueue(db, conv.id, "hello", "k1")  # same logical reply — must not duplicate
    poller.flush_outbox(limit=10)
    poller.flush_outbox(limit=10)
    assert len(sent) == 1


def test_failed_delivery_retries_then_gives_up(session_factory):
    def handler(request):
        return httpx.Response(500, json={"ok": False, "error": "boom"})
    client = httpx.Client(transport=httpx.MockTransport(handler),
                          base_url="https://api.telegram.org/botTEST")
    poller = TelegramPoller(TelegramSettings(token="TEST", allowed_chats=frozenset({"111"})),
                            session_factory=session_factory, http=client, poll_timeout_s=1)
    poller.handle_update(update(1, 111, "make the thing"))
    from app.channels import outbox
    with session_factory() as db:
        conv = db.query(Conversation).one()
        outbox.enqueue(db, conv.id, "reply", "retry-test")
    for _ in range(5):
        poller.flush_outbox(limit=10)
    with session_factory() as db:
        row = db.query(TelegramOutbox).one()
        assert row.status == "failed" and row.attempts == 5 and "boom" in row.last_error


def test_split_message_prefers_breaks():
    text = "para1\n\n" + ("word " * 2000) + "\n\npara3"
    parts = split_message(text)
    assert all(len(p) <= 4000 for p in parts)
    assert parts[0].startswith("para1")
    assert parts[-1].endswith("para3")
    assert split_message("") == []
    hard = "x" * 8100
    assert all(len(p) <= 4000 for p in split_message(hard))


# -- outbound milestones --------------------------------------------------------------


def test_milestones_notify_once_per_change(session_factory):
    poller, sent = make_poller(session_factory, [])
    poller.handle_update(update(1, 111, "make the thing"))
    poller.check_milestones()          # first sighting of 'clarifying' — history, not a milestone
    deliver(poller, sent)
    assert sent == []
    with session_factory() as db:
        conv = db.query(Conversation).one()
        anchor = db.get(Task, conv.anchor_task_id)
        anchor.status = "awaiting_approval"
        db.commit()
    poller.check_milestones()
    deliver(poller, sent)
    assert len(sent) == 1 and "/approve" in sent[0]["text"] and sent[0]["chat_id"] == "111"
    poller.check_milestones()          # unchanged status — no repeat
    deliver(poller, sent)
    assert len(sent) == 1
    with session_factory() as db:
        anchor = db.get(Task, db.query(Conversation).one().anchor_task_id)
        anchor.status = "completed"
        db.commit()
    poller.check_milestones()
    deliver(poller, sent)
    assert len(sent) == 2 and "QC" in sent[1]["text"]
