"""Confined agent workspace.

Path confinement is defense-in-depth at application level (canonicalization + prefix
check + reparse-point refusal), not an OS security boundary — documented as such.
"""

import os
import stat
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_WORKSPACE_ROOT = PROJECT_ROOT / "data" / "workspace"


class WorkspaceError(Exception):
    pass


def resolve_root(override: str | None = None) -> Path:
    root = Path(override) if override else DEFAULT_WORKSPACE_ROOT
    root = root.resolve()
    root.mkdir(parents=True, exist_ok=True)
    return root


def _is_reparse(path: Path) -> bool:
    attrs = getattr(path.stat(), "st_file_attributes", 0) if path.exists() else 0
    return bool(attrs & stat.FILE_ATTRIBUTE_REPARSE_POINT) if hasattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT") else False


def _reject_reparse_chain(root: Path, candidate: Path) -> None:
    try:
        relative = candidate.relative_to(root)
    except ValueError:
        return
    cursor = root
    for part in relative.parts:
        cursor = cursor / part
        if cursor.exists() and _is_reparse(cursor):
            raise WorkspaceError(f"Path component '{cursor.name}' is a symlink/junction; refused")


def safe_path(root: Path, requested: str | os.PathLike, *, for_write: bool = True) -> Path:
    """Canonicalize a requested path and refuse anything leaving the workspace root."""
    candidate = Path(requested)
    if not candidate.is_absolute():
        candidate = root / candidate
    try:
        resolved = candidate.resolve()
    except OSError as e:
        raise WorkspaceError(f"Cannot resolve path: {e}")
    root = root.resolve()
    if resolved != root and root not in resolved.parents:
        raise WorkspaceError(f"Path escapes the workspace: {requested}")
    _reject_reparse_chain(root, resolved)
    if for_write:
        parent = resolved.parent
        if parent != root and root not in parent.parents:
            raise WorkspaceError(f"Parent directory escapes the workspace: {requested}")
    return resolved
