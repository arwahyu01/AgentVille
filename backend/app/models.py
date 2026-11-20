from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

def utcnow():
    return datetime.now(timezone.utc)

class Agent(Base):
    __tablename__ = "agents"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(80), nullable=False, unique=True)
    role: Mapped[str] = mapped_column(String(120), nullable=False)
    status: Mapped[str] = mapped_column(String(24), default="idle", nullable=False)
    position_x: Mapped[float] = mapped_column(default=0.0, nullable=False)
    position_z: Mapped[float] = mapped_column(default=0.0, nullable=False)
    # Where the agent physically is in the office and where it is heading, driven by real
    # workflow events (assignment/handoff/meeting) — never guessed from the coarse status.
    current_room: Mapped[str] = mapped_column(String(40), default="", nullable=False)
    target_room: Mapped[str] = mapped_column(String(40), default="", nullable=False)
    workstation: Mapped[str] = mapped_column(String(60), default="", nullable=False)
    active_step_index: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, server_default=text("CURRENT_TIMESTAMP"), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, server_default=text("CURRENT_TIMESTAMP"), nullable=False)
    tasks: Mapped[list["Task"]] = relationship(back_populates="agent")

class Settings(Base):
    __tablename__ = "settings"
    key: Mapped[str] = mapped_column(String(80), primary_key=True)
    value: Mapped[str] = mapped_column(Text, nullable=False)

