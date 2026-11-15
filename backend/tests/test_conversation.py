import pytest

from app import conversation_service as cs
from app.conversation_service import ConversationError
from app.plan_schema import TaskPlan
from app.models import Task


def make_plan(**overrides) -> TaskPlan:
    payload = {
        "steps": [
            {"title": "Research menu", "instruction": "Draft menu structure",
             "agent_role": "Researcher", "acceptance_criteria": ["Menu lengkap"]},
            {"title": "Build landing", "instruction": "Write index.html",
             "agent_role": "Developer", "depends_on": [0], "acceptance_criteria": ["File ada"]},
        ],
        "summary": "Restaurant site MVP",
        "acceptance_criteria": ["Situs bisa dibuka"],
    }
    payload.update(overrides)
    return TaskPlan.model_validate(payload)


def test_create_conversation_starts_clarifying(client):
    resp = client.post("/api/conversations", json={"first_message": "Buatkan web untuk restoran ABC"})
    assert resp.status_code == 201
    body = resp.json()
    assert body["status"] == "clarifying"
    assert body["current_plan_version"] == 0
    detail = client.get(f"/api/conversations/{body['id']}")
    assert detail.status_code == 200
    listing = client.get("/api/conversations").json()
    assert [c["id"] for c in listing] == [body["id"]]


def test_blank_first_message_rejected(client):
    resp = client.post("/api/conversations", json={"first_message": "   "})
    assert resp.status_code == 422


def test_messages_are_stored_and_chat_closes_after_approval(client, session_factory):
    conv_id = client.post("/api/conversations", json={"first_message": "Buatkan web"}).json()["id"]
    resp = client.post(f"/api/conversations/{conv_id}/messages", json={"content": "Restoran Jepang"})
    assert resp.status_code == 202
    msgs = client.get(f"/api/conversations/{conv_id}/messages").json()
    assert [m["role"] for m in msgs] == ["user", "user"]
    with session_factory() as db:
        conv = cs.get_conversation(db, conv_id)
        cs.propose_plan(db, conv.id, make_plan())
        cs.approve_plan(db, conv.id, 1)
    blocked = client.post(f"/api/conversations/{conv_id}/messages", json={"content": "late"})
    assert blocked.status_code == 409


def test_propose_approve_idempotent_flow(client, session_factory):
    conv_id = client.post("/api/conversations", json={"first_message": "Buatkan web"}).json()["id"]
    with session_factory() as db:
        cs.propose_plan(db, conv_id, make_plan(), summary="dua langkah")
        conv = cs.get_conversation(db, conv_id)
        anchor = db.get(Task, conv.anchor_task_id)
        # The office leader signs the plan off: no manual gate, the crew starts at once.
        assert anchor.status == "approved"
        assert conv.current_plan_version == 1
        children = db.query(Task).filter(Task.parent_id == anchor.id).order_by(Task.id).all()
        assert [c.title for c in children] == ["Research menu", "Build landing"]
    plan = client.get(f"/api/conversations/{conv_id}/plan").json()
    assert plan["current"]["version"] == 1
    assert len(plan["current"]["steps"]) == 2
    wrong = client.post(f"/api/conversations/{conv_id}/approve", json={"plan_version": 9})
    assert wrong.status_code == 409
    ok = client.post(f"/api/conversations/{conv_id}/approve", json={"plan_version": 1})
    assert ok.status_code == 200
    again = client.post(f"/api/conversations/{conv_id}/approve", json={"plan_version": 1})
    assert again.status_code == 200
    with session_factory() as db:
        conv = cs.get_conversation(db, conv_id)
        assert db.get(Task, conv.anchor_task_id).status == "approved"


def test_new_version_supersedes_old_approval(client, session_factory):
    conv_id = client.post("/api/conversations", json={"first_message": "Buatkan web"}).json()["id"]
    with session_factory() as db:
        cs.propose_plan(db, conv_id, make_plan())
    client.post(f"/api/conversations/{conv_id}/revise", json={"notes": "tambah halaman menu"})
    with session_factory() as db:
        cs.propose_plan(db, conv_id, make_plan())
        conv = cs.get_conversation(db, conv_id)
        assert conv.current_plan_version == 2
        history = cs.plan_history(db, conv_id)
        assert {row.status for row in history} == {"approved", "superseded"} or history[0].status == "approved"
    stale = client.post(f"/api/conversations/{conv_id}/approve", json={"plan_version": 1})
    assert stale.status_code == 409
    fresh = client.post(f"/api/conversations/{conv_id}/approve", json={"plan_version": 2})
    assert fresh.status_code == 200


def test_revise_only_from_an_active_plan(client, session_factory):
    conv_id = client.post("/api/conversations", json={"first_message": "Buatkan web"}).json()["id"]
    early = client.post(f"/api/conversations/{conv_id}/revise", json={"notes": "x"})
    assert early.status_code == 409
    with session_factory() as db:
        cs.propose_plan(db, conv_id, make_plan())
    # A revision also stops whatever the running plan already spawned.
    ok = client.post(f"/api/conversations/{conv_id}/revise", json={"notes": "ubah scope"})
    assert ok.status_code == 200
    assert ok.json()["status"] == "clarifying"
    with session_factory() as db:
        anchor = cs.get_conversation(db, conv_id)
        children = db.query(Task).filter(Task.parent_id == anchor.anchor_task_id).all()
        assert all(c.status == "cancelled" for c in children)


def test_cancel_conversation(client):
    conv_id = client.post("/api/conversations", json={"first_message": "Buatkan web"}).json()["id"]
    resp = client.post(f"/api/conversations/{conv_id}/cancel")
    assert resp.status_code == 200 and resp.json()["status"] == "cancelled"
    again = client.post(f"/api/conversations/{conv_id}/cancel")
    assert again.status_code == 409


def test_plan_requires_acceptance_criteria(client, session_factory):
    conv_id = client.post("/api/conversations", json={"first_message": "Buatkan web"}).json()["id"]
    bare = TaskPlan.model_validate({"steps": [{"title": "a", "instruction": "b", "agent_role": "Developer"}]})
    with session_factory() as db, pytest.raises(ValueError):
        cs.propose_plan(db, conv_id, bare)


def test_conversation_states_not_for_manual_tasks(client, agent_id):
    task = client.post("/api/tasks", json={"title": "manual", "description": "", "priority": "normal"}).json()
    resp = client.patch(f"/api/tasks/{task['id']}", json={"status": "clarifying"})
    assert resp.status_code == 409
    resp = client.patch(f"/api/tasks/{task['id']}", json={"status": "reviewing"})
    assert resp.status_code == 409


def test_manual_task_regular_flow_still_works(client):
    task = client.post("/api/tasks", json={"title": "t", "description": "", "priority": "normal"}).json()
    for status in ("queued", "running", "completed"):
        resp = client.patch(f"/api/tasks/{task['id']}", json={"status": status})
        assert resp.status_code == 200, resp.text
    assert client.patch(f"/api/tasks/{task['id']}", json={"status": "queued"}).status_code == 409
