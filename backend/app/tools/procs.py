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

log = logging.getLogger(__name__)

TASKKILL_TIMEOUT_S = 15
DRAIN_GRACE_S = 10.0


def wait_for_drain(reader: threading.Thread, grace_s: float = DRAIN_GRACE_S) -> bool:
    """Wait until the communicate() reader thread exits, which only happens when stdout
    and stderr reached EOF — i.e. every process holding the inherited pipe handles is
    gone. False means a survivor may still write into the workspace or hold the pipes,
    and the caller must say so instead of returning a clean-looking timeout result."""
    if reader.is_alive():
        reader.join(grace_s)
    return not reader.is_alive()


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
