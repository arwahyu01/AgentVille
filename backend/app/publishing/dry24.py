"""Publisher for a site's custom REST API (dry24.id in this deployment).

The endpoint, auth header, and field names are configuration, not hard-coded guesses: no API
documentation was supplied, so the connector exposes a generic, testable contract. `preview()`
never opens a connection; `publish()` is only callable from an approved job.
"""

import json
import urllib.error
import urllib.parse
import urllib.request

from sqlalchemy.orm import Session

from app.agent_actions import redact
from app.integrations.secure_store import unseal
from app.models import PublishCredential

TIMEOUT_S = 20
MAX_RESPONSE = 8000
MAX_PAYLOAD = 512_000
DEFAULT_FIELDS = {
    "title": "title", "content": "content", "excerpt": "excerpt",
    "slug": "slug", "status": "status", "categories": "categories",
}


class PublishError(RuntimeError):
    pass


def _json_object(value: str, what: str) -> dict:
    if not value:
        return {}
    try:
        result = json.loads(value)
    except json.JSONDecodeError:
        raise PublishError(f"{what} bukan JSON yang valid") from None
    if not isinstance(result, dict):
        raise PublishError(f"{what} harus berupa objek JSON")
    return result


def credential_summary(row: PublishCredential) -> dict:
    return {
        "id": row.id, "name": row.name, "api_url": row.api_url, "method": row.method,
        "auth_header": row.auth_header, "auth_scheme": row.auth_scheme,
        "field_map": _json_object(row.field_map_json, "field_map"),
        "headers": {k: "***" for k in _json_object(row.headers_json, "headers")},
        "enabled": bool(row.enabled), "has_token": bool(row.token),
        "created_at": row.created_at.isoformat() if row.created_at else None,
    }


def build(credential: PublishCredential, article: dict) -> tuple[str, str, dict, dict]:
    """Return (method, url, headers, payload). The token is included only in the returned
    headers for the actual send; callers must use `preview()` for anything user-visible."""
    url = (credential.api_url or "").strip()
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        raise PublishError("API URL tidak valid (harus http/https)")
    method = (credential.method or "POST").strip().upper()
    if method not in ("POST", "PUT", "PATCH"):
        raise PublishError("Metode harus POST, PUT, atau PATCH")
    fields = {**DEFAULT_FIELDS, **_json_object(credential.field_map_json, "field_map")}
    content = article.get("content", "")
    if not isinstance(content, str) or not content.strip():
        raise PublishError("Artikel tidak memiliki isi (content kosong)")
    payload = {}
    for source, target in fields.items():
        if source in article and article[source] not in (None, ""):
            payload[str(target)] = article[source]
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    if len(body) > MAX_PAYLOAD:
        raise PublishError("Payload terlalu besar (batas 512 KB)")
    headers = {"Accept": "application/json", "Content-Type": "application/json"}
    headers.update({str(k): str(v) for k, v in _json_object(credential.headers_json, "headers").items()})
    token = unseal(credential.token) if credential.token else ""
    if token:
        header = credential.auth_header or "Authorization"
        scheme = credential.auth_scheme or "Bearer"
        headers[header] = f"{scheme} {token}".strip()
    return method, url, headers, payload


def preview(credential: PublishCredential, article: dict) -> dict:
    """Describe the exact request without a token or any network call."""
    method, url, headers, payload = build(credential, article)
    safe_headers = {k: ("***" if k.lower() == (credential.auth_header or "authorization").lower()
                        else redact(v, 120)) for k, v in headers.items()}
    return {
        "provider": "dry24", "method": method, "url": url,
        "headers": safe_headers, "payload": payload,
        "note": "Token disembunyikan. Preview ini tidak mengirim apa pun.",
    }


def publish(db: Session, credential: PublishCredential, article: dict) -> dict:
    method, url, headers, payload = build(credential, article)
    request = urllib.request.Request(
        url, data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT_S) as response:
            body = response.read(MAX_RESPONSE).decode("utf-8", "replace")
            status = response.status
    except urllib.error.HTTPError as e:
        detail = e.read(MAX_RESPONSE).decode("utf-8", "replace") if e.fp else ""
        raise PublishError(f"HTTP {e.code} dari dry24: {redact(detail, 200)}") from None
    except urllib.error.URLError:
        raise PublishError("dry24 tidak bisa dihubungi (jaringan/timeout)") from None
    try:
        parsed = json.loads(body)
        result = parsed if isinstance(parsed, dict) else {"response": parsed}
    except json.JSONDecodeError:
        result = {"response": redact(body, 300)}
    return {"http_status": status, "result": result}
