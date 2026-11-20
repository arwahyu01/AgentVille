from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app import settings_store
from app.ai import registry
from app.ai.claude import MODEL_PATTERN as CLAUDE_MODEL_PATTERN
from app.ai.opencode import MODEL_PATTERN as OPENCODE_MODEL_PATTERN
from app.ai.qoder import MODEL_PATTERN as QODER_MODEL_PATTERN
from app.database import get_db
from app.schemas import AIConfigPatch, AIConfigRead

router = APIRouter(prefix="/ai", tags=["ai"])


def _read_config(db: Session) -> AIConfigRead:
    return AIConfigRead(
        ai_enabled=settings_store.ai_enabled(db),
        ai_model=settings_store.ai_model(db),
        ai_timeout_s=settings_store.ai_timeout_s(db),
        provider=settings_store.ai_provider(db),
        ai_model_qoder=settings_store.get_setting(db, "ai_model_qoder"),
        ai_model_claude=settings_store.get_setting(db, "ai_model_claude"),
        fallback_enabled=settings_store.ai_fallback_enabled(db),
        retry_max=settings_store.ai_retry_max(db),
        agent_chat_mode=settings_store.agent_chat_mode(db),
        rotate_models_enabled=settings_store.rotate_models_enabled(db),
        rotate_models_max=settings_store.rotate_models_max(db),
        external_approval_enabled=settings_store.external_approval_enabled(db),
        providers=registry.availability(),
    )


@router.get("/config", response_model=AIConfigRead)
def get_config(db: Session = Depends(get_db)):
    return _read_config(db)


@router.patch("/config", response_model=AIConfigRead)
def patch_config(payload: AIConfigPatch, db: Session = Depends(get_db)):
    if payload.ai_model is not None:
        if not OPENCODE_MODEL_PATTERN.match(payload.ai_model):
            raise HTTPException(status_code=422, detail="Model must look like provider/model")
        settings_store.set_setting(db, "ai_model", payload.ai_model)
    if payload.ai_model_qoder is not None:
        if not QODER_MODEL_PATTERN.match(payload.ai_model_qoder):
            raise HTTPException(status_code=422, detail="Invalid qoder model name")
        settings_store.set_setting(db, "ai_model_qoder", payload.ai_model_qoder)
    if payload.ai_model_claude is not None:
        if not CLAUDE_MODEL_PATTERN.match(payload.ai_model_claude):
            raise HTTPException(status_code=422, detail="Invalid claude model name")
        settings_store.set_setting(db, "ai_model_claude", payload.ai_model_claude)
    if payload.provider is not None:
        settings_store.set_setting(db, "ai_provider", payload.provider)
    if payload.ai_enabled is not None:
        settings_store.set_setting(db, "ai_enabled", "1" if payload.ai_enabled else "0")
    if payload.ai_timeout_s is not None:
        settings_store.set_setting(db, "ai_timeout_s", str(payload.ai_timeout_s))
    if payload.fallback_enabled is not None:
        settings_store.set_setting(db, "ai_fallback_enabled", "1" if payload.fallback_enabled else "0")
    if payload.retry_max is not None:
        settings_store.set_setting(db, "ai_retry_max", str(payload.retry_max))
    if payload.agent_chat_mode is not None:
        settings_store.set_setting(db, "agent_chat_mode", payload.agent_chat_mode)
    if payload.rotate_models_enabled is not None:
        settings_store.set_setting(db, "rotate_models_enabled", "1" if payload.rotate_models_enabled else "0")
    if payload.rotate_models_max is not None:
        settings_store.set_setting(db, "rotate_models_max", str(payload.rotate_models_max))
    if payload.external_approval_enabled is not None:
        if not payload.external_approval_enabled:
            raise HTTPException(status_code=422,
                                detail="High-risk and external approval gates cannot be disabled")
        settings_store.set_setting(db, "external_approval_enabled", "1")
    db.commit()
    return _read_config(db)


@router.get("/models")
def get_models(provider: str = Query("opencode", pattern="^(opencode|qoder|claude)$"), db: Session = Depends(get_db)):
    try:
        return {"models": registry.list_models(provider)}
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"{provider} models unavailable: {str(e)[:200]}")
