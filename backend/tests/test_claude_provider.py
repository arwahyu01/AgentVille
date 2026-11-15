import pytest

from app.ai import claude as claude_mod
from app.ai.base import Persona
from app.ai.claude import ClaudeProvider, build_coding_argv, build_text_argv, parse_result


def test_text_argv_disables_every_tool_and_mcp():
    argv = build_text_argv("claude", "sonnet")
    assert argv[:2] == ["claude", "-p"]
    assert argv[argv.index("--output-format") + 1] == "json"
    assert argv[argv.index("--tools") + 1] == ""
    assert "--strict-mcp-config" in argv
    assert "--no-session-persistence" in argv
    assert argv[argv.index("--model") + 1] == "sonnet"
    assert "--permission-mode" not in argv


def test_coding_argv_accepts_edits_with_an_explicit_tool_list():
    argv = build_coding_argv("claude", "claude-sonnet-5-5")
    assert argv[argv.index("--permission-mode") + 1] == "acceptEdits"
    tools = argv[argv.index("--tools") + 1]
    assert tools == argv[argv.index("--allowedTools") + 1]
    assert {"Read", "Write", "Edit"} <= set(tools.split(","))
    assert "--dangerously-skip-permissions" not in argv


@pytest.mark.parametrize("bad", ["../../evil", "model;rm -rf", "a model", "x" * 90])
def test_model_identifiers_rejected(bad):
    with pytest.raises(ValueError):
        build_text_argv("claude", bad)


def test_parse_result_success_error_and_noise():
    ok = '{"type":"result","subtype":"success","is_error":false,"result":"CLAUDE_OK","session_id":"s"}'
    assert parse_result(ok) == ("CLAUDE_OK", None)
    assert parse_result("warming up\n" + ok + "\n") == ("CLAUDE_OK", None)
    err = '{"type":"result","subtype":"error_max_turns","is_error":true,"result":"rate limit reached"}'
    assert parse_result(err) == ("", "rate limit reached")
    assert parse_result("not json") == ("", None)


def test_coding_without_workspace_errors_before_spawn(monkeypatch):
    def boom(*a, **k):
        raise AssertionError("must not spawn")
    monkeypatch.setattr(claude_mod.subprocess, "Popen", boom)
    persona = Persona(key="dev", name="Byte", role="Developer", instructions="x", mode="coding")
    result = ClaudeProvider(binary="claude").run(persona, "do it")
    assert not result.ok and "workspace" in result.error
    assert result.provider == "claude"


class _FakeProc:
    def __init__(self, stdout: str, code: int = 0):
        self._stdout = stdout
        self.returncode = code
        self.pid = 4242

    def communicate(self, input=None):
        self.prompt = input
        return self._stdout, ""


def test_run_passes_prompt_on_stdin_and_marks_internal_runs(monkeypatch, tmp_path):
    seen = {}

    def fake_popen(argv, **kwargs):
        seen["argv"] = argv
        seen["cwd"] = kwargs.get("cwd")
        seen["env"] = kwargs.get("env") or {}
        proc = _FakeProc('{"type":"result","is_error":false,"result":"done"}')
        seen["proc"] = proc
        return proc

    monkeypatch.setattr(claude_mod.subprocess, "Popen", fake_popen)
    persona = Persona(key="dev", name="Byte", role="Developer", instructions="Be precise.",
                      mode="coding", workspace=str(tmp_path), model="opus")
    result = ClaudeProvider(binary="claude").run(persona, "write index.html", timeout_s=5)
    assert result.ok and result.text == "done"
    assert result.model == "opus" and result.provider == "claude"
    assert seen["cwd"] == str(tmp_path)
    assert seen["env"].get(claude_mod.RUN_ENV, "").startswith("dev:")
    assert "write index.html" in seen["proc"].prompt


def test_quota_errors_are_recoverable(monkeypatch):
    monkeypatch.setattr(claude_mod.subprocess, "Popen",
                        lambda argv, **k: _FakeProc('{"type":"result","is_error":true,"result":"429 rate limit"}', 1))
    persona = Persona(key="r", name="Sage", role="Researcher", instructions="x")
    result = ClaudeProvider(binary="claude").run(persona, "q", timeout_s=5)
    assert not result.ok and result.recoverable


def test_models_require_the_binary(monkeypatch):
    monkeypatch.setattr(claude_mod, "find_binary", lambda: None)
    with pytest.raises(RuntimeError):
        claude_mod.list_available_models()
    monkeypatch.setattr(claude_mod, "find_binary", lambda: "/usr/local/bin/claude")
    assert "sonnet" in claude_mod.list_available_models()


def _fake_desktop(tmp_path, versions):
    for v in versions:
        exe = tmp_path / "Library" / "Application Support" / "Claude" / "claude-code" / v / "abc123" / "claude.app" / "Contents" / "MacOS" / "claude"
        exe.parent.mkdir(parents=True)
        exe.write_text("#!/bin/sh\n")
        exe.chmod(0o755)


