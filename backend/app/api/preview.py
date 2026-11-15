"""Show the office's actual deliverable.

The point of the office is the work it produces, not the paperwork around it. These
routes let the UI put the real artifact on screen: a built site in an iframe, an image,
a video, or a document. Files are served straight from the task's confined workspace,
so what you see is exactly what the crew wrote to disk.
"""

import mimetypes
from pathlib import Path
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app import settings_store
from app.database import get_db
from app.models import Task
from app.schemas import PreviewFile, PreviewRead
from app.tools.workspace import WorkspaceError, resolve_root, safe_path

router = APIRouter(tags=["preview"])

WEB_EXT = {".html", ".htm"}
IMAGE_EXT = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".avif", ".bmp"}
VIDEO_EXT = {".mp4", ".webm", ".ogg", ".mov", ".m4v"}
DOC_EXT = {".md", ".markdown", ".txt", ".pdf"}
TEXT_EXT = DOC_EXT | {".json", ".csv", ".py", ".ts", ".tsx", ".js", ".jsx", ".css", ".yml", ".yaml", ".toml"}
SKIP_DIRS = {".git", "node_modules", "__pycache__", ".venv", ".cache", ".pytest_cache"}

# A showcase should not drown in build output; cap what the gallery lists.
MAX_FILES = 300


def _anchor(task: Task, db: Session) -> Task:
    """Steps share the workspace of their parent run, so resolve to the anchor."""
    seen: set[int] = set()
    while task.parent_id is not None and task.id not in seen:
        seen.add(task.id)
        parent = db.get(Task, task.parent_id)
        if parent is None:
            break
        task = parent
    return task


def _workspace_dir(task: Task, db: Session) -> Path:
    anchor = _anchor(task, db)
    root = resolve_root(settings_store.get_setting(db, "workspace_root") or None)
    return root / f"project-{anchor.id}"


def _relative_files(base: Path) -> list[tuple[str, Path]]:
    found: list[tuple[str, Path]] = []
    if not base.exists():
        return found
    for path in base.rglob("*"):
        try:
            parts = path.relative_to(base).parts
        except ValueError:
            continue
        if any(part.startswith(".") or part in SKIP_DIRS for part in parts):
            continue
        if path.is_file():
            found.append(("/".join(parts), path))
            if len(found) >= MAX_FILES:
                break
    return found


def _pick(files: list[tuple[str, Path]], extensions: set[str]) -> list[tuple[str, Path]]:
    return [(rel, path) for rel, path in files if path.suffix.lower() in extensions]


def _best(files: list[tuple[str, Path]], *, prefer_name: str | None = None) -> tuple[str, Path] | None:
    if not files:
        return None
    if prefer_name is not None:
        for rel, path in files:
            if path.name.lower() == prefer_name:
                return rel, path
    # Shallowest first, then most recently written: the entry point is what the crew
    # touched last, not a stray fixture deep in a test folder.
    return sorted(files, key=lambda item: (item[0].count("/"), -item[1].stat().st_mtime))[0]


def build_preview(task: Task, db: Session) -> PreviewRead:
    base = _workspace_dir(task, db)
    if not base.exists():
        return PreviewRead(kind="none")

    files = _relative_files(base)
    if not files:
        return PreviewRead(kind="none")

    kinds: list[tuple[str, set[str]]] = [
        ("web", WEB_EXT),
        ("image", IMAGE_EXT),
        ("video", VIDEO_EXT),
        ("markdown", {".md", ".markdown"}),
        ("text", TEXT_EXT),
    ]
    kind = "none"
    entry: tuple[str, Path] | None = None
    for name, extensions in kinds:
        candidates = _pick(files, extensions)
        if candidates:
            kind = name
            entry = _best(candidates, prefer_name="index.html" if name == "web" else None)
            break

    if entry is None:
        return PreviewRead(kind="none")

    rel, path = entry
    try:
        size = path.stat().st_size
    except OSError:
        size = 0
    listing = [
        PreviewFile(path=rel_file, size=file.stat().st_size if file.exists() else 0)
        for rel_file, file in files
        if file.suffix.lower() in TEXT_EXT | WEB_EXT | IMAGE_EXT | VIDEO_EXT
    ][:60]
    return PreviewRead(
        kind=kind,
        entry=rel,
        url=f"/api/tasks/{task.id}/preview/{quote(rel, safe='/')}",
        size=size,
        files=listing,
    )


@router.get("/tasks/{task_id}/preview", response_model=PreviewRead)
def preview_meta(task_id: int, db: Session = Depends(get_db)):
    task = db.get(Task, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")
    return build_preview(task, db)


@router.get("/tasks/{task_id}/preview/{file_path:path}")
def preview_file(task_id: int, file_path: str, db: Session = Depends(get_db)):
    task = db.get(Task, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")
    base = _workspace_dir(task, db)
    if not base.exists():
        raise HTTPException(status_code=404, detail="No workspace for this task")
    try:
        target = safe_path(base, file_path, for_write=False)
    except WorkspaceError:
        raise HTTPException(status_code=404, detail="File not found")
    relative = target.relative_to(base.resolve())
    if any(part.startswith(".") or part in SKIP_DIRS for part in relative.parts):
        raise HTTPException(status_code=404, detail="File not found")
    if not target.is_file():
        raise HTTPException(status_code=404, detail="File not found")

    media_type, _ = mimetypes.guess_type(str(target))
    # A site preview must never be cached: the crew keeps rewriting these files.
    return FileResponse(
        target,
        media_type=media_type or "application/octet-stream",
        headers={"Cache-Control": "no-store, max-age=0"},
    )