class User(Base):
    """Console login. Only the PBKDF2 hash is stored; the plaintext password never is."""
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    username: Mapped[str] = mapped_column(String(160), nullable=False, unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(Text, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

class Task(Base):
    __tablename__ = "tasks"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    title: Mapped[str] = mapped_column(String(160), nullable=False)
    description: Mapped[str] = mapped_column(Text, default="", nullable=False)
    status: Mapped[str] = mapped_column(String(24), default="pending", nullable=False, index=True)
    priority: Mapped[str] = mapped_column(String(16), default="normal", nullable=False)
    agent_id: Mapped[int | None] = mapped_column(ForeignKey("agents.id"), nullable=True, index=True)
    parent_id: Mapped[int | None] = mapped_column(ForeignKey("tasks.id"), nullable=True, index=True)
    run_mode: Mapped[str] = mapped_column(String(16), default="manual", nullable=False)
    plan_json: Mapped[str] = mapped_column(Text, default="", nullable=False)
    result: Mapped[str] = mapped_column(Text, default="", nullable=False)
    artifact_path: Mapped[str] = mapped_column(String(300), default="", nullable=False)
    conversation_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    plan_step_index: Mapped[int | None] = mapped_column(Integer, nullable=True)
    required: Mapped[str] = mapped_column(String(2), default="1", nullable=False)
    acceptance_criteria: Mapped[str] = mapped_column(Text, default="", nullable=False)
    provider_used: Mapped[str | None] = mapped_column(String(32), nullable=True)
    model_used: Mapped[str | None] = mapped_column(String(120), nullable=True)
    # DAG persistence + parallel scheduling: dependency step indexes (survive restart),
    # an atomic lease so two workers/restarts never run the same node, and per-task
    # isolation so concurrent coding steps don't clobber each other's files.
    depends_on_json: Mapped[str] = mapped_column(Text, default="", nullable=False)
    lease_owner: Mapped[str | None] = mapped_column(String(64), nullable=True)
    lease_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    heartbeat_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    attempt: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    branch: Mapped[str] = mapped_column(String(120), default="", nullable=False)
    worktree_path: Mapped[str] = mapped_column(String(300), default="", nullable=False)
    # A QC-only rerun is requested for a failed anchor: no step revision, no landing edits,
    # just a fresh evidence-backed review of the work that already exists.
    qc_rerun_requested: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)
    agent: Mapped[Agent | None] = relationship(back_populates="tasks")
    events: Mapped[list["TaskEvent"]] = relationship(back_populates="task", cascade="all, delete-orphan")

class Handoff(Base):
    """A handoff is workflow data, not just result text: an explicit artifact transfer from
    one specialist to the next that can be accepted/declined and drives office animation."""
    __tablename__ = "handoffs"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    task_id: Mapped[int] = mapped_column(ForeignKey("tasks.id"), nullable=False, index=True)
    step_index: Mapped[int | None] = mapped_column(Integer, nullable=True)
    conversation_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    from_agent_id: Mapped[int | None] = mapped_column(ForeignKey("agents.id"), nullable=True)
    to_agent_id: Mapped[int | None] = mapped_column(ForeignKey("agents.id"), nullable=True)
    artifact_ref: Mapped[str] = mapped_column(String(300), default="", nullable=False)
    status: Mapped[str] = mapped_column(String(16), default="requested", nullable=False)
    note: Mapped[str] = mapped_column(Text, default="", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)

class TaskEvent(Base):
    __tablename__ = "task_events"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    task_id: Mapped[int] = mapped_column(ForeignKey("tasks.id"), nullable=False, index=True)
    event_type: Mapped[str] = mapped_column(String(32), nullable=False)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    conversation_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    agent_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    provider: Mapped[str | None] = mapped_column(String(32), nullable=True)
    model: Mapped[str | None] = mapped_column(String(120), nullable=True)
    step_index: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Domain-event routing: who acts, who receives, and which rooms are involved, so the 3D
    # office can animate a specific move/handoff/meeting instead of guessing from a status.
    actor_agent_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    recipient_agent_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    from_room: Mapped[str | None] = mapped_column(String(40), nullable=True)
    to_room: Mapped[str | None] = mapped_column(String(40), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    task: Mapped[Task] = relationship(back_populates="events")

class Conversation(Base):
    __tablename__ = "conversations"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    channel: Mapped[str] = mapped_column(String(16), default="web", nullable=False)
    user_identity: Mapped[str] = mapped_column(String(120), default="local", nullable=False)
    title: Mapped[str] = mapped_column(String(160), default="", nullable=False)
    anchor_task_id: Mapped[int | None] = mapped_column(ForeignKey("tasks.id"), nullable=True)
    current_plan_version: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)
    messages: Mapped[list["Message"]] = relationship(back_populates="conversation", cascade="all, delete-orphan", order_by="Message.id")
    plans: Mapped[list["Plan"]] = relationship(back_populates="conversation", cascade="all, delete-orphan", order_by="Plan.version")

class Message(Base):
    __tablename__ = "messages"
    __table_args__ = (UniqueConstraint("conversation_id", "external_id"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    conversation_id: Mapped[int] = mapped_column(ForeignKey("conversations.id"), nullable=False, index=True)
    role: Mapped[str] = mapped_column(String(16), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    channel: Mapped[str] = mapped_column(String(16), default="web", nullable=False)
    external_id: Mapped[str | None] = mapped_column(String(80), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    conversation: Mapped[Conversation] = relationship(back_populates="messages")

class Plan(Base):
    __tablename__ = "plans"
    __table_args__ = (UniqueConstraint("conversation_id", "version"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    conversation_id: Mapped[int] = mapped_column(ForeignKey("conversations.id"), nullable=False, index=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String(16), default="proposed", nullable=False)
    summary: Mapped[str] = mapped_column(Text, default="", nullable=False)
    steps_json: Mapped[str] = mapped_column(Text, default="", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    conversation: Mapped[Conversation] = relationship(back_populates="plans")

class Approval(Base):
    __tablename__ = "approvals"
    __table_args__ = (UniqueConstraint("plan_id", "decision"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    plan_id: Mapped[int] = mapped_column(ForeignKey("plans.id"), nullable=False, index=True)
    conversation_id: Mapped[int] = mapped_column(ForeignKey("conversations.id"), nullable=False, index=True)
    decision: Mapped[str] = mapped_column(String(16), nullable=False)
    decided_by: Mapped[str] = mapped_column(String(120), default="local", nullable=False)
    reason: Mapped[str] = mapped_column(Text, default="", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)

class QcReview(Base):
    __tablename__ = "qc_reviews"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    task_id: Mapped[int] = mapped_column(ForeignKey("tasks.id"), nullable=False, index=True)
    plan_id: Mapped[int | None] = mapped_column(ForeignKey("plans.id"), nullable=True)
    iteration: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    verdict: Mapped[str] = mapped_column(String(16), nullable=False)
    criteria_json: Mapped[str] = mapped_column(Text, default="", nullable=False)
    findings: Mapped[str] = mapped_column(Text, default="", nullable=False)
    evidence: Mapped[str] = mapped_column(Text, default="", nullable=False)
    # Provenance for the verdict: the exact refs the reviewer was allowed to cite, and which
    # provider/model produced the review (a rerun can differ from the step provider).
    artifacts_json: Mapped[str] = mapped_column(Text, default="", nullable=False)
    provider: Mapped[str | None] = mapped_column(String(32), nullable=True)
    model: Mapped[str | None] = mapped_column(String(120), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)

class OfficeEvent(Base):
    """Journal for the office simulation itself (patrols, cleaning) — independent of any task,
    so TaskEvent.task_id stays non-null. dedupe_key makes each scheduled slot idempotent:
    the daemon can crash or restart mid-slot and the replayed tick cannot double-record."""
    __tablename__ = "office_events"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    dedupe_key: Mapped[str] = mapped_column(String(120), nullable=False, unique=True)
    event_type: Mapped[str] = mapped_column(String(40), nullable=False, index=True)
    message: Mapped[str] = mapped_column(Text, default="", nullable=False)
    actor_agent_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    actor_name: Mapped[str] = mapped_column(String(80), default="", nullable=False)
    from_room: Mapped[str | None] = mapped_column(String(40), nullable=True)
    to_room: Mapped[str | None] = mapped_column(String(40), nullable=True)
    area: Mapped[str] = mapped_column(String(40), default="", nullable=False)
    status: Mapped[str] = mapped_column(String(16), default="", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)

class TelegramUpdate(Base):
    __tablename__ = "telegram_updates"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    update_id: Mapped[int] = mapped_column(Integer, nullable=False, unique=True, index=True)
    chat_id: Mapped[str] = mapped_column(String(80), default="", nullable=False)
    processed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)

class TelegramOutbox(Base):
    """Durable outbound queue for Telegram. dedupe_key makes replies idempotent across
    retries and process restarts; delivery state lives here, not in memory."""
    __tablename__ = "telegram_outbox"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    chat_id: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    dedupe_key: Mapped[str] = mapped_column(String(200), nullable=False, unique=True)
    status: Mapped[str] = mapped_column(String(16), default="pending", nullable=False, index=True)
    attempts: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    telegram_message_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    last_error: Mapped[str] = mapped_column(Text, default="", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

class ClaudeSession(Base):
    """A Claude Code session seen through the optional AgentVille hooks. Only short, redacted
    summaries are kept (never file contents, full commands or full prompts)."""
    __tablename__ = "claude_sessions"
    session_id: Mapped[str] = mapped_column(String(80), primary_key=True)
    project: Mapped[str] = mapped_column(String(120), default="", nullable=False)
    cwd: Mapped[str] = mapped_column(String(400), default="", nullable=False)
    status: Mapped[str] = mapped_column(String(16), default="idle", nullable=False)
    activity: Mapped[str] = mapped_column(String(160), default="", nullable=False)
    permission_mode: Mapped[str] = mapped_column(String(24), default="", nullable=False)
    tool_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

class ClaudeEvent(Base):
    __tablename__ = "claude_events"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    session_id: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    event: Mapped[str] = mapped_column(String(40), nullable=False)
    summary: Mapped[str] = mapped_column(String(160), default="", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)


class IntegrationAccount(Base):
    """A connected external account. Tokens are DPAPI blobs, never plain text, and are never
    returned by any API. Connecting does NOT grant permission to post: that stays human-gated."""
    __tablename__ = "integration_accounts"
    __table_args__ = (UniqueConstraint("provider", "external_id"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    provider: Mapped[str] = mapped_column(String(24), nullable=False, index=True)
    external_id: Mapped[str] = mapped_column(String(160), nullable=False)
    label: Mapped[str] = mapped_column(String(160), default="", nullable=False)
    token: Mapped[str] = mapped_column(Text, default="", nullable=False)
    refresh_token: Mapped[str] = mapped_column(Text, default="", nullable=False)
    scopes: Mapped[str] = mapped_column(Text, default="", nullable=False)
    status: Mapped[str] = mapped_column(String(24), default="connected", nullable=False)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_error: Mapped[str] = mapped_column(Text, default="", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow,
                                                onupdate=utcnow, nullable=False)


class OAuthState(Base):
    """Single-use CSRF state for an OAuth round trip. No token is stored here."""
    __tablename__ = "oauth_states"
    state: Mapped[str] = mapped_column(String(80), primary_key=True)
    provider: Mapped[str] = mapped_column(String(24), nullable=False)
    redirect_uri: Mapped[str] = mapped_column(String(400), nullable=False)
    used: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)


class PublishCredential(Base):
    """API credentials for a custom REST endpoint. Token is a DPAPI blob, never plain text."""
    __tablename__ = "publish_credentials"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(80), nullable=False)
    # Legacy HTTP-only columns are kept for additive migrations, but the dry24 bridge uses CLI.
    api_url: Mapped[str] = mapped_column(String(500), default="", nullable=False)
    method: Mapped[str] = mapped_column(String(8), default="CLI", nullable=False)
    token: Mapped[str] = mapped_column(Text, default="", nullable=False)
    auth_header: Mapped[str] = mapped_column(String(60), default="", nullable=False)
    auth_scheme: Mapped[str] = mapped_column(String(30), default="", nullable=False)
    field_map_json: Mapped[str] = mapped_column(Text, default="", nullable=False)
    headers_json: Mapped[str] = mapped_column(Text, default="{}", nullable=False)
    # Local-CLI bridge: AgentVille never reads dry24's .env, it only invokes php artisan.
    cli_project: Mapped[str] = mapped_column(String(500), default="", nullable=False)
    cli_php: Mapped[str] = mapped_column(String(300), default="", nullable=False)
    enabled: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)


class PublishJob(Base):
    """One external publish attempt. Preview is computed first; sending needs explicit approval."""
    __tablename__ = "publish_jobs"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    provider: Mapped[str] = mapped_column(String(24), nullable=False, index=True)
    credential_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    account_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    title: Mapped[str] = mapped_column(String(200), default="", nullable=False)
    payload_json: Mapped[str] = mapped_column(Text, default="", nullable=False)
    preview_json: Mapped[str] = mapped_column(Text, default="", nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="preview", nullable=False, index=True)
    response_json: Mapped[str] = mapped_column(Text, default="", nullable=False)
    error: Mapped[str] = mapped_column(Text, default="", nullable=False)
    approved_by: Mapped[str] = mapped_column(String(80), default="", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class NewsRun(Base):
    """One scheduled news draft per local day. Unique date makes the scheduler idempotent."""
    __tablename__ = "news_runs"
    __table_args__ = (UniqueConstraint("run_date"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    run_date: Mapped[str] = mapped_column(String(10), nullable=False)
    topics: Mapped[str] = mapped_column(Text, default="", nullable=False)
    conversation_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="queued", nullable=False)
    error: Mapped[str] = mapped_column(Text, default="", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)

