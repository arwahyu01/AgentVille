from app.ai.base import ProviderResult
from app.models import TaskEvent


class FakeProvider:
    def __init__(self, ok: bool = True):
        self.ok = ok
        self.calls: list[tuple] = []

    def run(self, persona, prompt, timeout_s=300, should_cancel=None):
        self.calls.append((persona, prompt, timeout_s))
        if not self.ok:
            return ProviderResult(ok=False, error="provider exploded", provider="fake", model=persona.model or "")
        return ProviderResult(ok=True, text="Halo, saya siap membantu.", provider="fake",
                              model=persona.model or "fake-model", latency_s=0.4)


def _enable_ai(client):
    resp = client.patch("/api/ai/config", json={"ai_enabled": True})
    assert resp.status_code == 200


def _fake_provider(monkeypatch, provider=None):
    import app.api.characters as characters_api

    fake = provider or FakeProvider()
    monkeypatch.setattr(characters_api.registry, "availability",
                        lambda: {"opencode": {"available": True, "reason": None}})
    monkeypatch.setattr(characters_api.registry, "make_provider", lambda name: fake)
    return fake


def test_chat_requires_enabled_ai(client):
    resp = client.post("/api/characters/chat", json={"character": "staff:greeter", "message": "Halo"})
    assert resp.status_code == 503
    assert "nonaktif" in resp.json()["detail"]


def test_chat_rejects_unknown_character(client):
    _enable_ai(client)
    assert client.post("/api/characters/chat", json={"character": "agent:999", "message": "Halo"}).status_code == 404
    assert client.post("/api/characters/chat", json={"character": "someone", "message": "Halo"}).status_code == 404


def test_staff_chat_uses_live_roster_without_writing(client, session_factory, monkeypatch):
    _enable_ai(client)
    fake = _fake_provider(monkeypatch)
    before = None
    with session_factory() as db:
        before = db.query(TaskEvent).count()

    resp = client.post("/api/characters/chat", json={
        "character": "staff:greeter", "message": "Apakah di sini bisa konsultasi?",
    })
    assert resp.status_code == 200
    body = resp.json()
    assert body["reply"] == "Halo, saya siap membantu."
    assert body["provider"] == "fake"
    assert body["ai"] is True

    persona, prompt, _timeout = fake.calls[0]
    assert persona.mode == "text"
    assert persona.name == "Front Desk"
    assert "Peta kantor" in prompt
    assert "Atlas" in prompt
    assert "Apakah di sini bisa konsultasi?" in prompt

    with session_factory() as db:
        assert db.query(TaskEvent).count() == before


def test_agent_chat_includes_live_task_and_runs_text_only(client, agent_id, monkeypatch):
    _enable_ai(client)
    fake = _fake_provider(monkeypatch)
    task = client.post("/api/tasks", json={
        "title": "Audit alur konsultasi", "description": "Tinjau alur dari lobby ke CS",
        "priority": "normal", "agent_id": agent_id,
    }).json()

    resp = client.post("/api/characters/chat", json={
        "character": f"agent:{agent_id}",
        "message": "Sedang apa?",
        "history": [{"role": "visitor", "text": "Halo"}, {"role": "character", "text": "Halo juga"}],
    })
    assert resp.status_code == 200
    persona, prompt, _timeout = fake.calls[0]
    assert persona.mode == "text"
    assert persona.name == "Atlas"
    assert "Audit alur konsultasi" in prompt
    assert task["status"] in prompt
    assert "PENGUNJUNG: Halo" in prompt
    assert "KARAKTER: Halo juga" in prompt
    assert "Sedang apa?" in prompt


def test_chat_reports_provider_failure(client, monkeypatch):
    _enable_ai(client)
    _fake_provider(monkeypatch, FakeProvider(ok=False))
    resp = client.post("/api/characters/chat", json={"character": "staff:teller", "message": "Halo"})
    assert resp.status_code == 502
    assert "provider exploded" in resp.json()["detail"]


def test_chat_timeout_is_capped(client, monkeypatch):
    _enable_ai(client)
    client.patch("/api/ai/config", json={"ai_timeout_s": 1800})
    fake = _fake_provider(monkeypatch)
    assert client.post("/api/characters/chat", json={"character": "staff:teller", "message": "Halo"}).status_code == 200
    assert fake.calls[0][2] == 90
