"""Office simulation staff + journal tests (T4).

Covers the guarantees the redesign prompt demands: Housekeeping/Security exist only as
simulation actors (never planner roles), their schedule slots are idempotent across
restarts, and the task-status sync cannot clobber their daemon-owned status."""

import time

import pytest

from app import office_ops
from app.agent_status import sync_agent_status
from app.models import Agent, OfficeEvent
from app.plan_schema import VALID_ROLES
from app.rooms import OPERATIONAL_ROLES, room_for_role


@pytest.fixture(autouse=True)
def _staff(session_factory, monkeypatch):
    monkeypatch.setattr(office_ops, "SessionLocal", session_factory)
    with session_factory() as db:
        db.add(Agent(name="Dusty", role="Housekeeping", status="idle",
                     position_x=0.0, position_z=0.0, current_room="pantry"))
        db.add(Agent(name="Sentra", role="Security", status="idle",
                     position_x=0.0, position_z=0.0, current_room="security"))
        db.commit()


def _slots(db, prefix):
    return [e.dedupe_key for e in
            db.query(OfficeEvent).filter(OfficeEvent.dedupe_key.like(f"{prefix}:%")).all()]


def test_operational_roles_are_never_planner_roles():
    assert OPERATIONAL_ROLES.isdisjoint(VALID_ROLES)
    assert room_for_role("Housekeeping") == "pantry"
    assert room_for_role("Security") == "security"


def test_patrol_slots_record_checkpoint_sequence(session_factory):
    with session_factory() as db:
        office_ops._run_patrol_slot(db, 0)
        office_ops._run_patrol_slot(db, 1)
        office_ops._run_patrol_slot(db, 2)
        rows = (db.query(OfficeEvent).order_by(OfficeEvent.id).all())
        types = [r.event_type for r in rows]
        assert types == ["guard_posted", "patrol_started", "patrol_checkpoint_reached"]
        assert rows[-1].to_room == "lobby"
        actor = db.get(Agent, rows[-1].actor_agent_id)
        assert actor.current_room == "lobby"
        assert actor.status == "working"


def test_slot_replay_is_idempotent(session_factory):
    with session_factory() as db:
        assert office_ops._run_patrol_slot(db, 5) is None
        office_ops._run_patrol_slot(db, 5)
        office_ops._run_patrol_slot(db, 5)
        assert len(_slots(db, "patrol")) == 1


def test_patrol_completion_returns_guard_to_post_and_idle(session_factory):
    with session_factory() as db:
        office_ops._run_patrol_slot(db, 11)
        row = db.query(OfficeEvent).one()
        assert row.event_type == "patrol_completed"
        assert row.status == "completed"
        actor = db.get(Agent, row.actor_agent_id)
        assert actor.current_room == "security"
        assert actor.status == "idle"


def test_each_cleaning_slot_records_exactly_one_phase(session_factory):
    with session_factory() as db:
        office_ops._run_cleaning_slot(db, 3)
        rows = db.query(OfficeEvent).all()
        assert len(rows) == 1
        assert rows[0].event_type == "area_cleaned"
        assert rows[0].dedupe_key == f"cleaning:{3}"


def test_cleaning_cycle_covers_every_zone_once(session_factory):
    cycle_len = office_ops.CLEAN_CYCLE_LEN
    with session_factory() as db:
        for slot in range(cycle_len):
            office_ops._run_cleaning_slot(db, slot)
        rows = db.query(OfficeEvent).order_by(OfficeEvent.id).all()
        types = [r.event_type for r in rows]
        assert len(rows) == cycle_len
        assert types.count("cleaning_started") == 1
        assert types.count("restocking_started") == 1
        assert types.count("area_restocked") == 1
        assert types.count("cleaning_completed") == 1
        assert types.count("area_cleaned") == len(office_ops.CLEAN_ZONES)
        # every zone is covered: cleaning_started announces + cleans the first one
        covered = set(r.area for r in rows if r.event_type in ("area_cleaned", "cleaning_started"))
        assert covered == set(office_ops.CLEAN_ZONES)
        cleaned = set(r.area for r in rows if r.event_type == "area_cleaned")
        assert cleaned == set(office_ops.CLEAN_ZONES)
        # the pantry is covered by the restock pair
        restock = [r for r in rows if r.event_type == "area_restocked"][0]
        assert restock.area == "pantry"


def test_advance_catches_up_without_duplicates(session_factory, monkeypatch):
    monkeypatch.setattr(time, "time", lambda: 1000 * 60)  # patrol slot 1000
    ops = office_ops.OfficeOps()
    with session_factory() as db:
        ops._advance(db, 1000, -1, office_ops._run_patrol_slot)
        first = _slots(db, "patrol")
        ops._advance(db, 1000, -1, office_ops._run_patrol_slot)  # simulated restart replay
        assert sorted(first) == sorted(_slots(db, "patrol"))
        assert len(first) == min(office_ops.CATCHUP_SLOTS, 1001)


def test_sync_agent_status_leaves_operational_staff_alone(session_factory):
    with session_factory() as db:
        dusty = db.query(Agent).filter(Agent.name == "Dusty").one()
        dusty.status = "working"
        db.commit()
        sync_agent_status(db)
        db.commit()
        db.refresh(dusty)
        assert dusty.status == "working"


def test_office_events_endpoint(client):
    body = client.get("/api/events/office").json()
    assert body == []
    resp = client.get("/api/events/office", params={"limit": 5})
    assert resp.status_code == 200
