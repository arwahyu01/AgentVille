import pytest

from app import conversation_service as cs
from app.models import Agent, Task, TaskEvent
from app.plan_schema import TaskPlan


def make_plan(*roles):
    return TaskPlan.model_validate({"steps": [
        {"title": f"Step {i}", "instruction": "do it", "agent_role": role, "depends_on": [i - 1] if i else [],
         "acceptance_criteria": ["done"]}
        for i, role in enumerate(roles)]})


@pytest.fixture
def db(session_factory):
    with session_factory() as db:
        db.add(Agent(name="Sage", role="Researcher", status="idle", position_x=0, position_z=0))
        db.commit()
        yield db


def agents(db):
    return {a.name: a for a in db.query(Agent).all()}


def events(db, kind):
    return db.query(TaskEvent).filter(TaskEvent.event_type == kind).order_by(TaskEvent.id).all()


def propose(db, *roles):
    conv = cs.create_conversation(db, "Buat laporan angka")
    row = cs.propose_plan(db, conv.id, make_plan(*roles), summary="Laporan angka dua langkah")
    return conv, row


def test_the_people_a_plan_involves_are_briefed_together(db):
    _conv, row = propose(db, "Researcher", "Developer")
    a = agents(db)
    # The briefing happens and ends inside the same call: the leader approves the plan and
    # everyone walks to their department, so nobody is left parked in the meeting room.
    assert {n for n, x in a.items() if x.target_room == "meeting"} == set()
    [started] = events(db, "meeting_started")
    assert started.to_room == "meeting" and "Rencana v1" in started.message and "Laporan angka" in started.message
    assert "Sage" in started.message and "Byte" in started.message
    [ended] = events(db, "meeting_ended")
    assert "v1 disetujui" in ended.message and ended.from_room == "meeting"
    assert row.version == 1 and row.status == "approved"


def test_approval_sends_everyone_back_to_their_department(db):
    conv, _row = propose(db, "Researcher", "Developer")
    cs.approve_plan(db, conv.id, 1)   # idempotent: the leader already approved it
    a = agents(db)
    assert all(x.target_room == "" for x in a.values())
    assert a["Sage"].current_room == "analyst" and a["Byte"].current_room == "dev"
    [ended] = events(db, "meeting_ended")
    assert "v1 disetujui" in ended.message and ended.from_room == "meeting"


def test_revision_and_cancel_stop_the_crew_and_close_the_briefing(db):
    conv, _ = propose(db, "Researcher")
    cs.request_revision(db, conv.id, "tambahkan ringkasan")
    assert agents(db)["Sage"].target_room == ""
    # The briefing itself already ended when the leader signed the plan; the revision is
    # logged as its own journal frame and cancels the steps the old plan had spawned.
    assert events(db, "revision_requested")[-1].message.startswith("Revision requested")
    assert events(db, "meeting_ended")[-1].message.startswith("Rapat rencana selesai")
    conv2, _ = propose(db, "Developer")
    cs.cancel_conversation(db, conv2.id)
    assert agents(db)["Byte"].target_room == ""
    assert events(db, "conversation_cancelled")[-1].message == "Conversation cancelled"


def test_a_new_proposal_after_a_revision_holds_a_fresh_briefing(db):
    conv, _ = propose(db, "Researcher")
    cs.request_revision(db, conv.id, "pakai data baru")
    cs.propose_plan(db, conv.id, make_plan("Developer"), summary="Versi dua")
    starts = events(db, "meeting_started")
    assert [e.message.split(":")[0] for e in starts] == ["Rencana v1", "Rencana v2"]
    assert "Byte" in starts[-1].message and "Sage" not in starts[-1].message


def test_busy_agents_are_not_pulled_away_from_their_work(db):
    # "Busy" is derived from real work: a running task owned by the agent.
    byte = agents(db)["Byte"]
    byte.current_room = "dev"
    db.add(Task(title="Proyek lain", status="running", agent_id=byte.id, run_mode="manual"))
    db.commit()
    propose(db, "Developer")
    byte = agents(db)["Byte"]
    assert byte.target_room == "" and byte.current_room == "dev"
    started = events(db, "meeting_started")[0]
    assert "Byte" not in started.message
