"""HTTP surface for gated publishing and the daily news schedule."""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import NewsRun
from app.publishing import scheduler, service
from app.publishing.service import PublishError
from app.settings_store import set_setting

router = APIRouter(prefix="/publish", tags=["publishing"])


def _http(e: PublishError) -> HTTPException:
    return HTTPException(status_code=400, detail=str(e))


@router.get("/status")
def publish_status(db: Session = Depends(get_db)):
    return service.status(db)


@router.get("/jobs")
def list_jobs(limit: int = 50, db: Session = Depends(get_db)):
    return service.jobs(db, limit)


class CredentialRequest(BaseModel):
    name: str = Field(default="dry24", min_length=1, max_length=80)
    cli_project: str = Field(default="", max_length=500)
    cli_php: str = Field(default="php", max_length=300)
    field_map: dict = Field(default_factory=dict)
    credential_id: int | None = None


@router.post("/credentials")
def save_credential(payload: CredentialRequest, db: Session = Depends(get_db)):
    try:
        return service.save_credential(
            db, name=payload.name, cli_project=payload.cli_project,
            cli_php=payload.cli_php, field_map=payload.field_map,
            credential_id=payload.credential_id)
    except PublishError as e:
        raise _http(e) from None


@router.post("/credentials/preset")
def install_preset(db: Session = Depends(get_db)):
    """Install the dry24 local-CLI bridge mapping (no token, no endpoint)."""
    try:
        return service.install_dry24_preset(db)
    except PublishError as e:
        raise _http(e) from None


@router.delete("/credentials/{credential_id}")
def delete_credential(credential_id: int, db: Session = Depends(get_db)):
    try:
        service.delete_credential(db, credential_id)
    except PublishError as e:
        raise _http(e) from None
    return {"ok": True}


class PreviewRequest(BaseModel):
    provider: str = Field(pattern="^(dry24|instagram)$")
    article: dict = Field(min_length=1)
    credential_id: int | None = None
    account_id: int | None = None
    title: str = Field(default="", max_length=200)


@router.post("/preview")
def create_preview(payload: PreviewRequest, db: Session = Depends(get_db)):
    try:
        return service.preview(db, payload.provider, payload.article,
                               payload.credential_id, payload.account_id, payload.title)
    except PublishError as e:
        raise _http(e) from None


@router.post("/{job_id}/approve")
def approve(job_id: int, decided_by: str = "local-user", db: Session = Depends(get_db)):
    try:
        return service.approve(db, job_id, decided_by)
    except PublishError as e:
        raise _http(e) from None


@router.post("/{job_id}/execute")
def execute(job_id: int, db: Session = Depends(get_db)):
    try:
        return service.execute(db, job_id)
    except PublishError as e:
        raise _http(e) from None


@router.get("/schedule")
def get_schedule(db: Session = Depends(get_db)):
    config = scheduler.schedule_config(db)
    rows = db.query(NewsRun).order_by(NewsRun.id.desc()).limit(30).all()
    config["runs"] = [
        {"id": r.id, "run_date": r.run_date, "status": r.status,
         "conversation_id": r.conversation_id, "error": r.error[:200],
         "topics": r.topics[:200]}
        for r in rows]
    return config


class ScheduleRequest(BaseModel):
    enabled: bool
    hour: int = Field(ge=0, le=23)
    topics: str = Field(default="", max_length=500)
    max_items: int = Field(default=5, ge=1, le=10)


@router.patch("/schedule")
def patch_schedule(payload: ScheduleRequest, db: Session = Depends(get_db)):
    set_setting(db, "news_schedule_enabled", "1" if payload.enabled else "0")
    set_setting(db, "news_schedule_hour", str(payload.hour))
    set_setting(db, "news_schedule_topics", payload.topics[:500])
    set_setting(db, "news_schedule_max_items", str(payload.max_items))
    db.commit()
    return scheduler.schedule_config(db)


@router.post("/schedule/dry-run")
def schedule_dry_run(db: Session = Depends(get_db)):
    """Show the exact prompt that would be queued — without creating a conversation."""
    return scheduler.run_once(db, dry_run=True)
