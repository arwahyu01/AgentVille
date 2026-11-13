import subprocess
import threading
import time
from dataclasses import dataclass

from app.tools.procs import kill_tree, wait_for_drain

DEFAULT_ALLOWLIST = {"git", "npm", "npx", "node", "pytest", "python", "py", "pip", "pip3"}
MAX_OUTPUT_BYTES = 100_000


class CommandNotAllowed(Exception):
    pass


@dataclass
class CommandResult:
    ok: bool
    exit_code: int
    stdout: str
    stderr: str
    timed_out: bool = False
    truncated: bool = False


def _exe_key(argv0: str) -> str:
    name = argv0.replace("\\", "/").rsplit("/", 1)[-1].lower()
    if name.endswith(".exe"):
        name = name[:-4]
    return name


def run_command(argv: list[str], cwd, timeout_s: int = 120,
                allowlist: set[str] | None = None,
                max_output_bytes: int = MAX_OUTPUT_BYTES) -> CommandResult:
    """Allowlisted, argv-only (no shell) execution with bounded output. Everything that
    runs here is expected to be logged by the caller as an audit event."""
    if not argv:
        raise CommandNotAllowed("empty command")
    allowed = allowlist if allowlist is not None else DEFAULT_ALLOWLIST
    if _exe_key(argv[0]) not in allowed:
        raise CommandNotAllowed(f"command not in allowlist: {argv[0]}")
    proc = subprocess.Popen(
        argv, cwd=str(cwd), stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        text=True, encoding="utf-8", errors="replace", shell=False,
        start_new_session=True,
    )
    # communicate() runs in a thread so a chatty child can never deadlock on full pipes.
    box: dict = {}

    def _drain() -> None:
        box["io"] = proc.communicate()

    reader = threading.Thread(target=_drain, daemon=True)
    reader.start()
    deadline = time.monotonic() + timeout_s
    timed_out = False
    while reader.is_alive():
        if time.monotonic() > deadline:
            kill_tree(proc.pid)
            timed_out = True
            break
        reader.join(0.2)
    drained = wait_for_drain(reader)
    stdout, stderr = box.get("io", ("", ""))
    stdout, stderr = stdout or "", stderr or ""
    if not drained:
        # Pipes never closed => something in the tree survived the kill and could still
        # write to the workspace. Say so loudly instead of returning a tidy timeout result.
        stderr += ("\nagentville: pipe drain incomplete after kill — the process tree may "
                   "still be running and touching the workspace")
        return CommandResult(ok=False, exit_code=-1, stdout=stdout, stderr=stderr,
                             timed_out=True, truncated=False)
    truncated = len(stdout.encode("utf-8", "replace")) > max_output_bytes
    if truncated:
        stdout = stdout[:max_output_bytes] + "\n… output truncated …"
    return CommandResult(ok=proc.returncode == 0 and not timed_out,
                         exit_code=proc.returncode if proc.returncode is not None else -1,
                         stdout=stdout, stderr=stderr, timed_out=timed_out, truncated=truncated)
