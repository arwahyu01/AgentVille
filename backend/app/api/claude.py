"""Receiver for Claude Code HTTP hooks, plus the session list the office draws."""
from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy.orm import Session

from app.claude_sessions import apply_hook, visible_sessions
from app.database import get_db

router = APIRouter(prefix="/claude", tags=["claude"])

# Set by AgentVille's own Claude provider runs (forwarded by the hook config as a header): those
# runs are already drawn as the AgentVille agent doing the step, so they get no second figure.
INTERNAL_HEADER = "x-agentville-run"


@router.post("/hooks", status_code=204)
async def receive_hook(request: Request, db: Session = Depends(get_db)) -> Response:
    # Claude Code treats any 2xx with an empty body as success, and a connection failure or non-2xx
    # as a non-blocking error, so this endpoint can never stall or block a Claude session.
    if request.headers.get(INTERNAL_HEADER, "").strip():
        return Response(status_code=204)
    try:
        payload = await request.json()
    except ValueError:
        return Response(status_code=204)
    if isinstance(payload, dict) and apply_hook(db, payload) is not None:
        db.commit()
    return Response(status_code=204)


@router.get("/sessions")
def list_sessions(db: Session = Depends(get_db)) -> dict:
    return {"sessions": visible_sessions(db)}
