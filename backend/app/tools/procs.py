"""Kills a subprocess together with everything it spawned.

Custodian CLIs like opencode/qodercli launch tool children of their own, and on
Windows a venv ``python.exe`` is only a stub whose real interpreter runs as its
child. Killing just the pid we hold would leave those children writing into the
workspace and keeping inherited pipe handles open, so ``communicate()`` never
returns.

Windows gets two layers: ``taskkill /T /F`` for the tree, then an in-process
TerminateProcess sweep of the subtree. The second layer exists because taskkill
can be missing or denied, and its failure used to be discarded silently.
"""

import ctypes
import ctypes.wintypes as wt
import logging
import os
import subprocess
import sys
import threading
import time

log = logging.getLogger(__name__)

TASKKILL_TIMEOUT_S = 15
DRAIN_GRACE_S = 10.0
PIPE_RECLAIM_S = 20.0
# A CLI that produced no output at all for this long is not working, it is stuck on
# something invisible (a dead model, an auth prompt, a provider that never streams). Waiting
# for the full request timeout turns one bad engine into a twenty-minute silence.
DEFAULT_IDLE_S = 120.0


class OutputPump:
    """Reads a CLI's stdout/stderr line by line so liveness is observable.

    `subprocess.communicate()` only returns when both pipes reach EOF, which made a silent
    engine indistinguishable from a busy one: the step stayed `running` until the whole
    timeout expired. This pump records the last time any output arrived and keeps whatever
    was captured, so a stuck engine can be stopped early and its partial output still read.

    A process object without readable pipes falls back to `communicate()`. Cancellation and
    the overall timeout still apply there; only per-line idle detection is unavailable.
    """

    MAX_BYTES = 4_000_000

    def __init__(self, proc, prompt: str = ""):
        self._proc = proc
        self._prompt = prompt
        self._out: list[str] = []
        self._err: list[str] = []
        self._size = 0
        self._lock = threading.Lock()
        self.last_activity = time.monotonic()
        streams = getattr(proc, "stdout", None) is not None and getattr(proc, "stderr", None) is not None
        self.feeds_stdin = streams
        if streams:
            self._threads = [
                threading.Thread(target=self._pump, args=(proc.stdout, self._out), daemon=True),
                threading.Thread(target=self._pump, args=(proc.stderr, self._err), daemon=True),
            ]
        else:
            self._threads = [threading.Thread(target=self._communicate, daemon=True)]

    def start(self) -> "OutputPump":
        for thread in self._threads:
            thread.start()
        return self

    def _communicate(self) -> None:
        try:
            out, err = self._proc.communicate(input=self._prompt)
        except Exception:  # noqa: BLE001 - a closed pipe is a normal ending
            return
        with self._lock:
            self._out.append(out or "")
            self._err.append(err or "")
            self.last_activity = time.monotonic()

    def _pump(self, stream, sink: list[str]) -> None:
        if stream is None:
            return
        try:
            for line in stream:
                with self._lock:
                    self.last_activity = time.monotonic()
                    if self._size < self.MAX_BYTES:
                        sink.append(line)
                        self._size += len(line)
        except Exception:  # noqa: BLE001 - a closed pipe is a normal ending
            pass

    def is_alive(self) -> bool:
        return any(thread.is_alive() for thread in self._threads)

    def join(self, timeout: float | None = None) -> None:
        for thread in self._threads:
            thread.join(timeout)

    def text(self) -> tuple[str, str]:
        with self._lock:
            return "".join(self._out), "".join(self._err)


def reap(proc, timeout_s: float = 5.0) -> int | None:
    """Collect the child's exit status once its output has reached EOF.

    The reader can see EOF a moment before the OS reaps the process, so `returncode` is
    still ``None`` at that point. Comparing ``None != 0`` used to mark a successful run as
    failed, and the error text was the first 300 characters of the NDJSON stream — which is
    how a perfectly good answer became "opencode exited with code None". ``None`` here means
    "not observable", never "non-zero"."""
    wait = getattr(proc, "wait", None)
    if callable(wait):
        try:
            wait(timeout=timeout_s)
        except Exception:  # noqa: BLE001 - a fake or already-reaped process
            pass
    return getattr(proc, "returncode", None)


def wait_for_drain(reader, grace_s: float = DRAIN_GRACE_S) -> bool:
    """Wait until the reader (thread or pump) exits, which only happens when stdout and
    stderr reached EOF — i.e. every process holding the inherited pipe handles is gone.
    False means a survivor may still write into the workspace or hold the pipes, and the
    caller must say so instead of returning a clean-looking timeout result."""
    if reader.is_alive():
        reader.join(grace_s)
    return not reader.is_alive()


