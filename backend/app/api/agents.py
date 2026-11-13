from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.agent_status import sync_agent_status
from app.database import get_db
from app.models import Agent
from app.schemas import AgentRead

router = APIRouter(tags=["agents"])

@router.get("/agents", response_model=list[AgentRead])
def list_agents(db: Session = Depends(get_db)):
    sync_agent_status(db)
    db.commit()
    return db.query(Agent).order_by(Agent.id).all()

@router.get("/agents/{agent_id}", response_model=AgentRead)
def get_agent(agent_id: int, db: Session = Depends(get_db)):
    agent = db.get(Agent, agent_id)
    if agent is None:
        raise HTTPException(status_code=404, detail="Agent not found")
    sync_agent_status(db, agent.id)
    db.commit()
    db.refresh(agent)
    return agent
