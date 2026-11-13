"""Office operations daemon: scheduled Housekeeping and Security simulation staff.

The two staff are simulation-only. Their roles are absent from plan_schema.ROLES, so the
AI planner can never bind a project step to them, and this module touches nothing outside
the SQLite office journal — no files, no PC resources.

Schedules are deterministic: slot = int(time.time()) // tick_seconds, so a restart resumes
the same timetable instead of starting a fresh session. Every slot has a unique
dedupe_key in office_events, so replaying a tick (crash mid-slot, duplicate worker) can
never double-record an event.
"""

import logging
import threading
import time

from sqlalchemy.exc import IntegrityError

from app.database import SessionLocal
from app.models import Agent, OfficeEvent, Settings
from app.task_service import seat_agent

logger = logging.getLogger("agentville.office_ops")

TICK_S = 5.0
CATCHUP_SLOTS = 24  # never replay more than this many missed slots after a long downtime

# Guard duty cycle, one slot each (12-slot cycle):
#   0 posted -> 1 patrol starts -> 2..10 checkpoints -> 11 back at post
PATROL_ROUTE: tuple[str | None, ...] = (
    None,        # slot 0: guard_posted at the post
    None,        # slot 1: patrol_started from the post
    "lobby", "cs", "dev", "server", "analyst",
    "design", "meeting", "pantry", "admin",
    None,        # slot 11: patrol_completed, returns to post
)
PATROL_POST = "security"
PATROL_ACTOR = "Sentra"
PATROL_CYCLE_KEY = "patrol"

# Housekeeping cycle (13-slot): 0 cleaning starts and the first zone is cleaned,
# 1..6 six zones, 7 restock starts, 8 pantry restocked, 9..11 the remaining two
# zones plus 12 completion (returns to the pantry). The rotation covers the nine
# zones other than the pantry (restock handles it); each cycle rotates its start.
CLEAN_ZONES: tuple[str, ...] = (
    "lobby", "analyst", "design", "meeting", "server",
    "dev", "cs", "security", "admin",
)
CLEAN_CYCLE_LEN = len(CLEAN_ZONES) + 4  # start + 9 cleans + restock pair + completion
CLEANING_ACTOR = "Dusty"
CLEANING_CYCLE_KEY = "cleaning"


def _setting_int(db, key: str, default: int) -> int:
    row = db.get(Settings, key)
    try:
        value = int(row.value)
    except (AttributeError, TypeError, ValueError):
        return default
    return value if value >= 10 else default


def _emit(db, *, dedupe_key: str, event_type: str, message: str, actor: Agent,
          from_room: str | None, to_room: str | None, area: str, status: str) -> bool:
    """Insert one journal row and move the actor. False if the slot was already recorded."""
    try:
        db.add(OfficeEvent(dedupe_key=dedupe_key, event_type=event_type, message=message,
                           actor_agent_id=actor.id, actor_name=actor.name,
                           from_room=from_room, to_room=to_room, area=area, status=status))
        db.flush()
    except IntegrityError:
        db.rollback()
        return False
    seat_agent(db, actor.id, room=to_room or actor.current_room,
               target_room="" if to_room is None else None)
    actor.status = "idle" if status == "completed" else "working"
    db.commit()
    return True


def _run_patrol_slot(db, slot: int) -> None:
    actor = db.query(Agent).filter(Agent.name == PATROL_ACTOR).first()
    if actor is None:
        return
    phase = slot % len(PATROL_ROUTE)
    cycle = slot // len(PATROL_ROUTE)
    key = f"{PATROL_CYCLE_KEY}:{slot}"
    room = PATROL_ROUTE[phase]
    if phase == 0:
        _emit(db, dedupe_key=key, event_type="guard_posted",
              message=f"{actor.name} posted at Security Control", actor=actor,
              from_room=None, to_room=PATROL_POST, area=PATROL_POST, status="working")
    elif phase == 1:
        _emit(db, dedupe_key=key, event_type="patrol_started",
              message=f"{actor.name} started patrol round {cycle + 1}", actor=actor,
              from_room=PATROL_POST, to_room=PATROL_POST, area=PATROL_POST, status="working")
    elif phase == len(PATROL_ROUTE) - 1:
        _emit(db, dedupe_key=key, event_type="patrol_completed",
              message=f"{actor.name} completed patrol round {cycle + 1}", actor=actor,
              from_room=actor.current_room or "admin", to_room=PATROL_POST,
              area=PATROL_POST, status="completed")
    else:
        _emit(db, dedupe_key=key, event_type="patrol_checkpoint_reached",
              message=f"{actor.name} reached the {room} checkpoint", actor=actor,
              from_room=None, to_room=room, area=room, status="working")


