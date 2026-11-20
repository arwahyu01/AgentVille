"""Session authentication for a publicly reachable AgentVille deployment.

Design constraints:
- The password is never stored in plain text and never returned by an API. It is hashed
  with PBKDF2-HMAC-SHA256 and verified in constant time.
- The browser holds only an opaque, HMAC-signed cookie. There is no bearer token to leak
  into logs, URLs or the frontend bundle.
- Every /api/* route except the login endpoint is gated in middleware, including SSE,
  so a direct API call cannot bypass the login page.
- Auth can be disabled only with an explicit AGENTVILLE_AUTH_ENABLED=0 (used by the
  existing test suite). Production defaults to enabled.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import secrets
import threading
import time
from functools import lru_cache

from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from app.database import DATA_DIR, SessionLocal

COOKIE_NAME = "agentville_session"
SESSION_TTL_S = 12 * 60 * 60
PBKDF2_ITERATIONS = 240_000
AUTH_ENABLED = os.getenv("AGENTVILLE_AUTH_ENABLED", "1").strip().lower() not in {
    "0", "false", "no", "off",
}
LOGIN_PATH = "/api/auth/login"

_attempts: dict[tuple[str, str], tuple[int, float]] = {}
_attempts_lock = threading.Lock()
MAX_ATTEMPTS = 5
ATTEMPT_WINDOW_S = 60


def _b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, PBKDF2_ITERATIONS)
    return f"pbkdf2_sha256${PBKDF2_ITERATIONS}${_b64(salt)}${_b64(digest)}"


def verify_password(password: str, encoded: str) -> bool:
    try:
        scheme, iterations, salt, digest = encoded.split("$", 3)
        if scheme != "pbkdf2_sha256":
            return False
        actual = hashlib.pbkdf2_hmac(
            "sha256", password.encode("utf-8"), _unb64(salt), int(iterations))
        return hmac.compare_digest(actual, _unb64(digest))
    except (ValueError, TypeError):
        return False


@lru_cache(maxsize=1)
def session_secret() -> bytes:
    """Use an explicit env secret in production; otherwise persist a random one locally."""
    configured = os.getenv("AGENTVILLE_SESSION_SECRET", "").strip()
    if configured:
        return configured.encode("utf-8")
    path = DATA_DIR / "session_secret"
    if path.exists():
        return path.read_text(encoding="ascii").strip().encode("utf-8")
    secret = secrets.token_hex(32)
    path.write_text(secret, encoding="ascii")
    try:
        path.chmod(0o600)
    except OSError:
        pass
    return secret.encode("utf-8")


def make_session(user_id: int) -> str:
    payload = json.dumps(
        {"uid": user_id, "exp": int(time.time()) + SESSION_TTL_S,
         "nonce": secrets.token_hex(8)},
        separators=(",", ":"),
    ).encode("utf-8")
    body = _b64(payload)
    signature = hmac.new(session_secret(), body.encode("ascii"), hashlib.sha256).hexdigest()
    return f"{body}.{signature}"


def read_session(token: str | None) -> int | None:
    if not token or "." not in token:
        return None
    body, signature = token.rsplit(".", 1)
    expected = hmac.new(session_secret(), body.encode("ascii"), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(signature, expected):
        return None
    try:
        payload = json.loads(_unb64(body))
        user_id = int(payload["uid"])
        expiry = int(payload["exp"])
    except (ValueError, KeyError, TypeError):
        return None
    if expiry <= int(time.time()) or user_id <= 0:
        return None
    return user_id


def rate_limited(key: tuple[str, str]) -> bool:
    now = time.monotonic()
    with _attempts_lock:
        for old_key in [k for k, (_count, start) in _attempts.items() if now - start > ATTEMPT_WINDOW_S]:
            _attempts.pop(old_key, None)
        count, start = _attempts.get(key, (0, now))
        if count >= MAX_ATTEMPTS and now - start <= ATTEMPT_WINDOW_S:
            return True
        _attempts[key] = (count + 1, start)
        return False


def clear_rate_limit(key: tuple[str, str]) -> None:
    with _attempts_lock:
        _attempts.pop(key, None)


def attempt_key(request: Request, username: str) -> tuple[str, str]:
    client = request.client.host if request.client else "unknown"
    return client, username.strip().lower()[:120]


def _unauthorized() -> JSONResponse:
    return JSONResponse(
        status_code=401,
        content={"detail": "Masuk untuk mengakses AgentVille"},
        headers={"WWW-Authenticate": "Cookie"},
    )


class AuthMiddleware(BaseHTTPMiddleware):
    """Starlette adapter so the gate can be installed with app.add_middleware()."""

    async def dispatch(self, request: Request, call_next):
        return await auth_middleware(request, call_next)


async def auth_middleware(request: Request, call_next):  # type: ignore[valid-type]
    """Gate all API traffic, including the SSE stream, before any route runs."""
    if not AUTH_ENABLED or request.url.path == LOGIN_PATH or not request.url.path.startswith("/api/"):
        return await call_next(request)
    user_id = read_session(request.cookies.get(COOKIE_NAME))
    if user_id is not None:
        from app.models import User  # local import avoids a database/auth import cycle

        with SessionLocal() as db:
            user = db.get(User, user_id)
            if user is None or not user.is_active:
                user_id = None
    if user_id is None:
        return _unauthorized()
    request.state.user_id = user_id
    return await call_next(request)
