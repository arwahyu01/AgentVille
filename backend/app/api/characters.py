from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app import settings_store
from app.ai import registry
from app.character_chat import build_persona, build_prompt, resolve_character
from app.database import get_db
from app.schemas import CharacterChatRead, CharacterChatRequest

router = APIRouter(prefix="/characters", tags=["characters"])

CHAT_TIMEOUT_CAP_S = 90


@router.post("/chat", response_model=CharacterChatRead)
def chat(payload: CharacterChatRequest, db: Session = Depends(get_db)):
    character = resolve_character(db, payload.character)
    if character is None:
        raise HTTPException(status_code=404, detail="Karakter tidak dikenal")
    if not settings_store.ai_enabled(db):
        raise HTTPException(
            status_code=503,
            detail="AI sedang nonaktif. Aktifkan AI di panel AI Engine agar karakter bisa menjawab dengan model.",
        )

    provider_name = settings_store.ai_provider(db)
    availability = registry.availability().get(provider_name) or {}
    if not availability.get("available"):
        reason = availability.get("reason") or "CLI provider tidak ditemukan"
        raise HTTPException(status_code=503, detail=f"Provider {provider_name} tidak tersedia: {reason}")

    model = settings_store.ai_model_for(db, provider_name)
    provider = registry.make_provider(provider_name)
    persona = build_persona(character, model)
    prompt = build_prompt(character, payload.message, payload.history)
    timeout_s = max(10, min(settings_store.ai_timeout_s(db), CHAT_TIMEOUT_CAP_S))

    result = provider.run(persona, prompt, timeout_s=timeout_s)
    if not result.ok:
        raise HTTPException(
            status_code=502,
            detail=f"AI gagal menjawab: {(result.error or 'tidak ada balasan')[:240]}",
        )
    return CharacterChatRead(
        reply=result.text.strip(),
        provider=result.provider or provider_name,
        model=result.model or model,
        latency_s=round(result.latency_s, 2),
    )
