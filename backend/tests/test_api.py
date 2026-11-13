def test_health(client):
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"

def test_list_agents(client):
    agents = client.get("/api/agents").json()
    assert len(agents) == 2
    assert agents[0]["status"] == "idle"

def test_get_agent_by_id(client, agent_id):
    response = client.get(f"/api/agents/{agent_id}")
    assert response.status_code == 200
    assert response.json()["id"] == agent_id

def test_get_unknown_agent_404(client):
    assert client.get("/api/agents/999").status_code == 404

def test_create_task(client, agent_id):
    response = client.post("/api/tasks", json={"title": "Ship Fase 2", "description": "Backend + UI", "priority": "high", "agent_id": agent_id})
    assert response.status_code == 201
    task = response.json()
    assert task["status"] == "pending"
    assert task["agent_id"] == agent_id

def test_create_task_blank_title_rejected(client):
    response = client.post("/api/tasks", json={"title": "   ", "description": "", "priority": "normal", "agent_id": None})
    assert response.status_code == 422

def test_create_task_unknown_agent_404(client):
    response = client.post("/api/tasks", json={"title": "x", "description": "", "priority": "normal", "agent_id": 999})
    assert response.status_code == 404

def test_get_task_by_id(client):
    task = client.post("/api/tasks", json={"title": "Read me", "description": "", "priority": "normal", "agent_id": None}).json()
    response = client.get(f"/api/tasks/{task['id']}")
    assert response.status_code == 200
    assert response.json()["title"] == "Read me"

def test_get_unknown_task_404(client):
    assert client.get("/api/tasks/999").status_code == 404

def test_valid_status_lifecycle(client):
    task = client.post("/api/tasks", json={"title": "Flow", "description": "", "priority": "normal", "agent_id": None}).json()
    for status in ("queued", "running", "completed"):
        response = client.patch(f"/api/tasks/{task['id']}", json={"status": status})
        assert response.status_code == 200
        assert response.json()["status"] == status
    events = client.get(f"/api/tasks/{task['id']}/events").json()
    types = [e["event_type"] for e in events]
    assert "created" in types
    assert "status_changed" in types

def test_invalid_transition_rejected(client):
    task = client.post("/api/tasks", json={"title": "Jump", "description": "", "priority": "normal", "agent_id": None}).json()
    response = client.patch(f"/api/tasks/{task['id']}", json={"status": "running"})
    assert response.status_code == 409
    assert "Invalid status transition" in response.json()["detail"]

def test_terminal_status_locked(client):
    task = client.post("/api/tasks", json={"title": "Done", "description": "", "priority": "normal", "agent_id": None}).json()
    client.patch(f"/api/tasks/{task['id']}", json={"status": "queued"})
    client.patch(f"/api/tasks/{task['id']}", json={"status": "cancelled"})
    response = client.patch(f"/api/tasks/{task['id']}", json={"status": "queued"})
    assert response.status_code == 409

def test_cancel_pending_task(client):
    task = client.post("/api/tasks", json={"title": "Cancel me", "description": "", "priority": "normal", "agent_id": None}).json()
    response = client.post(f"/api/tasks/{task['id']}/cancel")
    assert response.status_code == 200
    assert response.json()["status"] == "cancelled"

def test_cancel_completed_task_rejected(client):
    task = client.post("/api/tasks", json={"title": "Finished", "description": "", "priority": "normal", "agent_id": None}).json()
    client.patch(f"/api/tasks/{task['id']}", json={"status": "queued"})
    client.patch(f"/api/tasks/{task['id']}", json={"status": "running"})
    client.patch(f"/api/tasks/{task['id']}", json={"status": "completed"})
    response = client.post(f"/api/tasks/{task['id']}/cancel")
    assert response.status_code == 409

def test_agent_status_follows_running_task(client, agent_id):
    task = client.post("/api/tasks", json={"title": "Work", "description": "", "priority": "normal", "agent_id": agent_id}).json()
    client.patch(f"/api/tasks/{task['id']}", json={"status": "queued"})
    assert client.get(f"/api/agents/{agent_id}").json()["status"] == "waiting"
    client.patch(f"/api/tasks/{task['id']}", json={"status": "running"})
    assert client.get(f"/api/agents/{agent_id}").json()["status"] == "working"
    client.patch(f"/api/tasks/{task['id']}", json={"status": "failed"})
    assert client.get(f"/api/agents/{agent_id}").json()["status"] == "failed"
    client.patch(f"/api/tasks/{task['id']}", json={"status": "queued"})
    client.patch(f"/api/tasks/{task['id']}", json={"status": "running"})
    client.patch(f"/api/tasks/{task['id']}", json={"status": "completed"})
    assert client.get(f"/api/agents/{agent_id}").json()["status"] == "completed"

