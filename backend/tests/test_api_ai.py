import pytest


def _enable_ai(client):
    return client.patch("/api/ai/config", json={"ai_enabled": True})


def test_config_defaults(client):
    config = client.get("/api/ai/config").json()
    assert config["ai_enabled"] is False
    assert config["ai_model"] == "opencode/big-pickle"
    assert config["ai_timeout_s"] == 300
    assert config["provider"] == "opencode"


def test_config_patch_roundtrip(client):
    response = _enable_ai(client)
    assert response.status_code == 200
    body = response.json()
    assert body["ai_enabled"] is True
    assert client.get("/api/ai/config").json()["ai_enabled"] is True
    assert client.patch("/api/ai/config", json={"ai_enabled": False}).json()["ai_enabled"] is False


def test_config_patch_rejects_bad_model(client):
    assert client.patch("/api/ai/config", json={"ai_model": "bad model; rm -rf"}).status_code == 422
    assert client.patch("/api/ai/config", json={"ai_model": "openrouter/meta-llama/llama-3.3-70b"}).status_code == 200


def test_config_patch_rejects_bad_timeout(client):
    assert client.patch("/api/ai/config", json={"ai_timeout_s": 5}).status_code == 422
    assert client.patch("/api/ai/config", json={"ai_timeout_s": 99999}).status_code == 422


def test_agent_chat_mode_defaults_static_and_roundtrips(client):
    assert client.get("/api/ai/config").json()["agent_chat_mode"] == "static"
    assert client.patch("/api/ai/config", json={"agent_chat_mode": "milestone"}).json()["agent_chat_mode"] == "milestone"
    assert client.get("/api/ai/config").json()["agent_chat_mode"] == "milestone"
    assert client.patch("/api/ai/config", json={"agent_chat_mode": "loud"}).status_code == 422


def test_rotate_models_defaults_on_and_roundtrips(client):
    config = client.get("/api/ai/config").json()
    assert config["rotate_models_enabled"] is True
    assert config["rotate_models_max"] == 4
    assert client.patch("/api/ai/config", json={"rotate_models_enabled": False}).json()["rotate_models_enabled"] is False
    assert client.patch("/api/ai/config", json={"rotate_models_max": 9}).json()["rotate_models_max"] == 9
    assert client.get("/api/ai/config").json()["rotate_models_max"] == 9
    assert client.patch("/api/ai/config", json={"rotate_models_max": 0}).status_code == 422
    assert client.get("/api/ai/config").json()["agent_chat_mode"] == "static"
    assert client.patch("/api/ai/config", json={"agent_chat_mode": "milestone"}).json()["agent_chat_mode"] == "milestone"
    assert client.get("/api/ai/config").json()["agent_chat_mode"] == "milestone"
    assert client.patch("/api/ai/config", json={"agent_chat_mode": "loud"}).status_code == 422


def test_models_endpoint(client, monkeypatch):
    import app.ai.registry as registry
    registry._cache.clear()
    monkeypatch.setattr(registry, "list_models", lambda provider, force=False: ["opencode/big-pickle", "x/y"])
    assert client.get("/api/ai/models").json() == {"models": ["opencode/big-pickle", "x/y"]}


def test_models_endpoint_503_when_cli_missing(client, monkeypatch):
    import app.ai.registry as registry
    def boom(*a, **kw):
        raise RuntimeError("opencode CLI not found on PATH")
    monkeypatch.setattr(registry, "list_models", boom)
    assert client.get("/api/ai/models").status_code == 503


def test_execute_requires_enabled_ai(client):
    task = client.post("/api/tasks", json={"title": "T", "description": "", "priority": "normal", "agent_id": None}).json()
    response = client.post(f"/api/tasks/{task['id']}/execute", json={"mode": "direct"})
    assert response.status_code == 409


def test_execute_queues_task(client):
    _enable_ai(client)
    task = client.post("/api/tasks", json={"title": "T", "description": "", "priority": "normal", "agent_id": None}).json()
    response = client.post(f"/api/tasks/{task['id']}/execute", json={"mode": "plan"})
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "queued"
    assert body["run_mode"] == "ai_plan"


def test_execute_rejects_bad_states(client):
    _enable_ai(client)
    task = client.post("/api/tasks", json={"title": "T", "description": "", "priority": "normal", "agent_id": None}).json()
    client.patch(f"/api/tasks/{task['id']}", json={"status": "queued"})
    assert client.post(f"/api/tasks/{task['id']}/execute", json={"mode": "direct"}).status_code == 409
    assert client.post("/api/tasks/4242/execute", json={"mode": "direct"}).status_code == 404


def test_execute_422_for_subtask(client, session_factory):
    _enable_ai(client)
    parent = client.post("/api/tasks", json={"title": "P", "description": "", "priority": "normal", "agent_id": None}).json()
    from app.models import Task
    with session_factory() as db:
        child = Task(title="child", description="", status="pending", priority="normal", parent_id=parent["id"], run_mode="ai")
        db.add(child)
        db.commit()
        child_id = child.id
    assert client.post(f"/api/tasks/{child_id}/execute", json={"mode": "direct"}).status_code == 422


def test_result_endpoint(client, session_factory):
    assert client.get("/api/tasks/999/result").status_code == 404
    task = client.post("/api/tasks", json={"title": "R", "description": "", "priority": "normal", "agent_id": None}).json()
    from app.models import Task
    with session_factory() as db:
        parent = db.get(Task, task["id"])
        parent.result = "the answer"
        db.add(Task(title="sub", description="", status="completed", priority="normal", parent_id=parent.id, run_mode="ai"))
        db.commit()
    body = client.get(f"/api/tasks/{task['id']}/result").json()
    assert body["result"] == "the answer"
    assert len(body["children"]) == 1
    assert body["children"][0]["title"] == "sub"
