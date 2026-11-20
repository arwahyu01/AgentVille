"""Publish jobs with a mandatory, explicit human gate.

Preview and send are deliberately separate operations. Even when `external_approval_enabled`
is off, a publish job still needs `approve` then `execute`: these are real external changes and
the project contract never auto-approves them. The token is never copied into a job row.
"""

import json
import urllib.parse
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.agent_actions import redact
from app.integrations.secure_store import available as storage_available
from app.models import IntegrationAccount, PublishCredential, PublishJob
from app.publishing import dry24, instagram

PROVIDERS = ("dry24", "instagram")


class PublishError(RuntimeError):
    pass


def _load_article(value) -> dict:
    if isinstance(value, dict):
        article = value
    else:
        try:
            article = json.loads(value)
        except (json.JSONDecodeError, TypeError):
            raise PublishError("Payload artikel bukan JSON yang valid") from None
    if not isinstance(article, dict):
        raise PublishError("Payload artikel harus berupa objek JSON")
    if len(json.dumps(article, ensure_ascii=False)) > 512_000:
        raise PublishError("Artikel terlalu besar (batas 512 KB)")
    return article


def _summary(row: PublishJob) -> dict:
    return {
        "id": row.id, "provider": row.provider, "title": row.title,
        "credential_id": row.credential_id, "account_id": row.account_id,
        "status": row.status, "error": redact(row.error, 200),
        "approved_by": row.approved_by,
        "preview": json.loads(row.preview_json) if row.preview_json else None,
        "response": json.loads(row.response_json) if row.response_json else None,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "approved_at": row.approved_at.isoformat() if row.approved_at else None,
        "published_at": row.published_at.isoformat() if row.published_at else None,
    }


def jobs(db: Session, limit: int = 50) -> list[dict]:
    rows = db.query(PublishJob).order_by(PublishJob.id.desc()).limit(max(1, min(limit, 200))).all()
    return [_summary(row) for row in rows]


def status(db: Session) -> dict:
    credentials = (db.query(PublishCredential).order_by(PublishCredential.id).all())
    accounts = (db.query(IntegrationAccount)
                .filter(IntegrationAccount.provider == "instagram")
                .order_by(IntegrationAccount.id).all())
    return {
        "storage": "dpapi" if storage_available() else "unavailable",
        "credentials": [dry24.credential_summary(row) for row in credentials],
        "instagram_accounts": [
            {"id": a.id, "label": a.label, "external_id": a.external_id, "status": a.status}
            for a in accounts],
        "jobs": jobs(db),
        "gate": "Setiap publish butuh approve lalu execute — tidak ada auto-post.",
    }


def preview(db: Session, provider: str, article, credential_id: int | None,
            account_id: int | None, title: str = "") -> dict:
    if provider not in PROVIDERS:
        raise PublishError("Platform tidak dikenal")
    article = _load_article(article)
    if provider == "dry24":
        credential = db.get(PublishCredential, credential_id) if credential_id else None
        if credential is None or not credential.enabled:
            raise PublishError("Kredensial dry24 tidak ditemukan atau nonaktif")
        result = dry24.preview(credential, article)
    else:
        account = db.get(IntegrationAccount, account_id) if account_id else None
        if account is None or account.provider != "instagram":
            raise PublishError("Akun Instagram tidak ditemukan — hubungkan dulu lewat panel Integrasi")
        result = instagram.preview(account, article)
    row = PublishJob(
        provider=provider, credential_id=credential_id, account_id=account_id,
        title=(title or str(article.get("title") or article.get("caption") or "Tanpa judul"))[:200],
        payload_json=json.dumps(article, ensure_ascii=False),
        preview_json=json.dumps(result, ensure_ascii=False),
        status="preview")
    db.add(row)
    db.commit()
    db.refresh(row)
    return _summary(row)


def approve(db: Session, job_id: int, decided_by: str = "local-user") -> dict:
    row = db.get(PublishJob, job_id)
    if row is None:
        raise PublishError("Job tidak ditemukan")
    if row.status != "preview":
        raise PublishError(f"Job tidak bisa disetujui dari status {row.status}")
    row.status = "approved"
    row.approved_by = (decided_by or "local-user")[:80]
    row.approved_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(row)
    return _summary(row)


def execute(db: Session, job_id: int) -> dict:
    """Send exactly once. The status flips to `sending` before any network call."""
    row = db.get(PublishJob, job_id)
    if row is None:
        raise PublishError("Job tidak ditemukan")
    if row.status != "approved":
        if row.status == "published":
            raise PublishError("Job sudah dikirim — tidak bisa dikirim ulang")
        if row.status in ("failed", "sending"):
            raise PublishError("Job sudah pernah dijalankan — buat preview baru untuk mencoba lagi")
        raise PublishError("Job belum disetujui — tekan Setujui lebih dulu")
    article = _load_article(row.payload_json)
    row.status = "sending"
    db.commit()
    try:
        if row.provider == "dry24":
            credential = db.get(PublishCredential, row.credential_id) if row.credential_id else None
            if credential is None or not credential.enabled:
                raise PublishError("Kredensial dry24 tidak tersedia")
            result = dry24.publish(db, credential, article)
        elif row.provider == "instagram":
            account = db.get(IntegrationAccount, row.account_id) if row.account_id else None
            if account is None or account.provider != "instagram":
                raise PublishError("Akun Instagram tidak tersedia")
            result = instagram.publish(db, account, article)
        else:
            raise PublishError("Platform tidak dikenal")
        row.status = "published"
        row.response_json = json.dumps(result, ensure_ascii=False)[:8000]
        row.published_at = datetime.now(timezone.utc)
        row.error = ""
    except (PublishError, dry24.PublishError, instagram.PublishError, RuntimeError) as e:
        row.status = "failed"
        row.error = redact(str(e), 2000)
    db.commit()
    db.refresh(row)
    return _summary(row)


def save_credential(db: Session, *, name: str, api_url: str, token: str, method: str = "POST",
                    auth_header: str = "Authorization", auth_scheme: str = "Bearer",
                    field_map: dict | None = None, headers: dict | None = None,
                    credential_id: int | None = None) -> dict:
    if not storage_available():
        raise PublishError("Penyimpanan token terenkripsi tidak tersedia di sistem ini")
    from app.integrations.secure_store import seal
    name = (name or "dry24").strip()[:80]
    api_url = (api_url or "").strip()[:500]
    parsed = urllib.parse.urlparse(api_url)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        raise PublishError("API URL tidak valid (harus http/https)")
    method = (method or "POST").strip().upper()
    if method not in ("POST", "PUT", "PATCH"):
        raise PublishError("Metode harus POST, PUT, atau PATCH")
    row = db.get(PublishCredential, credential_id) if credential_id else None
    if row is None:
        row = PublishCredential(name=name, api_url=api_url)
        db.add(row)
    row.name = name
    row.api_url = api_url
    row.method = method
    row.auth_header = (auth_header or "Authorization")[:60]
    row.auth_scheme = (auth_scheme or "Bearer")[:30]
    row.field_map_json = json.dumps(field_map or {}, ensure_ascii=False)
    row.headers_json = json.dumps(headers or {}, ensure_ascii=False)
    if token:
        if len(token) > 8192:
            raise PublishError("Token terlalu panjang")
        row.token = seal(token)
    db.commit()
    db.refresh(row)
    return dry24.credential_summary(row)


def delete_credential(db: Session, credential_id: int) -> None:
    row = db.get(PublishCredential, credential_id)
    if row is None:
        raise PublishError("Kredensial tidak ditemukan")
    db.delete(row)
    db.commit()
