import importlib.util
import json
from pathlib import Path

_SPEC = importlib.util.spec_from_file_location(
    "claude_hooks", Path(__file__).resolve().parents[2] / "scripts" / "claude_hooks.py")
hooks = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(hooks)

URL = hooks.DEFAULT_URL


def test_merge_keeps_existing_hooks_and_is_idempotent():
    mine = {"type": "command", "command": "say done"}
    settings = {"permissions": {"allow": ["Read"]}, "hooks": {"Stop": [{"hooks": [mine]}]}}
    once = hooks.merge(settings, URL)
    twice = hooks.merge(once, URL)
    assert once == twice
    assert once["permissions"] == settings["permissions"]
    assert {"hooks": [mine]} in once["hooks"]["Stop"]
    assert set(hooks.EVENTS) <= set(once["hooks"])
    pre = once["hooks"]["PreToolUse"][0]
    assert pre["matcher"] == "*" and pre["hooks"][0]["url"] == URL
    assert pre["hooks"][0]["allowedEnvVars"] == ["AGENTVILLE_RUN"]


def test_remove_restores_the_original():
    settings = {"hooks": {"Stop": [{"hooks": [{"type": "command", "command": "say done"}]}]}}
    assert hooks.remove(hooks.merge(settings, URL), URL) == settings
    assert hooks.remove(hooks.merge({}, URL), URL) == {}


def test_cli_previews_by_default_and_backs_up_on_apply(tmp_path, capsys):
    target = tmp_path / ".claude" / "settings.local.json"
    target.parent.mkdir()
    target.write_text(json.dumps({"model": "sonnet"}))
    assert hooks.main(["--project", str(tmp_path)]) == 0
    assert json.loads(target.read_text()) == {"model": "sonnet"}
    assert hooks.main(["--project", str(tmp_path), "--apply"]) == 0
    written = json.loads(target.read_text())
    assert written["model"] == "sonnet" and "SessionEnd" in written["hooks"]
    assert list(target.parent.glob("settings.local.json.agentville-bak-*"))
    assert hooks.main(["--project", str(tmp_path), "--remove", "--apply"]) == 0
    assert json.loads(target.read_text()) == {"model": "sonnet"}
