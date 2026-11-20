"""Daily news draft scheduler.

Creates one conversation per local day at the configured hour, reusing the normal Coordinator →
plan → specialist → QC pipeline. It fetches nothing itself, writes no files, and never calls a
publishing endpoint; the resulting conversation is a draft for a human to review.
"""

import logging
import threading
import time
from datetime import datetime

from sqlalchemy.exc import IntegrityError

from app.conversation_service import create_conversation
from app.database import SessionLocal
from app.models import NewsRun, Settings
from app.settings_store import get_setting

logger = logging.getLogger("agentville.news_schedule")

TICK_S = 60.0
MAX_TOPICS = 500
MAX_ITEMS = 10


def _int_setting(db, key: str, default: int) -> int:
    try:
        return int(get_setting(db, key))
    except (TypeError, ValueError):
        return default


def schedule_config(db) -> dict:
    hour = _int_setting(db, "news_schedule_hour", 7)
    if not 0 <= hour <= 23:
        hour = 7
    items = _int_setting(db, "news_schedule_max_items", 5)
    return {
        "enabled": get_setting(db, "news_schedule_enabled") == "1",
        "hour": hour,
        "topics": get_setting(db, "news_schedule_topics")[:MAX_TOPICS],
        "max_items": max(1, min(items, MAX_ITEMS)),
    }


def build_prompt(config: dict, run_date: str) -> str:
    topics = config["topics"].strip() or "teknologi, bisnis, dan industri"
    return (
        f"[JADWAL BERITA {run_date}] Kumpulkan maksimal {config['max_items']} berita terbaru "
        f"dan terpercaya seputar: {topics}. "
        "Gunakan alat web_fetch/web_search bila tersedia di CLI; cantumkan judul, tanggal, "
        "sumber/URL, dan ringkasan 2-3 kalimat per berita. "
        "Lalu tulis satu draf artikel ringkas di workspace (data/workspace/project-<id>/) "
        "berisi ringkasan tersebut, daftar sumber, dan saran caption Instagram. "
        "Jangan mempublikasikan, mengunggah, atau mengirim apa pun ke luar — draf saja. "
        "Jika alat web tidak tersedia, katakan terus terang dan kumpulkan hanya dari sumber "
        " yang bisa diakses, jangan mengarang berita."
    )


def run_once(db, *, now: datetime | None = None, dry_run: bool = False) -> dict:
    """Create at most one scheduled run. Safe to call twice on the same day."""
    config = schedule_config(db)
    now = now or datetime.now()
    run_date = now.strftime("%Y-%m-%d")
    if not config["enabled"]:
        return {"ran": False, "reason": "disabled", "config": config}
    if now.hour != config["hour"]:
        return {"ran": False, "reason": f"jam {config['hour']:02d}:00 belum tiba", "config": config}
    if db.query(NewsRun).filter(NewsRun.run_date == run_date).first() is not None:
        return {"ran": False, "reason": "sudah dijalankan hari ini", "config": config}
    if dry_run:
        return {"ran": True, "reason": "dry-run", "config": config, "prompt": build_prompt(config, run_date)}
    row = NewsRun(run_date=run_date, topics=config["topics"], status="queued")
    db.add(row)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        return {"ran": False, "reason": "sudah dijalankan hari ini", "config": config}
    try:
        conv = create_conversation(
            db, build_prompt(config, run_date), channel="schedule", user_identity="news-scheduler")
        row.conversation_id = conv.id
        row.status = "queued"
    except Exception as e:  # keep the ledger row so this day is not retried in a tight loop
        row.status = "failed"
        row.error = str(e)[:500]
        logger.exception("scheduled news conversation failed")
    db.commit()
    return {"ran": True, "conversation_id": row.conversation_id,
            "status": row.status, "config": config}


class NewsScheduler(threading.Thread):
    def __init__(self) -> None:
        super().__init__(daemon=True, name="agentville-news-scheduler")
        self._stop_event = threading.Event()

    def stop(self) -> None:
        self._stop_event.set()

    def run(self) -> None:
        while not self._stop_event.is_set():
            try:
                with SessionLocal() as db:
                    run_once(db)
            except Exception:
                logger.exception("news scheduler tick failed")
            self._stop_event.wait(TICK_S)
