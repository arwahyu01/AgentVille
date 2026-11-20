"""Account connection endpoints.

No endpoint here publishes, uploads or changes anything on an external platform. The OAuth
callback page only displays a one-time code for the user to paste back — it never stores a
token by itself, and it cannot be used without the matching single-use state.
"""

import html

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.database import get_db
from app.integrations import service
from app.integrations.oauth import OAuthError

router = APIRouter(prefix="/integrations", tags=["integrations"])


@router.get("")
def integration_status(db: Session = Depends(get_db)):
    return service.status(db)


@router.get("/oauth/return")
def oauth_return(code: str = "", state: str = "", error: str = ""):
    """Landing page for the registered redirect URI. Shows the code, stores nothing."""
    from fastapi.responses import HTMLResponse

    body = (f"<h1>Authorisasi selesai</h1>"
            f"<p>Salin kode di bawah ke panel Integrasi AgentVille, lalu tutup halaman ini.</p>"
            f"<pre>{html.escape(code)}</pre>"
            f"<small>state: {html.escape(state)}</small>")
    if error:
        body += f"<p>Penyedia melaporkan: {html.escape(error[:160])}</p>"
    return HTMLResponse(f"<!doctype html><meta charset='utf-8'><title>Integrasi AgentVille</title>{body}")


class StartRequest(BaseModel):
    provider: str = Field(pattern="^(instagram|youtube|meta_ads)$")


@router.post("/start")
def start_connection(payload: StartRequest, db: Session = Depends(get_db)):
    try:
        return service.start(db, payload.provider)
    except (ValueError, RuntimeError, OAuthError) as e:
        raise HTTPException(status_code=400, detail=str(e)) from None


class CompleteRequest(BaseModel):
    provider: str = Field(pattern="^(instagram|youtube|meta_ads)$")
    code: str = Field(min_length=1, max_length=512)
    state: str = Field(min_length=1, max_length=120)


@router.post("/complete")
def complete_connection(payload: CompleteRequest, db: Session = Depends(get_db)):
    try:
        return service.complete(db, payload.provider, payload.code, payload.state)
    except (ValueError, RuntimeError, OAuthError) as e:
        raise HTTPException(status_code=400, detail=str(e)) from None


class SaveRequest(BaseModel):
    provider: str = Field(pattern="^(instagram|youtube|meta_ads)$")
    access_token: str = Field(min_length=1, max_length=8192)
    refresh_token: str = Field(default="", max_length=8192)
    label: str = Field(default="", max_length=160)
    external_id: str = Field(default="", max_length=160)


@router.post("/save")
def save_connection(payload: SaveRequest, db: Session = Depends(get_db)):
    try:
        return service.save(db, payload.provider, payload.access_token,
                            payload.refresh_token, payload.label, payload.external_id)
    except (ValueError, RuntimeError, OAuthError) as e:
        raise HTTPException(status_code=400, detail=str(e)) from None


@router.post("/{account_id}/verify")
def verify_connection(account_id: int, db: Session = Depends(get_db)):
    try:
        return service.verify(db, account_id)
    except (ValueError, RuntimeError) as e:
        raise HTTPException(status_code=400, detail=str(e)) from None


@router.post("/{account_id}/disconnect")
def disconnect_connection(account_id: int, db: Session = Depends(get_db)):
    try:
        service.disconnect(db, account_id)
    except (ValueError, RuntimeError) as e:
        raise HTTPException(status_code=400, detail=str(e)) from None
    return {"ok": True}