def _run_cleaning_phase(db, cycle: int, phase: int) -> None:
    """One slot = one phase, so Dusty moves zone by zone instead of the whole round firing at once."""
    actor = db.query(Agent).filter(Agent.name == CLEANING_ACTOR).first()
    if actor is None:
        return
    first = (cycle * 4) % len(CLEAN_ZONES)

    def zone(p: int) -> str:
        # Cleaning rotation: phase 0 settles rotation index 0, phases 1..6 -> 1..6,
        # phases 9..11 -> 7..9 (7-8 are the pantry restock pair).
        return CLEAN_ZONES[(first + (p if p < 7 else p - 2)) % len(CLEAN_ZONES)]

    key = f"{CLEANING_CYCLE_KEY}:{cycle * CLEAN_CYCLE_LEN + phase}"

    def emit(**kw):
        _emit(db, dedupe_key=key, actor=actor, **kw)

    if phase == 0:
        room = zone(0)
        emit(event_type="cleaning_started",
             message=f"{actor.name} started cleaning round {cycle + 1}: {room.title()} cleaned and tidied",
             from_room=None, to_room=room, area=room, status="working")
    elif phase == 7:
        emit(event_type="restocking_started",
             message=f"{actor.name} is restocking the pantry supplies",
             from_room=None, to_room="pantry", area="pantry", status="working")
    elif phase == 8:
        emit(event_type="area_restocked", message="Pantry supplies restocked",
             from_room=None, to_room="pantry", area="pantry", status="working")
    elif phase == CLEAN_CYCLE_LEN - 1:
        emit(event_type="cleaning_completed",
             message=f"{actor.name} completed cleaning round {cycle + 1}",
             from_room=zone(CLEAN_CYCLE_LEN - 2), to_room="pantry", area="pantry", status="completed")
    else:
        room = zone(phase)
        emit(event_type="area_cleaned", message=f"{room.title()} cleaned and tidied",
             from_room=None, to_room=room, area=room, status="working")


def _run_cleaning_slot(db, slot: int) -> None:
    _run_cleaning_phase(db, *divmod(slot, CLEAN_CYCLE_LEN))


class OfficeOps(threading.Thread):
    """Daemon thread independent of the Orchestrator: the office keeps running with the
    AI engine switched off."""

    def __init__(self) -> None:
        super().__init__(daemon=True, name="agentville-office-ops")
        self._stop_event = threading.Event()

    def stop(self) -> None:
        self._stop_event.set()

    def run(self) -> None:
        while not self._stop_event.is_set():
            try:
                self._tick()
            except Exception:
                logger.exception("office ops tick failed")
            self._stop_event.wait(TICK_S)

    def _tick(self) -> None:
        with SessionLocal() as db:
            if not self.enabled(db):
                return
            now = int(time.time())
            patrol_tick = _setting_int(db, "office_patrol_tick_s", 60)
            cleaning_tick = _setting_int(db, "office_cleaning_tick_s", 90)
            last_patrol = _last_slot(db, PATROL_CYCLE_KEY)
            last_cleaning = _last_slot(db, CLEANING_CYCLE_KEY)
            self._advance(db, now // patrol_tick, last_patrol, _run_patrol_slot)
            self._advance(db, now // cleaning_tick, last_cleaning, _run_cleaning_slot)

    @staticmethod
    def _advance(db, current_slot: int, last_slot: int, run) -> None:
        start = max(last_slot + 1, current_slot - CATCHUP_SLOTS + 1)
        for slot in range(start, current_slot + 1):
            run(db, slot)

    @staticmethod
    def enabled(db) -> bool:
        row = db.get(Settings, "office_ops_enabled")
        return row is None or row.value == "1"


def _last_slot(db, cycle_key: str) -> int:
    prefix = f"{cycle_key}:"
    rows = (db.query(OfficeEvent.dedupe_key)
            .filter(OfficeEvent.dedupe_key.like(f"{prefix}%"))
            .order_by(OfficeEvent.id.desc()).limit(200).all())
    slots = []
    for (key,) in rows:
        try:
            slots.append(int(key.split(":", 1)[1]))
        except ValueError:
            continue
    return max(slots, default=-1)