def watch_run(proc, reader, deadline: float, should_cancel=None,
              grace_s: float = PIPE_RECLAIM_S,
              idle_s: float | None = None, activity=None) -> str:
    """Watch a running CLI and the reader draining its output.

    Returns ``"finished"``, ``"cancelled"``, ``"timeout"`` or ``"idle"``.

    Two failure modes are handled that used to look like a busy engine:

    * **silence** — the process is alive but has said nothing for `idle_s` seconds. It is
      killed and reported as `idle`, so a dead/unreachable model fails in ~2 minutes instead
      of consuming the entire request timeout.
    * **exited but pipes still open** — a descendant inherited the handles. The tree is
      killed once; if the pipes remain open the reader is abandoned with its captured
      output instead of blocking the step forever.
    """
    reclaimed = False
    main_done_at: float | None = None
    while reader.is_alive():
        if should_cancel is not None and should_cancel():
            kill_tree(proc.pid)
            return "cancelled"
        now = time.monotonic()
        if now > deadline:
            kill_tree(proc.pid)
            return "timeout"
        last = activity() if activity is not None else getattr(reader, "last_activity", None)
        poll = getattr(proc, "poll", None)
        exited = poll() if callable(poll) else None
        if idle_s and exited is None and last is not None and now - last > idle_s:
            log.warning("pid %s produced no output for %.0fs; stopping it", proc.pid, idle_s)
            kill_tree(proc.pid)
            return "idle"
        if exited is not None:
            if main_done_at is None:
                main_done_at = now
            if not reclaimed and now - main_done_at >= grace_s:
                reclaimed = True
                log.info("pid %s exited but its output pipes are still open; "
                         "reclaiming leftover descendants so the step can finish",
                         proc.pid)
                kill_tree(proc.pid)
                reader.join(2.0)
                if reader.is_alive():
                    # The handles are held by something we can no longer reach; the text we
                    # already captured is the result, and the caller is told it is partial.
                    log.warning("pid %s pipes are still open; continuing with captured output",
                                proc.pid)
                    return "finished"
        else:
            main_done_at = None
        reader.join(0.5)
    return "finished"


def kill_tree(pid: int) -> bool:
    """Terminate ``pid`` and everything it spawned. True if termination was issued."""
    if pid == os.getpid():
        log.error("refusing to kill our own process (pid %s)", pid)
        return False
    if sys.platform == "win32":
        return _kill_tree_windows(pid)
    return _kill_tree_posix(pid)


def _taskkill_tree(pid: int) -> bool:
    try:
        done = subprocess.run(
            ["taskkill", "/PID", str(pid), "/T", "/F"],
            capture_output=True,
            text=True,
            errors="replace",
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            shell=False,
            check=False,
            timeout=TASKKILL_TIMEOUT_S,
        )
    except (OSError, subprocess.SubprocessError) as e:
        log.warning("taskkill unavailable for pid %s: %s", pid, e)
        return False
    if done.returncode == 0:
        return True
    log.warning("taskkill pid %s exited %s: %s", pid, done.returncode,
                (done.stdout or done.stderr or "").strip()[:200])
    return False


def _kill_tree_posix(pid: int) -> bool:
    import signal

    try:
        pgid = os.getpgid(pid)
    except ProcessLookupError:
        return True
    except PermissionError as e:
        log.warning("cannot read process group of pid %s: %s", pid, e)
        return False
    if pgid == os.getpgid(os.getpid()):
        # Caller did not detach the child, so it shares our group: killpg would
        # SIGKILL this process as well.
        log.warning("pid %s is in our own process group; killing it alone", pid)
        return _kill_posix(pid, signal.SIGKILL)
    try:
        os.killpg(pgid, signal.SIGKILL)
        return True
    except ProcessLookupError:
        return True
    except OSError as e:
        log.warning("killpg(%s) failed: %s; killing pid alone", pgid, e)
        return _kill_posix(pid, signal.SIGKILL)


def _kill_posix(pid: int, sig: int) -> bool:
    try:
        os.kill(pid, sig)
        return True
    except ProcessLookupError:
        return True
    except OSError as e:
        log.warning("signal %s for pid %s failed: %s", sig, pid, e)
        return False