def test_edit_task_fields(client):
    task = client.post("/api/tasks", json={"title": "Old", "description": "old desc", "priority": "low", "agent_id": None}).json()
    response = client.patch(f"/api/tasks/{task['id']}", json={"title": "New title", "description": "new desc", "priority": "high"})
    assert response.status_code == 200
    body = response.json()
    assert body["title"] == "New title"
    assert body["description"] == "new desc"
    assert body["priority"] == "high"

def test_reassign_agent(client, agent_id):
    other = client.get("/api/agents").json()[1]["id"]
    task = client.post("/api/tasks", json={"title": "Move", "description": "", "priority": "normal", "agent_id": agent_id}).json()
    response = client.patch(f"/api/tasks/{task['id']}", json={"agent_id": other})
    assert response.json()["agent_id"] == other
    assert client.post("/api/tasks", json={"title": "Bad", "description": "", "priority": "normal", "agent_id": 999}).status_code == 404

def test_events_are_attributed_to_the_owning_agent(client, agent_id):
    """The 3D office can only react to a journal frame it can attach to an agent."""
    task = client.post("/api/tasks", json={"title": "Owned", "description": "", "priority": "normal",
                                           "agent_id": agent_id}).json()
    client.patch(f"/api/tasks/{task['id']}", json={"status": "queued"})
    events = client.get(f"/api/tasks/{task['id']}/events").json()
    assert [e["agent_id"] for e in events] == [agent_id, agent_id]
    assert [e["event_type"] for e in events] == ["created", "status_changed"]

def test_unassigned_task_events_expose_null_identity(client):
    task = client.post("/api/tasks", json={"title": "Homeless", "description": "", "priority": "normal",
                                           "agent_id": None}).json()
    events = client.get(f"/api/tasks/{task['id']}/events").json()
    assert events[0]["agent_id"] is None
    assert events[0]["provider"] is None
    assert events[0]["step_index"] is None

def test_conversation_events_name_the_coordinator(client):
    """Planning turns are Coordinator work: the journal and the office must show who is busy."""
    coordinator = client.get("/api/agents").json()[0]["id"]
    conv = client.post("/api/conversations", json={"first_message": "Draft a launch checklist",
                                                  "channel": "web"}).json()
    events = client.get(f"/api/tasks/{conv['anchor_task_id']}/events").json()
    assert events and all(e["agent_id"] == coordinator for e in events)
    assert client.get(f"/api/agents/{coordinator}").json()["status"] == "waiting"

def test_team_events_endpoint(client, session_factory):
    from app.models import Task, TaskEvent
    agent = client.get("/api/agents").json()[0]
    task = client.post("/api/tasks", json={"title": "Draft report", "description": "",
                                           "priority": "normal", "agent_id": agent["id"]}).json()
    with session_factory() as db:
        db.add(TaskEvent(task_id=task["id"], event_type="step_started", message="Step started",
                         agent_id=agent["id"], step_index=0))
        db.commit()
    body = client.get("/api/events/team").json()
    frame = body[0]
    assert frame["event_type"] == "step_started"
    assert frame["agent_name"] == agent["name"]
    assert frame["agent_role"] == agent["role"]
    assert frame["task_title"] == "Draft report"
    assert frame["step_index"] == 0

def test_team_events_endpoint_filters_by_conversation(client, session_factory):
    from app.models import TaskEvent
    task = client.post("/api/tasks", json={"title": "Solo", "description": "",
                                           "priority": "normal", "agent_id": None}).json()
    with session_factory() as db:
        db.add(TaskEvent(task_id=task["id"], event_type="created", message="No conversation"))
        db.add(TaskEvent(task_id=task["id"], event_type="plan_proposed", message="v1",
                         conversation_id=77))
        db.commit()
    body = client.get("/api/events/team", params={"conversation_id": 77}).json()
    assert [f["event_type"] for f in body] == ["plan_proposed"]
