"""Durable Telegram outbound queue.

Every reply, question, proposal, status change and failure goes through this queue when
its conversation lives on Telegram. Rows are keyed by a caller-supplied dedupe_key, so a
retry or a process restart can never deliver the same logical reply twice, and delivery
state (attempts, provider message id, error) is persisted next to the transcript."""

from sqlalchemy.orm import Session

from app.models import Conversation, TelegramOutbox

# Telegram's hard limit is 4096; the margin leaves room for the suffix we add on splits.
MAX_CHUNK_CHARS = 4000
MAX_ATTEMPTS = 5


def split_message(text: str, limit: int = MAX_CHUNK_CHARS) -> list[str]:
    """Split into Telegram-sized chunks at paragraph/line/word boundaries when possible,
    never mid-word unless the text has no break in the limit."""
    text = text.strip()
    if not text:
        return []
    if len(text) <= limit:
        return [text]
    parts: list[str] = []
    rest = text
    while rest:
        if len(rest) <= limit:
            parts.append(rest)
            break
        cut = limit
        for marker in ("\n\n", "\n", " "):
            idx = rest.rfind(marker, 0, limit)
            if idx >= limit // 2:
                cut = idx
                break
        parts.append(rest[:cut].rstrip())
        rest = rest[cut:].lstrip()
    return parts


def chat_id_for(conv: Conversation | None) -> str | None:
    if conv is None or conv.channel != "telegram" or not conv.user_identity.startswith("telegram:"):
        return None
    return conv.user_identity.split(":", 1)[1]


def enqueue(db: Session, conversation_id: int | None, text: str, dedupe_key: str) -> None:
    """Queue text for the conversation's Telegram chat. No-op for web conversations."""
    if conversation_id is None:
        return
    conv = db.get(Conversation, conversation_id)
    chat_id = chat_id_for(conv)
    if not chat_id:
        return
    _enqueue_chat(db, chat_id, text, dedupe_key)


def enqueue_chat(db: Session, chat_id: str, text: str, dedupe_key: str) -> None:
    """Queue an explicit chat (used for command replies that may arrive before a conversation)."""
    _enqueue_chat(db, chat_id, text, dedupe_key)


def _enqueue_chat(db: Session, chat_id: str, text: str, dedupe_key: str) -> None:
    for index, chunk in enumerate(split_message(text)):
        key = f"{dedupe_key}:{index}"[:200]
        if db.query(TelegramOutbox).filter(TelegramOutbox.dedupe_key == key).first() is not None:
            continue
        db.add(TelegramOutbox(chat_id=chat_id, text=chunk, dedupe_key=key))
    db.commit()


def due_rows(db: Session, limit: int = 10) -> list[TelegramOutbox]:
    return (db.query(TelegramOutbox)
            .filter(TelegramOutbox.status == "pending")
            .order_by(TelegramOutbox.id).limit(limit).all())
