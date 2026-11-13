from fastapi import APIRouter

from app.channels import telegram

router = APIRouter(prefix="/channels", tags=["channels"])


@router.get("/status")
def channel_status():
    return {"telegram": telegram.status()}
