"""Database operations for external account connections.

Every token is sealed before it reaches the database and only unsealed in memory when a
read-only verification needs it. Summaries returned to the UI contain no secret material.
"""

import secrets
from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from app import integrations
from app.agent_actions import redact
from app.integrations import oauth, secure_store
from app.models import IntegrationAccount, OAuthState

STATE_TTL_S = 600


def summaries(db: Session) -> list[dict]:
    return [_summary(row) for row in db.query(IntegrationAccount).order_by(IntegrationAccount.id).all()]


def _summary(row: IntegrationAccount) -> dict:
    return {
        "id": row.id,
        "provider": row.provider,
        "label": row.label,
        "external_id": row.external_id,
        "status": row.status,
        "scopes": row.scopes,
        "expires_at": row.expires_at.isoformat() if row.expires_at else None,
        "verified_at": row.verified_at.isoformat() if row.verified_at else None,
        "has_refresh_token": bool(row.refresh_token),
        "last_error": redact(row.last_error, 200),
        "created_at": row.created_at.isoformat() if row.created_at else None,
    }


def status(db: Session) -> dict:
    return {
        "configured": {name: oauth.configured(name) for name in oauth.PROVIDERS},
        "storage": "dpapi" if secure_store.available() else "unavailable",
        "redirect_uri": oauth.redirect_uri(),
        "accounts": summaries(db),
        "note": "Koneksi hanya menyimpan akses. Posting/upload tetap butuh persetujuan manusia.",
    }


def start(db: Session, provider: str) -> dict:
    if provider not in oauth.PROVIDERS:
        raise ValueError("Platform tidak dikenal")
    if not secure_store.available():
        raise RuntimeError("Penyimpanan token terenkripsi tidak tersedia di sistem ini")
    state = secrets.token_urlsafe(32)
    redirect = oauth.redirect_uri()
    # Build the URL first: an unconfigured OAuth app must not leave an orphan state row.
    auth_url = oauth.auth_url(provider, state)
    db.add(OAuthState(state=state, provider=provider, redirect_uri=redirect))
    db.commit()
    return {"provider": provider, "state": state, "auth_url": auth_url,
            "redirect_uri": redirect}


def _consume_state(db: Session, provider: str, state: str) -> None:
    row = db.get(OAuthState, state)
    if row is None or row.provider != provider or row.used:
        raise ValueError("State OAuth tidak valid atau sudah dipakai")
    if row.created_at.tzinfo is None:
        row.created_at = row.created_at.replace(tzinfo=timezone.utc)
    if datetime.now(timezone.utc) - row.created_at > timedelta(seconds=STATE_TTL_S):
        raise ValueError("State OAuth kedaluwarsa; ulangi dari awal")
    row.used = 1
    db.commit()


def save(db: Session, provider: str, access_token: str, refresh_token: str = "",
         label: str = "", external_id: str = "", scopes: str = "",
         expires_at: datetime | None = None, state: str | None = None) -> dict:
    """Create or replace one connection. The plaintext token never leaves this function."""
    if provider not in oauth.PROVIDERS:
        raise ValueError("Platform tidak dikenal")
    if not secure_store.available():
        raise RuntimeError("Penyimpanan token terenkripsi tidak tersedia di sistem ini")
    access_token = (access_token or "").strip()
    if not access_token or len(access_token) > 8192:
        raise ValueError("Token tidak valid")
    if state:
        _consume_state(db, provider, state)
    info = oauth.profile(provider, access_token)
    external_id = (external_id or info["external_id"])[:160]
    label = (label or info["label"])[:160]
    access_token = info.get("access_token") or access_token
    row = (db.query(IntegrationAccount)
           .filter(IntegrationAccount.provider == provider,
                   IntegrationAccount.external_id == external_id).first())
    if row is None:
        row = IntegrationAccount(provider=provider, external_id=external_id)
        db.add(row)
    row.label = label
    row.token = secure_store.seal(access_token)
    row.refresh_token = secure_store.seal(refresh_token)
    row.scopes = (scopes or oauth.PROVIDERS[provider]["scope"])[:2000]
    row.status = "connected"
    row.expires_at = expires_at
    row.verified_at = datetime.now(timezone.utc)
    row.last_error = ""
    db.commit()
    db.refresh(row)
    return _summary(row)


def complete(db: Session, provider: str, code: str, state: str) -> dict:
    if provider not in oauth.PROVIDERS:
        raise ValueError("Platform tidak dikenal")
    _consume_state(db, provider, state)
    tokens = oauth.exchange(provider, code)
    return save(db, provider, tokens["access_token"], tokens["refresh_token"],
                scopes=tokens["scopes"], expires_at=tokens["expires_at"])


def verify(db: Session, account_id: int) -> dict:
    row = db.get(IntegrationAccount, account_id)
    if row is None:
        raise ValueError("Koneksi tidak ditemukan")
    try:
        info = oauth.profile(row.provider, secure_store.unseal(row.token))
        row.label = (info.get("label") or row.label)[:160]
        row.status = "connected"
        row.last_error = ""
        row.verified_at = datetime.now(timezone.utc)
    except (oauth.OAuthError, RuntimeError) as e:
        row.status = "needs_attention"
        row.last_error = redact(str(e), 200)
    db.commit()
    db.refresh(row)
    return _summary(row)


def disconnect(db: Session, account_id: int) -> None:
    row = db.get(IntegrationAccount, account_id)
    if row is not None:
        db.delete(row)
        db.commit()
