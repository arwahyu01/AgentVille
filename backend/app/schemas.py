from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, ConfigDict

TaskStatus = Literal["pending", "clarifying", "awaiting_approval", "approved",
                     "queued", "running", "reviewing", "completed", "failed", "cancelled"]
Priority = Literal["low", "normal", "high"]
AgentStatus = Literal["idle", "working", "waiting", "reviewing", "completed", "failed"]

class AgentRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    role: str
    status: AgentStatus
    position_x: float
    position_z: float
    current_room: str = ""
    target_room: str = ""
    workstation: str = ""
    active_step_index: int | None = None

class TaskCreate(BaseModel):
    title: str = Field(min_length=1, max_length=160)
    description: str = Field(default="", max_length=4000)
    priority: Priority = "normal"
    agent_id: int | None = None

class TaskUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=160)
    description: str | None = Field(default=None, max_length=4000)
    priority: Priority | None = None
    agent_id: int | None = None
    status: TaskStatus | None = None

class TaskRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    title: str
    description: str
    status: TaskStatus
    priority: Priority
    agent_id: int | None
    parent_id: int | None
    conversation_id: int | None = None
    run_mode: str
    artifact_path: str
    provider_used: str | None = None
    model_used: str | None = None
    qc_rerun_requested: bool = False
    plan_step_index: int | None = None
    required: str = "1"
    created_at: datetime
    updated_at: datetime

class QcReviewRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    iteration: int
    verdict: str
    findings: str
    evidence: str
    artifacts_json: str = ""
    provider: str | None = None
    model: str | None = None

class PreviewFile(BaseModel):
    path: str
    size: int = 0


class PreviewRead(BaseModel):
    """What the crew actually produced, ready for the UI to render."""
    kind: Literal["web", "image", "video", "markdown", "text", "none"] = "none"
    entry: str = ""
    url: str = ""
    size: int = 0
    files: list[PreviewFile] = []


class TaskResultRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    title: str
    status: TaskStatus
    run_mode: str
    result: str
    artifact_path: str
    children: list[TaskRead] = []
    plan_steps: list[dict] = []
    qc_reviews: list[QcReviewRead] = []
    diff_path: str = ""
    preview: PreviewRead = Field(default_factory=PreviewRead)

class ExecuteRequest(BaseModel):
    mode: Literal["direct", "plan"] = "direct"

class AIConfigRead(BaseModel):
    ai_enabled: bool
    ai_model: str
    ai_timeout_s: int
    provider: str = "opencode"
    ai_model_qoder: str = "Efficient"
    ai_model_claude: str = "sonnet"
    fallback_enabled: bool = False
    retry_max: int = 1
    agent_chat_mode: Literal["static", "milestone", "full"] = "static"
    rotate_models_enabled: bool = True
    rotate_models_max: int = 4
    providers: dict = {}

class AIConfigPatch(BaseModel):
    ai_enabled: bool | None = None
    ai_model: str | None = Field(default=None, max_length=80)
    ai_model_qoder: str | None = Field(default=None, max_length=80)
    ai_model_claude: str | None = Field(default=None, max_length=80)
    provider: Literal["opencode", "qoder", "claude"] | None = None
    ai_timeout_s: int | None = Field(default=None, ge=10, le=1800)
    fallback_enabled: bool | None = None
    retry_max: int | None = Field(default=None, ge=0, le=3)
    agent_chat_mode: Literal["static", "milestone", "full"] | None = None
    rotate_models_enabled: bool | None = None
    rotate_models_max: int | None = Field(default=None, ge=1, le=100)

class TaskEventRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    task_id: int
    event_type: str
    message: str
    created_at: datetime
    conversation_id: int | None = None
    agent_id: int | None = None
    provider: str | None = None
    model: str | None = None
    step_index: int | None = None
    actor_agent_id: int | None = None
    recipient_agent_id: int | None = None
    from_room: str | None = None
    to_room: str | None = None

class OfficeEventRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    dedupe_key: str
    event_type: str
    message: str
    actor_agent_id: int | None
    actor_name: str
    from_room: str | None
    to_room: str | None
    area: str
    status: str
    created_at: datetime

class TeamEventRead(BaseModel):
    """A journal frame enriched for the Team Conversation panel: who spoke (name/role),
    who it was addressed to, and which task/step the update belongs to."""
    id: int
    task_id: int
    task_title: str
    event_type: str
    message: str
    created_at: datetime
    agent_id: int | None = None
    agent_name: str | None = None
    agent_role: str | None = None
    step_index: int | None = None
    provider: str | None = None
    model: str | None = None
    actor_agent_id: int | None = None
    actor_name: str | None = None
    recipient_agent_id: int | None = None
    recipient_name: str | None = None
    conversation_id: int | None = None

class ReassignRequest(BaseModel):
    """Hand a stuck step to another employee, with the leader's reason attached."""
    agent_id: int
    note: str = Field(default="", max_length=1000)

class ClearTasksResult(BaseModel):
    stopped: list[int] = []
    count: int = 0

class ConversationCreate(BaseModel):
    first_message: str = Field(min_length=1, max_length=4000)
    channel: Literal["web", "telegram"] = "web"

class ConversationRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    channel: str
    user_identity: str
    title: str
    anchor_task_id: int | None
    current_plan_version: int
    status: str
    created_at: datetime
    updated_at: datetime

class MessageCreate(BaseModel):
    content: str = Field(min_length=1, max_length=8000)

class MessageRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    conversation_id: int
    role: str
    content: str
    channel: str
    created_at: datetime

class PlanRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    conversation_id: int
    version: int
    status: str
    summary: str
    created_at: datetime
    steps: list[dict] = []

class ApproveRequest(BaseModel):
    plan_version: int

class ReviseRequest(BaseModel):
    notes: str = Field(min_length=1, max_length=2000)

class CharacterChatTurn(BaseModel):
    role: Literal["visitor", "character"]
    text: str = Field(min_length=1, max_length=2000)

class CharacterChatRequest(BaseModel):
    character: str = Field(min_length=1, max_length=40)
    message: str = Field(min_length=1, max_length=2000)
    history: list[CharacterChatTurn] = Field(default_factory=list, max_length=20)

class CharacterChatRead(BaseModel):
    reply: str
    ai: bool = True
    provider: str
    model: str
    latency_s: float = 0.0
