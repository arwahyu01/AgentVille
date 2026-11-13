"""Deterministic proofs for Windows/POSIX process-tree termination.

These tests assert EOF on the inherited pipes and death of the grandchild — not merely
the parent's exit status — because a surviving descendant writing into the workspace is
exactly the failure the kill/drain path exists to prevent."""

import os
import subprocess
import sys
import threading
import time

import pytest

from app.tools.procs import kill_tree, wait_for_drain
from app.tools.sandbox_exec import run_command

CHILD_LOOP = (
    "import sys, time\n"
    "while True:\n"
    "    sys.stdout.write('tick\\n')\n"
    "    sys.stdout.flush()\n"
    "    time.sleep(0.2)\n"
)
GRANDPARENT = (
    "import subprocess, sys, time, pathlib\n"
    "child = subprocess.Popen([sys.executable, 'child_loop.py'],\n"
    "                         stdout=sys.stdout, stderr=sys.stderr)\n"
    "pathlib.Path('child_pid.txt').write_text(str(child.pid))\n"
    "child.wait()\n"
)


def _pid_alive(pid: int) -> bool:
    if sys.platform == "win32":
        from app.tools.procs import _pid_exists
        return _pid_exists(pid)
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False


def test_wait_for_drain_true_after_thread_exit():
    t = threading.Thread(target=lambda: None)
    t.start()
    t.join(1)
    assert wait_for_drain(t) is True


def test_wait_for_drain_false_for_live_thread():
    stop = threading.Event()
    t = threading.Thread(target=stop.wait, daemon=True)
    t.start()
    assert wait_for_drain(t, grace_s=0.1) is False
    stop.set()
    t.join(1)


@pytest.fixture
def tree_ws(tmp_path):
    (tmp_path / "child_loop.py").write_text(CHILD_LOOP)
    (tmp_path / "grandparent.py").write_text(GRANDPARENT)
    return tmp_path


def test_timeout_kills_tree_and_reaches_eof(tree_ws):
    """A grandchild writing forever to the inherited stdout must NOT keep the result
    open: after the kill, communicate() must hit EOF and the grandchild must be gone."""
    started = time.monotonic()
    result = run_command([sys.executable, "grandparent.py"], cwd=tree_ws, timeout_s=2)
    elapsed = time.monotonic() - started
    assert result.timed_out
    assert not result.ok
    assert "tick" in result.stdout  # output was captured, not lost
    assert "pipe drain incomplete" not in result.stderr  # drain proven, pipes closed
    assert elapsed < 25, "timed out fast, not blocked on surviving handles"
    child_pid = int((tree_ws / "child_pid.txt").read_text())
    deadline = time.monotonic() + 5
    while _pid_alive(child_pid) and time.monotonic() < deadline:
        time.sleep(0.1)
    assert not _pid_alive(child_pid), "grandchild survived the tree kill"


def test_kill_tree_reports_dead_pid():
    proc = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(30)"],
                            stdout=subprocess.DEVNULL)
    assert kill_tree(proc.pid) is True
    proc.wait(timeout=10)
    assert proc.returncode != 0 or proc.poll() is not None
