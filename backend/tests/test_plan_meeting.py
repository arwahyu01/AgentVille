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


def test_the_people_a_plan_involves_gather_while_it_waits(db):
    _conv, row = propose(db, "Researcher", "Developer")
    a = agents(db)
    assert {n for n, x in a.items() if x.target_room == "meeting"} == {"Atlas", "Sage", "Byte"}
    [started] = events(db, "meeting_started")
    assert started.to_room == "meeting" and "Rencana v1" in started.message and "Laporan angka" in started.message
    assert "Sage" in started.message and "menunggu persetujuan" in started.message
    assert row.version == 1


def test_approval_sends_everyone_back_to_their_department(db):
    conv, _row = propose(db, "Researcher", "Developer")
    cs.approve_plan(db, conv.id, 1)
    a = agents(db)
    assert all(x.target_room == "" for x in a.values())
    assert a["Sage"].current_room == "analyst" and a["Byte"].current_room == "dev"
    [ended] = events(db, "meeting_ended")
    assert "v1 disetujui" in ended.message and ended.from_room == "meeting"


def test_revision_and_cancel_also_end_the_meeting(db):
    conv, _ = propose(db, "Researcher")
    cs.request_revision(db, conv.id, "tambahkan ringkasan")
    assert agents(db)["Sage"].target_room == ""
    assert "revisi diminta" in events(db, "meeting_ended")[-1].message
    conv2, _ = propose(db, "Developer")
    cs.cancel_conversation(db, conv2.id)
    assert agents(db)["Byte"].target_room == ""
    assert "dibatalkan" in events(db, "meeting_ended")[-1].message


def test_a_new_proposal_replaces_the_previous_meeting(db):
    conv, _ = propose(db, "Researcher")
    cs.propose_plan(db, conv.id, make_plan("Developer"), summary="Versi dua")
    a = agents(db)
    assert a["Byte"].target_room == "meeting" and a["Sage"].target_room == ""
    assert [e.message.split(":")[0] for e in events(db, "meeting_started")] == ["Rencana v1", "Rencana v2"]
    assert "diganti rencana baru" in events(db, "meeting_ended")[0].message


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
