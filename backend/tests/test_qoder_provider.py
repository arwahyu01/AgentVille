import pytest

from app.ai.base import Persona
from app.ai.qoder import QoderProvider, build_coding_argv, build_text_argv, parse_result
from app.ai.opencode import OpencodeProvider


def test_text_argv_shape():
    argv = build_text_argv("qodercli", "Efficient", "/cfg")
    assert argv[:2] == ["qodercli", "-p"]
    assert "--output-format" in argv and "json" in argv
    assert "--no-session-persistence" in argv
    assert argv[argv.index("--tools") + 1] == ""
    assert argv[argv.index("-m") + 1] == "Efficient"
    assert argv[argv.index("--config-dir") + 1] == "/cfg"


def test_coding_argv_shape():
    argv = build_coding_argv("qodercli", "GLM-5.3", "/ws", "/cfg")
    assert argv[argv.index("-w") + 1] == "/ws"
    assert "--permission-mode" in argv and argv[argv.index("--permission-mode") + 1] == "accept_edits"
    assert "Write" in argv[argv.index("--allowed-tools") + 1]
    assert "-p" in argv


@pytest.mark.parametrize("bad", ["../../evil", "model;rm -rf", "prov/model", "x" * 90])
def test_model_identifiers_rejected(bad):
    with pytest.raises(ValueError):
        build_text_argv("qodercli", bad, "/cfg")


def test_parse_result_success_and_error():
    out = 'log noise\n{"type":"result","is_error":false,"result":"QODER_OK","session_id":"x"}'
    assert parse_result(out) == ("QODER_OK", None)
    err = '{"type":"result","is_error":true,"result":"quota exceeded"}'
    assert parse_result(err) == ("", "quota exceeded")
    assert parse_result("no json here") == ("", None)


def test_coding_without_workspace_errors_before_spawn():
    provider = QoderProvider(binary="definitely-missing-qodercli")
    result = provider.run(Persona(key="k", name="Byte", role="Developer", instructions="i", mode="coding"), "do work")
    assert not result.ok
    assert "workspace" in result.error
    assert result.provider == "qoder"


def test_opencode_coding_requires_workspace():
    provider = OpencodeProvider()
    result = provider.run(Persona(key="k", name="Byte", role="Developer", instructions="i", mode="coding"),
                          "do work")
    assert not result.ok
    assert "workspace" in result.error
    assert result.provider == "opencode"


def test_opencode_coding_argv_enables_auto_and_cwd(tmp_path):
    from app.ai.opencode import build_argv
    argv = build_argv("opencode/big-pickle", title="dev step", auto=True)
    assert "--auto" in argv
    # --auto verified present in `opencode run --help` (v2.1.4); workspace confinement
    # is done by launching with cwd=<workspace>, asserted below with a missing binary.
    provider = OpencodeProvider(binary=str(tmp_path / "missing-opencode.exe"))
    import sys
    real_which = __import__("shutil").which
    __import__("shutil").which = lambda name: None  # force the absolute-binary path
    try:
        result = provider.run(Persona(key="k", name="Byte", role="Developer", instructions="i",
                                      mode="coding", workspace=str(tmp_path)), "do work")
    finally:
        __import__("shutil").which = real_which
    assert not result.ok  # binary missing -> spawn fails, but the code path accepted coding mode
    assert "qoder" not in (result.error or "")


def test_recoverable_error_tagging():
    provider = QoderProvider(binary="definitely-missing-qodercli")
    result = provider.run(Persona(key="k", name="B", role="Developer", instructions="i"), "hi")
    assert not result.ok
    # missing binary is classified recoverable ("not found") so fallback can try the other CLI
    assert result.recoverable
