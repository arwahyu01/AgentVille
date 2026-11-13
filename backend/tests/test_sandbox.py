import os
import shutil
import subprocess
import sys
import time

import pytest

from app.tools.procs import kill_tree
from app.tools.repo import capture_diff, ensure_git
from app.tools.sandbox_exec import CommandNotAllowed, run_command
from app.tools.workspace import WorkspaceError, resolve_root, safe_path


@pytest.fixture
def ws(tmp_path):
    root = tmp_path / "workspace"
    root.mkdir()
    return root


def test_safe_path_blocks_escapes(ws):
    assert safe_path(ws, "src/app.py") == (ws / "src/app.py").resolve()
    with pytest.raises(WorkspaceError):
        safe_path(ws, "../outside.txt")
    with pytest.raises(WorkspaceError):
        safe_path(ws, str(ws.parent / "sibling.txt"))
    inside_abs = ws / "ok" / "file.txt"
    assert safe_path(ws, str(inside_abs)).parent == inside_abs.resolve().parent


def test_safe_path_rejects_symlink_escape(ws, tmp_path):
    outside = tmp_path / "elsewhere"
    outside.mkdir()
    link = ws / "escape"
    try:
        link.symlink_to(outside)
    except (OSError, NotImplementedError):
        pytest.skip("symlinks require extra privileges on this Windows setup")
    with pytest.raises(WorkspaceError):
        safe_path(ws, "escape/secret.txt")


def test_run_command_allowlist_and_output(ws):
    result = run_command([sys.executable, "-c", "print('hello')"], cwd=ws, timeout_s=20)
    assert result.ok and "hello" in result.stdout
    with pytest.raises(CommandNotAllowed):
        run_command(["rm", "-rf", "/"], cwd=ws)
    big = run_command([sys.executable, "-c", "print('x'*5000)"], cwd=ws, timeout_s=20,
                      max_output_bytes=500)
    assert big.truncated and len(big.stdout) < 5000


def test_run_command_timeout_kills_tree(ws):
    proc_ws = ws
    start = time.monotonic()
    result = run_command([sys.executable, "-c", "import time; time.sleep(30)"], cwd=proc_ws, timeout_s=1)
    elapsed = time.monotonic() - start
    assert result.timed_out
    assert result.exit_code != 0
    assert elapsed < 5


# A root that sleeps while its child sleeps too: the child inherits our stdout pipe, so
# reading it only reaches EOF once the whole tree is gone. Proves descendants die, not
# just the pid we hold. Short sleeps so a failure cannot leak a long-lived process.
_TREE_SCRIPT = (
    "import subprocess, sys, time\n"
    "subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(15)'])\n"
    "time.sleep(15)\n"
)


def _assert_tree_kill(kill):
    proc = subprocess.Popen([sys.executable, "-c", _TREE_SCRIPT],
                            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
    time.sleep(1.0)
    try:
        assert kill(proc.pid) is True
        proc.communicate(timeout=8)
    finally:
        if proc.poll() is None:
            kill_tree(proc.pid)


def test_kill_tree_terminates_grandchild():
    _assert_tree_kill(kill_tree)


@pytest.mark.skipif(sys.platform != "win32", reason="taskkill is the Windows tree layer")
def test_kill_tree_falls_back_when_taskkill_fails(monkeypatch):
    """taskkill denied/missing must not leave the tree running behind it."""
    from app.tools import procs

    monkeypatch.setattr(procs, "_taskkill_tree", lambda pid: False)
    _assert_tree_kill(procs.kill_tree)


def test_kill_tree_terminates_child():
    proc = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(60)"],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    assert kill_tree(proc.pid) is True
    proc.wait(timeout=5)
    assert proc.returncode != 0


def test_kill_tree_on_already_exited_pid_is_success():
    """Cancel racing a natural exit must not be reported as a failed kill."""
    proc = subprocess.Popen([sys.executable, "-c", "pass"],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    proc.wait(timeout=10)
    assert kill_tree(proc.pid) is True


@pytest.mark.skipif(sys.platform == "win32", reason="process groups are POSIX-only")
def test_run_command_child_owns_its_process_group(ws):
    """Without its own group, killpg in kill_tree would signal this test runner too."""
    result = run_command([sys.executable, "-c", "import os; print(os.getpgid(0))"],
                         cwd=ws, timeout_s=20)
    assert result.ok, result.stderr
    assert int(result.stdout.strip()) != os.getpgid(os.getpid())


@pytest.mark.skipif(not shutil.which("git"), reason="git not installed")
def test_repo_diff_captures_written_files(ws):
    assert ensure_git(ws)
    (ws / "index.html").write_text("<h1>Resto</h1>", encoding="utf-8")
    status, diff = capture_diff(ws)
    assert "index.html" in status
    assert "Resto" in diff
