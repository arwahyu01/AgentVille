from datetime import datetime, timedelta, timezone

from app.claude_sessions import apply_hook, redact, summarize_tool, visible_sessions
from app.models import ClaudeEvent

SID = "4f1c2a90-aaaa-bbbb-cccc-000000000001"


def hook(client, event, **extra):
    body = {"session_id": SID, "cwd": "/Users/me/Herd/AgentVille", "hook_event_name": event, **extra}
    return client.post("/api/claude/hooks", json=body)


def sessions(client):
    return client.get("/api/claude/sessions").json()["sessions"]


def test_lifecycle_drives_status_and_activity(client):
    assert hook(client, "SessionStart", source="startup").status_code == 204
    s = sessions(client)
    assert len(s) == 1 and s[0]["project"] == "AgentVille" and s[0]["status"] == "idle"

    hook(client, "UserPromptSubmit", prompt="Tambahkan provider Claude ke AgentVille")
    hook(client, "PreToolUse", tool_name="Edit", tool_input={"file_path": "/Users/me/x/src/App.tsx", "old_string": "a", "new_string": "b"})
    s = sessions(client)[0]
    assert s["status"] == "working" and s["activity"] == "Edit App.tsx" and s["tool_count"] == 1

    hook(client, "Notification", notification_type="permission_prompt", message="Claude needs your permission to use Bash")
    assert sessions(client)[0]["status"] == "waiting"
    hook(client, "PostToolUse", tool_name="Bash", tool_input={"command": "npm test"})
    assert sessions(client)[0]["status"] == "working"

    hook(client, "Stop", last_assistant_message="Provider Claude sudah ditambahkan dan tesnya lulus.")
    s = sessions(client)[0]
    assert s["status"] == "completed" and s["activity"].startswith("Selesai: Provider Claude")
    assert [e["event"] for e in s["events"]][:2] == ["Stop", "Notification"]

    hook(client, "SessionEnd", reason="exit")
    assert sessions(client) == []


def test_internal_agentville_runs_are_not_drawn_twice(client):
    resp = client.post("/api/claude/hooks", headers={"X-AgentVille-Run": "dev:123"},
                       json={"session_id": "internal", "hook_event_name": "SessionStart", "cwd": "/w"})
    assert resp.status_code == 204
    assert all(s["session_id"] != "internal" for s in sessions(client))


def test_bad_payloads_never_error(client):
    assert client.post("/api/claude/hooks", content=b"not json",
                       headers={"Content-Type": "application/json"}).status_code == 204
    assert client.post("/api/claude/hooks", json={"hook_event_name": "Stop"}).status_code == 204
    assert client.post("/api/claude/hooks", json=[1, 2]).status_code == 204


def test_summaries_never_store_contents_or_secrets():
    assert summarize_tool("Write", {"file_path": "/a/b/secret.env", "content": "API_KEY=sk-123"}) == "Tulis secret.env"
    line = summarize_tool("Bash", {"command": "curl -H 'Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123456789' https://x"})
    assert "abcdefghijklmnop" not in line and line == "Terminal: curl -H"
    assert summarize_tool("Bash", {"command": "rm -rf build", "description": "Clean the build folder"}) == "Terminal: Clean the build folder"
    assert summarize_tool("WebFetch", {"url": "https://docs.example.com/a?token=x"}) == "Buka web: docs.example.com"
    assert summarize_tool("mcp__github__create_issue", {}) == "MCP github · create_issue"
    assert "•••" in redact("password=hunter2 and token: abc")
    assert len(redact("x" * 500)) <= 120


def test_quiet_sessions_read_as_idle_then_disappear(session_factory):
    db_session = session_factory()
    now = datetime.now(timezone.utc)
    apply_hook(db_session, {"session_id": "s1", "hook_event_name": "PreToolUse", "tool_name": "Read",
                            "tool_input": {"file_path": "/a/b.py"}, "cwd": "/a"}, now=now - timedelta(minutes=20))
    db_session.commit()
    [s] = [x for x in visible_sessions(db_session, now=now) if x["session_id"] == "s1"]
    assert s["status"] == "idle"
    assert all(x["session_id"] != "s1" for x in visible_sessions(db_session, now=now + timedelta(hours=13)))


def test_event_journal_is_bounded(session_factory):
    db_session = session_factory()
    for i in range(60):
        apply_hook(db_session, {"session_id": "s2", "hook_event_name": "PreToolUse", "tool_name": "Read",
                                "tool_input": {"file_path": f"/f{i}.py"}, "cwd": "/a"})
    db_session.commit()
    assert db_session.query(ClaudeEvent).filter(ClaudeEvent.session_id == "s2").count() == 40
