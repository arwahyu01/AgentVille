"""Login, logout and current-user endpoints."""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app import auth
from app.database import get_db
from app.models import User

router = APIRouter(prefix="/auth", tags=["auth"])


class LoginRequest(BaseModel):
    username: str = Field(min_length=1, max_length=160)
    password: str = Field(min_length=1, max_length=512)


class AuthUser(BaseModel):
    id: int
    username: str

    model_config = {"from_attributes": True}


@router.post("/login", response_model=AuthUser)
def login(payload: LoginRequest, request: Request, response: Response, db: Session = Depends(get_db)):
    if not auth.AUTH_ENABLED:
        return AuthUser(id=0, username="local")
    key = auth.attempt_key(request, payload.username)
    if auth.rate_limited(key):
        raise HTTPException(status_code=429, detail="Terlalu banyak percobaan. Coba lagi sebentar.")
    user = db.query(User).filter(User.username == payload.username.strip()).first()
    if user is None or not user.is_active or not auth.verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Username atau kata sandi salah")
    auth.clear_rate_limit(key)
    user.last_login_at = datetime.now(timezone.utc)
    db.commit()
    response.set_cookie(
        auth.COOKIE_NAME,
        auth.make_session(user.id),
        max_age=auth.SESSION_TTL_S,
        httponly=True,
        samesite="lax",
        secure=request.url.scheme == "https",
        path="/",
    )
    return AuthUser.model_validate(user)


@router.post("/logout")
def logout(response: Response):
    response.delete_cookie(auth.COOKIE_NAME, path="/")
    return {"ok": True}


@router.get("/me", response_model=AuthUser)
def me(request: Request, db: Session = Depends(get_db)):
    if not auth.AUTH_ENABLED:
        return AuthUser(id=0, username="local")
    user_id = getattr(request.state, "user_id", None)
    user = db.get(User, user_id) if user_id else None
    if user is None or not user.is_active:
        raise HTTPException(status_code=401, detail="Sesi tidak valid")
    return AuthUser.model_validate(user)
