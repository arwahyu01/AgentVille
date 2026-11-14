import json

from app.agent_actions import ActionGate, action_kind, actions_from_stream_line


def assistant(*blocks):
    return json.dumps({"type": "assistant", "message": {"role": "assistant", "content": list(blocks)}})


def tool(name, **inp):
    return {"type": "tool_use", "id": "toolu_1", "name": name, "input": inp}


def test_each_tool_call_becomes_a_kind_and_a_short_line():
    assert actions_from_stream_line(assistant(tool("Read", file_path="/w/data.txt"))) == [("read", "Baca data.txt")]
    assert actions_from_stream_line(assistant(tool("Write", file_path="/w/index.html", content="<h1>x</h1>"))) == [("write", "Tulis index.html")]
    assert actions_from_stream_line(assistant(tool("Edit", file_path="/w/a/App.tsx", old_string="a", new_string="b"))) == [("write", "Edit App.tsx")]
    assert actions_from_stream_line(assistant(tool("Grep", pattern="TODO"))) == [("search", "Cari: TODO")]
    assert actions_from_stream_line(assistant(tool("Bash", command="npm test", description="Run the tests"))) == [("run", "Terminal: Run the tests")]


def test_one_message_can_hold_several_calls_and_text_is_ignored():
    line = assistant({"type": "text", "text": "Saya mulai."}, tool("Read", file_path="/a.py"), tool("Glob", pattern="*.md"))
    assert actions_from_stream_line(line) == [("read", "Baca a.py"), ("search", "Cari: *.md")]


def test_non_tool_events_yield_nothing():
    for event in (
        {"type": "system", "subtype": "init", "cwd": "/w"},
        {"type": "user", "message": {"content": [{"type": "tool_result", "content": "ok"}]}},
        {"type": "assistant", "message": {"content": [{"type": "thinking", "thinking": "hmm"}]}},
        {"type": "result", "subtype": "success", "result": "done"},
        {"type": "rate_limit_event"},
    ):
        assert actions_from_stream_line(json.dumps(event)) == []
    for junk in ("", "   ", "not json", "{broken", "[1,2]", '{"type":"assistant"}', '{"type":"assistant","message":{"content":"x"}}'):
        assert actions_from_stream_line(junk) == []


def test_secrets_and_contents_never_reach_the_line():
    out = actions_from_stream_line(assistant(tool("Bash", command="curl -H 'Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123456789' https://x")))
    assert out == [("run", "Terminal: curl -H")]
    out = actions_from_stream_line(assistant(tool("Write", file_path="/w/.env", content="API_KEY=sk-live-123")))
    assert out == [("write", "Tulis .env")]
    assert "sk-live" not in json.dumps(out)


def test_unknown_and_mcp_tools_read_as_a_generic_run():
    assert action_kind("mcp__github__create_issue") == "run"
    assert action_kind("Whatever") == "run"
    assert action_kind("Agent") == "think"


def test_gate_spaces_events_and_caps_the_total():
    now = [0.0]
    gate = ActionGate(min_gap_s=1.5, max_total=3, clock=lambda: now[0])
    assert gate.allow()
    now[0] = 1.0
    assert not gate.allow()
    now[0] = 1.6
    assert gate.allow()
    now[0] = 3.2
    assert gate.allow()
    now[0] = 10.0
    assert not gate.allow()  # cap of 3 reached
