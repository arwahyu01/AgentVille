"""Publish jobs with a mandatory, explicit human gate.

Preview and send are deliberately separate operations. Even when `external_approval_enabled`
is off, a publish job still needs `approve` then `execute`: these are real external changes and
the project contract never auto-approves them. The token is never copied into a job row.
"""

import json
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
        "preset": dry24.DRY24_PRESET,
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
        try:
            result = dry24.preview(credential, article)
        except dry24.PublishError as e:
            raise PublishError(str(e)) from None
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


def save_credential(db: Session, *, name: str, cli_project: str, cli_php: str = "php",
                    field_map: dict | None = None,
                    credential_id: int | None = None) -> dict:
    """Store the local CLI bridge settings. There is no token to seal: dry24 keeps its own DB
    credentials in its own .env and AgentVille only runs `php artisan berita:publish`."""
    name = (name or "dry24").strip()[:80]
    cli_project = (cli_project or "").strip()[:500]
    cli_php = (cli_php or "php").strip()[:300] or "php"
    try:
        dry24.validate_location(cli_project, cli_php)
    except dry24.PublishError as e:
        raise PublishError(str(e)) from None
    row = db.get(PublishCredential, credential_id) if credential_id else None
    if row is None:
        row = PublishCredential(name=name, cli_project=cli_project)
        db.add(row)
    if field_map is None and row.field_map_json:
        field_map = json.loads(row.field_map_json)
    row.name = name
    row.cli_project = cli_project
    row.cli_php = cli_php
    row.field_map_json = json.dumps(field_map or {}, ensure_ascii=False)
    # Legacy columns are intentionally cleared: no HTTP endpoint and no DPAPI token anymore.
    row.api_url = ""
    row.method = "CLI"
    row.token = ""
    row.auth_header = ""
    row.auth_scheme = ""
    row.headers_json = "{}"
    db.commit()
    db.refresh(row)
    return dry24.credential_summary(row)


def install_dry24_preset(db: Session) -> dict:
    """Create (or return) the credential row for the local dry24 CLI bridge.

    The project path can be pre-filled by the AGENTVILLE_DRY24_PROJECT env var; otherwise the
    operator must fill it in the UI. Nothing is executed here and no secret is stored.
    """
    preset = dry24.DRY24_PRESET
    existing = (db.query(PublishCredential)
                .filter(PublishCredential.name == preset["name"])
                .first())
    if existing is not None:
        return dry24.credential_summary(existing)
    # Deliberately skip path validation: the operator may install the preset first and fill the
    # project location afterwards. Validation happens on save and on preview.
    row = PublishCredential(
        name=preset["name"], cli_project=preset["cli_project"], cli_php=preset["cli_php"],
        field_map_json=json.dumps(preset["field_map"], ensure_ascii=False))
    db.add(row)
    db.commit()
    db.refresh(row)
    return dry24.credential_summary(row)


def delete_credential(db: Session, credential_id: int) -> None:
    row = db.get(PublishCredential, credential_id)
    if row is None:
        raise PublishError("Kredensial tidak ditemukan")
    db.delete(row)
    db.commit()
