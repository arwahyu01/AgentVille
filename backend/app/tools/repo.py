"""Git helpers to capture what a coding step actually changed inside the workspace."""

import shutil
import subprocess
from pathlib import Path

MAX_DIFF_BYTES = 200_000


def _git(ws: Path, *args: str) -> subprocess.CompletedProcess:
    return subprocess.run(["git", "-C", str(ws), *args], capture_output=True,
                          text=True, encoding="utf-8", errors="replace", shell=False, timeout=60)


def ensure_git(ws: Path) -> bool:
    """Initialize the workspace repo (with an empty baseline commit) so diffs are meaningful."""
    if not shutil.which("git"):
        return False
    ws.mkdir(parents=True, exist_ok=True)
    if (ws / ".git").exists():
        return True
    if _git(ws, "init", "-q").returncode != 0:
        return False
    _git(ws, "config", "user.email", "agentville@local")
    _git(ws, "config", "user.name", "AgentVille")
    _git(ws, "commit", "-q", "--allow-empty", "-m", "baseline")
    return True


def capture_diff(ws: Path) -> tuple[str, str]:
    """Returns (status_summary, diff_text). Falls back to a file listing when git fails."""
    if not ensure_git(ws):
        files = sorted(str(p.relative_to(ws)).replace("\\", "/") for p in ws.rglob("*") if p.is_file())
        return "no-git", "\n".join(files)[:MAX_DIFF_BYTES]
    _git(ws, "add", "-A")
    status = _git(ws, "status", "--short").stdout.strip()
    diff = _git(ws, "diff", "--cached", "--", ".").stdout
    if len(diff) > MAX_DIFF_BYTES:
        diff = diff[:MAX_DIFF_BYTES] + "\n… diff truncated …"
    return status, diff


def workspace_fingerprint(ws: Path) -> str:
    """Content fingerprint of the workspace *without* committing anything.

    `git status` is not enough to tell whether a step changed a file that was already
    modified, so the staged tree hash is used instead. Staging is non-destructive and the
    worktree content is what matters; this never creates a commit."""
    try:
        if not ensure_git(ws):
            entries = sorted(
                f"{p.relative_to(ws).as_posix()}:{p.stat().st_size}:{p.stat().st_mtime_ns}"
                for p in ws.rglob("*") if p.is_file())
            return "files:" + "|".join(entries)[:20000]
        _git(ws, "add", "-A", "--", ".")
        tree = _git(ws, "write-tree").stdout.strip()
        return "tree:" + (tree or "unavailable")
    except Exception:  # noqa: BLE001 - an unreadable workspace must never crash a step
        return "unknown"


def workspace_changed_since(ws: Path | None, fingerprint: str | None) -> bool:
    """True when the step left files behind. Unknown baseline/failure means 'assume changed'
    so a coding retry is never started blindly."""
    if ws is None or not fingerprint:
        return True
    return workspace_fingerprint(ws) != fingerprint


def root_escape_snapshot(root: Path) -> dict[str, tuple[int, int]]:
    """Snapshot of the files sitting directly in the application repo root.

    A coding step that writes outside its approved workspace shows up here and nowhere
    else: the workspace fingerprint stays clean while `index.html`/`script.js`/
    `style.css` appear next to `README.md`. Directories are skipped so `data/`,
    `backend/.venv` and `frontend/node_modules` never make this expensive."""
    items: dict[str, tuple[int, int]] = {}
    try:
        for p in root.iterdir():
            if p.is_file():
                st = p.stat()
                items[p.name] = (st.st_size, st.st_mtime_ns)
    except Exception:  # noqa: BLE001 - an unreadable root must never crash a step
        pass
    return items


def root_escape_since(root: Path, snapshot: dict | None) -> tuple[list[str], list[str]]:
    """(created, modified) root-level files that appeared or changed since `snapshot`.

    Creation is the escape signature: a coding step told to work inside
    `data/workspace/project-<id>/` that instead drops `index.html` next to `README.md`
    shows up here and nowhere else. Modification is reported separately so an ordinary
    edit (README, notes) stays a visible warning instead of a false escape verdict."""
    if not snapshot:
        return [], []
    current = root_escape_snapshot(root)
    created = sorted(name for name in current if name not in snapshot)
    modified = sorted(name for name, sig in current.items()
                      if name in snapshot and snapshot[name] != sig)
    return created, modified


# -- isolated worktrees + explicit merge (concurrent coding tasks) -------------
#
# Two coding steps that might touch the same file must never write the same directory at
# once. Each gets its own git worktree/branch; a later integration stage merges the branch
# back and reports conflicts instead of silently overwriting a peer's work.


def git_available() -> bool:
    return bool(shutil.which("git"))


def add_worktree(base_ws: Path, name: str) -> tuple[str, Path] | tuple[None, None]:
    """Create branch/worktree for one coding task off the base workspace HEAD.
    Returns (branch_name, worktree_path) or (None, None) if git is unavailable/failed."""
    if not git_available() or not ensure_git(base_ws):
        return None, None
    safe = "".join(c if c.isalnum() or c in "-_" else "-" for c in name)[:80] or "task"
    branch = f"agentville/{safe}"
    wt = (base_ws.parent / f"{base_ws.name}--wt--{safe}").resolve()
    if wt.exists():
        _git(base_ws, "worktree", "remove", "--force", str(wt))
    result = _git(base_ws, "worktree", "add", "-B", branch, str(wt), "HEAD")
    if result.returncode != 0:
        return None, None
    return branch, wt


def commit_all(ws: Path, message: str) -> bool:
    """Stage everything and commit on the current branch. Returns True if a commit was made."""
    if not git_available() or not ensure_git(ws):
        return False
    _git(ws, "add", "-A")
    if _git(ws, "diff", "--cached", "--quiet").returncode == 0:
        return False
    return _git(ws, "commit", "-q", "-m", message[:400]).returncode == 0


def merge_branch(base_ws: Path, branch: str) -> tuple[bool, list[str]]:
    """Merge a task branch into the base workspace. On conflict the merge is aborted and the
    conflicting files are returned so the orchestrator can record and request resolution
    rather than clobbering another worker's changes."""
    if not git_available() or not ensure_git(base_ws):
        return (True, [])  # no-git: nothing to merge back; caller keeps the shared dir
    result = _git(base_ws, "merge", "--no-edit", branch)
    if result.returncode == 0:
        return (True, [])
    status = _git(base_ws, "status", "--porcelain").stdout
    conflicts = [line[3:].strip().replace("\\", "/")
                 for line in status.splitlines()
                 if line[:2] in ("UU", "AA", "DU", "UD", "AU", "UA")]
    _git(base_ws, "merge", "--abort")
    return (False, conflicts)


def remove_worktree(base_ws: Path, wt: Path) -> None:
    if git_available() and wt.exists():
        _git(base_ws, "worktree", "remove", "--force", str(wt))