if sys.platform == "win32":
    _PROCESS_TERMINATE = 0x0001
    _PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
    _ERROR_ACCESS_DENIED = 5
    _STILL_ACTIVE = 259
    _TH32CS_SNAPPROCESS = 0x00000002
    _INVALID_HANDLE = -1

    class _PROCESSENTRY32W(ctypes.Structure):
        _fields_ = [
            ("dwSize", wt.DWORD),
            ("cntUsage", wt.DWORD),
            ("th32ProcessID", wt.DWORD),
            ("th32DefaultHeapID", ctypes.c_size_t),
            ("th32ModuleID", wt.DWORD),
            ("cntThreads", wt.DWORD),
            ("th32ParentProcessID", wt.DWORD),
            ("pcPriClassBase", ctypes.c_long),
            ("dwFlags", wt.DWORD),
            ("szExeFile", ctypes.c_wchar * 260),
        ]

    _k32 = ctypes.windll.kernel32
    _k32.CreateToolhelp32Snapshot.restype = ctypes.c_ssize_t
    _k32.CreateToolhelp32Snapshot.argtypes = [wt.DWORD, wt.DWORD]
    _k32.Process32FirstW.restype = wt.BOOL
    _k32.Process32FirstW.argtypes = [ctypes.c_void_p, ctypes.POINTER(_PROCESSENTRY32W)]
    _k32.Process32NextW.restype = wt.BOOL
    _k32.Process32NextW.argtypes = [ctypes.c_void_p, ctypes.POINTER(_PROCESSENTRY32W)]
    _k32.CloseHandle.restype = wt.BOOL
    _k32.CloseHandle.argtypes = [wt.HANDLE]
    _k32.OpenProcess.restype = wt.HANDLE
    _k32.OpenProcess.argtypes = [wt.DWORD, wt.BOOL, wt.DWORD]
    _k32.TerminateProcess.restype = wt.BOOL
    _k32.TerminateProcess.argtypes = [wt.HANDLE, ctypes.c_uint]
    _k32.GetExitCodeProcess.restype = wt.BOOL
    _k32.GetExitCodeProcess.argtypes = [wt.HANDLE, ctypes.POINTER(wt.DWORD)]

    def _pid_exists(pid: int) -> bool:
        handle = _k32.OpenProcess(_PROCESS_QUERY_LIMITED_INFORMATION, False, pid)
        if not handle:
            # Access denied means the process is there but we may not query it.
            return ctypes.GetLastError() == _ERROR_ACCESS_DENIED
        try:
            code = wt.DWORD()
            if not _k32.GetExitCodeProcess(handle, ctypes.byref(code)):
                return True
            return code.value == _STILL_ACTIVE
        finally:
            _k32.CloseHandle(handle)

    def _child_map() -> dict[int, list[int]]:
        snap = _k32.CreateToolhelp32Snapshot(_TH32CS_SNAPPROCESS, 0)
        if snap == _INVALID_HANDLE:
            log.warning("CreateToolhelp32Snapshot failed: %s", ctypes.GetLastError())
            return {}
        entry = _PROCESSENTRY32W()
        entry.dwSize = ctypes.sizeof(_PROCESSENTRY32W)
        children: dict[int, list[int]] = {}
        try:
            ok = _k32.Process32FirstW(snap, ctypes.byref(entry))
            while ok:
                children.setdefault(int(entry.th32ParentProcessID), []).append(
                    int(entry.th32ProcessID))
                ok = _k32.Process32NextW(snap, ctypes.byref(entry))
        finally:
            _k32.CloseHandle(snap)
        return children

    def _descendants(pid: int) -> list[int]:
        """Descendant pids of ``pid``, deepest first, never including ourselves."""
        children = _child_map()
        order: list[int] = []
        seen = {pid}

        def walk(parent: int) -> None:
            for child in children.get(parent, ()):
                if child in seen or child == os.getpid():
                    continue
                seen.add(child)
                walk(child)
                order.append(child)

        walk(pid)
        return order

    def _terminate_pid(pid: int) -> bool:
        handle = _k32.OpenProcess(_PROCESS_TERMINATE, False, pid)
        if not handle:
            return False
        try:
            if not _k32.TerminateProcess(handle, 1):
                log.warning("TerminateProcess pid %s failed: %s", pid, ctypes.GetLastError())
                return False
            return True
        finally:
            _k32.CloseHandle(handle)

    def _kill_tree_windows(pid: int) -> bool:
        if not _pid_exists(pid):
            # Nothing to kill — and no sweep, so a pid recycled by an unrelated process
            # is never a victim.
            return True
        if _taskkill_tree(pid):
            return True
        for child in _descendants(pid):
            _terminate_pid(child)
        _terminate_pid(pid)
        alive = _pid_exists(pid)
        if alive:
            log.warning("pid %s survived both taskkill and TerminateProcess", pid)
        return not alive
