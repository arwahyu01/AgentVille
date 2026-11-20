"""Instagram publishing through the Graph API, using an already connected account.

Two steps are required by Meta: create a media container, then publish it. A publicly reachable
media_url is mandatory — local workspace files are not reachable by Meta and are never guessed.
Preview is offline; publish is only callable from an approved job.
"""

import json
import urllib.error
import urllib.parse
import urllib.request

from sqlalchemy.orm import Session

from app.agent_actions import redact
from app.integrations.secure_store import unseal
from app.models import IntegrationAccount

GRAPH = "https://graph.facebook.com/v21.0"
TIMEOUT_S = 25
MAX_CAPTION = 2200


class PublishError(RuntimeError):
    pass


def _payload(account: IntegrationAccount, article: dict) -> dict:
    caption = str(article.get("caption") or article.get("content") or "").strip()
    if not caption:
        raise PublishError("Caption Instagram kosong")
    if len(caption) > MAX_CAPTION:
        raise PublishError(f"Caption terlalu panjang (maks {MAX_CAPTION} karakter)")
    media_url = str(article.get("media_url") or "").strip()
    parsed = urllib.parse.urlparse(media_url)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        raise PublishError("media_url wajib berupa URL publik http/https")
    external_id = (account.external_id or "").strip()
    if not external_id.isdigit():
        raise PublishError("Akun Instagram tidak memiliki ID bisnis yang valid — hubungkan ulang")
    token = unseal(account.token) if account.token else ""
    if not token:
        raise PublishError("Token Instagram tidak tersedia — hubungkan ulang akun")
    return {"ig_id": external_id, "caption": caption, "media_url": media_url, "token": token}


def preview(account: IntegrationAccount, article: dict) -> dict:
    data = _payload(account, article)
    return {
        "provider": "instagram", "endpoint_host": "graph.facebook.com",
        "account_label": account.label, "ig_id": data["ig_id"],
        "step_1": "POST /{ig-id}/media (image_url, caption)",
        "step_2": "POST /{ig-id}/media_publish (creation_id)",
        "caption": data["caption"][:300],
        "media_host": urllib.parse.urlparse(data["media_url"]).netloc,
        "note": "Token disembunyikan. Preview ini tidak mengirim apa pun ke Instagram.",
    }


def _post(url: str, params: dict) -> dict:
    request = urllib.request.Request(
        url + "?" + urllib.parse.urlencode(params), data=b"", method="POST",
        headers={"Accept": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT_S) as response:
            body = response.read(6000).decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        detail = e.read(6000).decode("utf-8", "replace") if e.fp else ""
        raise PublishError(f"HTTP {e.code} dari Instagram: {redact(detail, 220)}") from None
    except urllib.error.URLError:
        raise PublishError("Instagram Graph API tidak bisa dihubungi (jaringan/timeout)") from None
    try:
        result = json.loads(body)
    except json.JSONDecodeError:
        raise PublishError("Instagram mengembalikan respons yang bukan JSON") from None
    if not isinstance(result, dict):
        raise PublishError("Format respons Instagram tidak dikenal")
    if result.get("error"):
        message = result["error"].get("message", "error") if isinstance(result["error"], dict) else "error"
        raise PublishError(f"Instagram menolak: {redact(str(message), 220)}")
    return result


def publish(db: Session, account: IntegrationAccount, article: dict) -> dict:
    data = _payload(account, article)
    container = _post(f"{GRAPH}/{data['ig_id']}/media", {
        "image_url": data["media_url"], "caption": data["caption"],
        "access_token": data["token"],
    })
    creation_id = container.get("id")
    if not creation_id:
        raise PublishError("Instagram tidak mengembalikan creation_id")
    media = _post(f"{GRAPH}/{data['ig_id']}/media_publish", {
        "creation_id": str(creation_id), "access_token": data["token"],
    })
    return {"creation_id": str(creation_id), "media_id": str(media.get("id", "")), "result": media}