def test_finds_the_newest_claude_desktop_binary(monkeypatch, tmp_path):
    _fake_desktop(tmp_path, ["2.1.9", "2.1.325", "2.1.321"])
    monkeypatch.setattr(claude_mod.Path, "home", classmethod(lambda cls: tmp_path))
    monkeypatch.setattr(claude_mod.shutil, "which", lambda name: None)
    monkeypatch.delenv(claude_mod.BIN_ENV, raising=False)
    found = claude_mod.find_binary()
    # Version comparison is the point of this test; separators differ on Windows.
    assert "2.1.325" in found.replace("\\", "/").split("/")


def test_override_and_path_win_over_the_desktop_copy(monkeypatch, tmp_path):
    _fake_desktop(tmp_path, ["2.1.325"])
    monkeypatch.setattr(claude_mod.Path, "home", classmethod(lambda cls: tmp_path))
    monkeypatch.setattr(claude_mod.shutil, "which", lambda name: "/opt/bin/claude")
    monkeypatch.delenv(claude_mod.BIN_ENV, raising=False)
    assert claude_mod.find_binary() == "/opt/bin/claude"
    mine = tmp_path / "mine"
    mine.write_text("x")
    mine.chmod(0o755)
    monkeypatch.setenv(claude_mod.BIN_ENV, str(mine))
    assert claude_mod.find_binary() == str(mine)


class _StreamProc:
    """Stand-in for a running `claude -p --output-format stream-json` process."""

    def __init__(self, lines, code=0):
        import io
        self.stdin = io.StringIO()
        self.stdin.close = lambda: None  # keep the written prompt readable
        self.stdout = iter(lines)
        self.stderr = io.StringIO("")
        self.returncode = code
        self.pid = 4343

    def wait(self):
        return self.returncode


def _assistant(name, **inp):
    import json
    return json.dumps({"type": "assistant", "message": {"content": [{"type": "tool_use", "name": name, "input": inp}]}}) + "\n"


def test_stream_argv_uses_stream_json_with_verbose():
    argv = build_coding_argv("claude", "sonnet", stream=True)
    assert argv[argv.index("--output-format") + 1] == "stream-json" and "--verbose" in argv
    assert "--verbose" not in build_coding_argv("claude", "sonnet")
    text = build_text_argv("claude", "sonnet", stream=True)
    assert text[text.index("--tools") + 1] == "" and "--verbose" in text


def test_tool_calls_reach_the_sink_while_the_run_is_parsed_normally(monkeypatch, tmp_path):
    seen = {}
    lines = [
        '{"type":"system","subtype":"init"}\n',
        _assistant("Read", file_path="/w/data.txt"),
        '{"type":"user","message":{"content":[{"type":"tool_result","content":"ok"}]}}\n',
        _assistant("Write", file_path="/w/out.txt", content="2"),
        '{"type":"result","subtype":"success","is_error":false,"result":"Selesai."}\n',
    ]

    def fake_popen(argv, **kwargs):
        seen["argv"] = argv
        seen["proc"] = _StreamProc(lines)
        return seen["proc"]

    monkeypatch.setattr(claude_mod.subprocess, "Popen", fake_popen)
    actions = []
    persona = Persona(key="dev", name="Byte", role="Developer", instructions="Be precise.", mode="coding",
                      workspace=str(tmp_path), model="haiku", on_action=lambda k, s: actions.append((k, s)))
    result = ClaudeProvider(binary="claude").run(persona, "do it", timeout_s=5)
    assert result.ok and result.text == "Selesai."
    assert actions == [("read", "Baca data.txt"), ("write", "Tulis out.txt")]
    assert "stream-json" in seen["argv"]
    assert "do it" in seen["proc"].stdin.getvalue()


def test_a_failing_sink_never_aborts_the_step(monkeypatch, tmp_path):
    def boom(kind, summary):
        raise RuntimeError("database is locked")

    monkeypatch.setattr(claude_mod.subprocess, "Popen",
                        lambda argv, **k: _StreamProc([_assistant("Read", file_path="/a"),
                                                       '{"type":"result","is_error":false,"result":"ok"}\n']))
    persona = Persona(key="r", name="Sage", role="Researcher", instructions="x", on_action=boom)
    result = ClaudeProvider(binary="claude").run(persona, "q", timeout_s=5)
    assert result.ok and result.text == "ok"


def test_without_a_sink_the_plain_json_path_is_unchanged(monkeypatch):
    seen = {}

    def fake_popen(argv, **kwargs):
        seen["argv"] = argv
        return _FakeProc('{"type":"result","is_error":false,"result":"plain"}')

    monkeypatch.setattr(claude_mod.subprocess, "Popen", fake_popen)
    result = ClaudeProvider(binary="claude").run(Persona(key="r", name="n", role="r", instructions="x"), "q", timeout_s=5)
    assert result.ok and result.text == "plain"
    assert seen["argv"][seen["argv"].index("--output-format") + 1] == "json"


def test_persona_equality_ignores_the_callback():
    a = Persona(key="k", name="n", role="r", instructions="i", on_action=lambda k, s: None)
    b = Persona(key="k", name="n", role="r", instructions="i")
    assert a == b
