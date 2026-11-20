"""OAuth plumbing for Meta (Instagram / Ads) and Google (YouTube).

Client IDs and secrets are read from environment variables only — never from the database,
never from the UI, and never printed. Network calls happen only when a user actually starts
or completes a connection; importing this module does not contact any provider.
"""

import json
import logging
import os
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

from app.agent_actions import redact

log = logging.getLogger("agentville.integrations.oauth")
GRAPH = "https://graph.facebook.com/v21.0"
META_AUTH = "https://www.facebook.com/v21.0/dialog/oauth"
GOOGLE_AUTH = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN = "https://oauth2.googleapis.com/token"
TIMEOUT_S = 20

META_PROVIDERS = ("instagram", "meta_ads")
PROVIDERS = {
    "instagram": {
        "auth": META_AUTH, "token": f"{GRAPH}/oauth/access_token", "meta": True,
        "env": ("AGENTVILLE_META_CLIENT_ID", "AGENTVILLE_META_CLIENT_SECRET"),
        "scope": "instagram_basic,pages_show_list,instagram_content_publish",
    },
    "meta_ads": {
        "auth": META_AUTH, "token": f"{GRAPH}/oauth/access_token", "meta": True,
        "env": ("AGENTVILLE_META_CLIENT_ID", "AGENTVILLE_META_CLIENT_SECRET"),
        "scope": "ads_read,ads_management,pages_show_list",
    },
    "youtube": {
        "auth": GOOGLE_AUTH, "token": GOOGLE_TOKEN, "meta": False,
        "env": ("AGENTVILLE_GOOGLE_CLIENT_ID", "AGENTVILLE_GOOGLE_CLIENT_SECRET"),
        "scope": "https://www.googleapis.com/auth/youtube.readonly "
                 "https://www.googleapis.com/auth/youtube.upload",
    },
}


class OAuthError(RuntimeError):
    """A provider refused the code or the read-only profile call."""


def redirect_uri() -> str:
    return os.getenv("AGENTVILLE_OAUTH_REDIRECT",
                     "http://127.0.0.1:8000/api/integrations/oauth/return")


def configured(provider: str) -> bool:
    spec = PROVIDERS.get(provider)
    if spec is None:
        return False
    return all(os.getenv(name, "").strip() for name in spec["env"])


def auth_url(provider: str, state: str) -> str:
    spec = PROVIDERS[provider]
    if not configured(provider):
        raise OAuthError(f"{provider} OAuth app belum dikonfigurasi "
                         f"(client ID/secret dari environment tidak ada)")
    params = {
        "client_id": os.getenv(spec["env"][0], ""),
        "redirect_uri": redirect_uri(),
        "response_type": "code",
        "scope": spec["scope"],
        "state": state,
    }
    if not spec["meta"]:
        params.update(access_type="offline", prompt="consent", include_granted_scopes="true")
    return spec["auth"] + "?" + urllib.parse.urlencode(params)


def _request(url: str, data: dict | None = None, token: str = "",
             params: dict | None = None) -> dict:
    if params:
        url = url + ("&" if "?" in url else "?") + urllib.parse.urlencode(params)
    headers = {"Accept": "application/json"}
    payload = None
    if data is not None:
        payload = urllib.parse.urlencode(data).encode("utf-8")
        headers["Content-Type"] = "application/x-www-form-urlencoded"
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = urllib.request.Request(url, data=payload, headers=headers,
                                     method="POST" if data is not None else "GET")
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT_S) as response:
            body = response.read(200_000).decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        detail = redact(e.read(2000).decode("utf-8", "replace"), 200) if e.fp else ""
        raise OAuthError(f"HTTP {e.code} dari penyedia" + (f": {detail}" if detail else "")) from None
    except urllib.error.URLError as e:
        raise OAuthError("Penyedia tidak bisa dihubungi (jaringan/timeout)") from None
    try:
        result = json.loads(body)
    except json.JSONDecodeError:
        raise OAuthError("Penyedia mengembalikan respons yang bukan JSON") from None
    if not isinstance(result, dict):
        raise OAuthError("Format respons penyedia tidak dikenal")
    return result


def _expires_in(value) -> datetime | None:
    try:
        return datetime.now(timezone.utc) + timedelta(seconds=max(1, int(value)))
    except (TypeError, ValueError):
        return None


def exchange(provider: str, code: str) -> dict:
    """Trade a one-time code for tokens. Called only from the explicit /complete endpoint."""
    spec = PROVIDERS[provider]
    if not configured(provider):
        raise OAuthError(f"{provider} OAuth app belum dikonfigurasi")
    if not code or len(code) > 512:
        raise OAuthError("Kode OAuth tidak valid")
    data = {
        "client_id": os.getenv(spec["env"][0], ""),
        "client_secret": os.getenv(spec["env"][1], ""),
        "redirect_uri": redirect_uri(),
        "code": code,
        "grant_type": "authorization_code",
    }
    result = _request(spec["token"], data)
    token = result.get("access_token", "")
    if not token:
        raise OAuthError("Penyedia tidak mengembalikan access token")
    if spec["meta"] and os.getenv("AGENTVILLE_META_LONG_LIVED", "1") != "0":
        try:
            long_lived = _request(spec["token"], {
                "grant_type": "fb_exchange_token",
                "client_id": os.getenv(spec["env"][0], ""),
                "client_secret": os.getenv(spec["env"][1], ""),
                "fb_exchange_token": token,
            })
            token = long_lived.get("access_token") or token
            result["expires_in"] = long_lived.get("expires_in", result.get("expires_in"))
        except OAuthError as e:
            # A short-lived token is still usable: keep it and let /verify report expiry.
            log.warning("long-lived Meta token exchange failed: %s", redact(str(e), 160))
    return {
        "access_token": token,
        "refresh_token": result.get("refresh_token", ""),
        "expires_at": _expires_in(result.get("expires_in")),
        "scopes": str(result.get("scope") or spec["scope"]),
    }


def profile(provider: str, token: str) -> dict:
    """Read-only identity lookup. Never touches publishing endpoints."""
    if provider in META_PROVIDERS:
        if provider == "instagram":
            result = _request(f"{GRAPH}/me/accounts", token=token,
                              params={"fields": "id,name,access_token,instagram_business_account{id}",
                                      "limit": 50})
        else:
            result = _request(f"{GRAPH}/me/adaccounts", token=token,
                              params={"fields": "id,name,account_status", "limit": 50})
        items = result.get("data") or []
        if not isinstance(items, list):
            raise OAuthError("Daftar akun Meta tidak bisa dibaca")
        if provider == "instagram":
            for item in items:
                business = item.get("instagram_business_account") or {}
                if isinstance(business, dict) and business.get("id"):
                    return {"external_id": str(business["id"]),
                            "label": f"{item.get('name', 'Instagram')} · Instagram",
                            "access_token": item.get("access_token") or token}
            raise OAuthError("Token ini tidak memiliki Instagram business account yang terhubung ke Facebook Page")
        for item in items:
            if str(item.get("account_status", 1)) == "1":
                return {"external_id": str(item["id"]),
                        "label": f"{item.get('name', 'Meta Ads')} · Ads", "access_token": token}
        raise OAuthError("Tidak ada akun Meta Ads yang aktif pada token ini")
    result = _request("https://www.googleapis.com/oauth2/v3/userinfo", token=token)
    if not result.get("sub"):
        raise OAuthError("Identitas YouTube/Google tidak bisa dibaca")
    return {"external_id": str(result["sub"]),
            "label": f"{result.get('name') or result.get('email') or 'YouTube'} · YouTube",
            "access_token": token}
