export type AgentStatus = 'idle' | 'working' | 'waiting' | 'reviewing' | 'completed' | 'failed'
export type TaskStatus =
  | 'pending' | 'clarifying' | 'awaiting_approval' | 'approved' | 'queued'
  | 'running' | 'reviewing' | 'completed' | 'failed' | 'cancelled'

export interface Agent {
  id: number
  name: string
  role: string
  status: AgentStatus
  position_x: number
  position_z: number
  current_room?: string
  target_room?: string
  workstation?: string
  active_step_index?: number | null
}

export interface Task {
  id: number
  title: string
  description: string
  status: TaskStatus
  priority: 'low' | 'normal' | 'high'
  agent_id: number | null
  parent_id: number | null
  conversation_id?: number | null
  run_mode: string
  artifact_path: string
  provider_used?: string | null
  model_used?: string | null
  plan_step_index?: number | null
  required?: string
  created_at: string
  updated_at: string
}

export type ProviderName = 'opencode' | 'qoder' | 'claude'

export interface ProviderInfo {
  available: boolean
  reason: string | null
  coding: boolean
  coding_flags?: string
}

export type AgentChatMode = 'static' | 'milestone' | 'full'

export interface AiConfig {
  ai_enabled: boolean
  ai_model: string
  ai_timeout_s: number
  provider: ProviderName
  ai_model_qoder: string
  ai_model_claude?: string
  fallback_enabled: boolean
  retry_max: number
  agent_chat_mode: AgentChatMode
  rotate_models_enabled: boolean
  rotate_models_max: number
  external_approval_enabled?: boolean
  providers?: Record<ProviderName, ProviderInfo>
}

export interface Conversation {
  id: number
  channel: string
  user_identity: string
  title: string
  anchor_task_id: number | null
  current_plan_version: number
  status: string
  created_at: string
  updated_at: string
}

export interface ChatMessage {
  id: number
  conversation_id: number
  role: 'user' | 'assistant' | 'system'
  content: string
  channel: string
  created_at: string
}

export interface PlanStep {
  title: string
  instruction: string
  agent_role: string
  depends_on: number[]
  required?: boolean
  acceptance_criteria?: string[]
  uses_tools?: boolean
  tools?: string[]
  risk?: 'low' | 'medium' | 'high'
}

export interface PlanRead {
  id: number
  conversation_id: number
  version: number
  status: string
  summary: string
  goal?: string
  scope?: string
  assumptions?: string[]
  risks?: string[]
  external_actions?: string[]
  requires_approval?: boolean
  approval_reasons?: string[]
  created_at: string
  steps: PlanStep[]
}

export interface PlanInfo {
  current: PlanRead | null
  history: PlanRead[]
}

export interface QcReview {
  id: number
  iteration: number
  verdict: string
  findings: string
  evidence: string
}

export type PreviewKind = 'web' | 'image' | 'video' | 'markdown' | 'text' | 'none'

export interface PreviewFile {
  path: string
  size: number
}

/** What the crew actually produced: a site, an image, a video or a document. */
export interface PreviewInfo {
  kind: PreviewKind
  entry: string
  url: string
  size: number
  files: PreviewFile[]
}

export interface TaskResult {
  id: number
  title: string
  status: TaskStatus
  run_mode: string
  result: string
  artifact_path: string
  children: Task[]
  plan_steps?: PlanStep[]
  plan_meta?: {
    summary?: string
    goal?: string
    scope?: string
    assumptions?: string[]
    risks?: string[]
    external_actions?: string[]
    acceptance_criteria?: string[]
  }
  failure_reason?: string
  qc_reviews?: QcReview[]
  diff_path?: string
  preview?: PreviewInfo
}

export interface TaskEvent {
  id: number
  task_id: number
  event_type: string
  message: string
  conversation_id?: number | null
  agent_id?: number | null
  provider?: string | null
  model?: string | null
  step_index?: number | null
  actor_agent_id?: number | null
  recipient_agent_id?: number | null
  from_room?: string | null
  to_room?: string | null
  created_at: string
}

export interface AuthUser {
  id: number
  username: string
}

export interface StreamEvent {
  /** Two journals share the SSE stream and have independent id sequences. */
  kind: 'task' | 'office'
  id: number
  taskId: number
  type: string
  message: string
  conversationId: number | null
  agentId: number | null
  provider: string | null
  model: string | null
  stepIndex: number | null
  actorAgentId?: number | null
  recipientAgentId?: number | null
  fromRoom?: string | null
  toRoom?: string | null
  /** Office journal only: the zone a patrol/cleaning step refers to. */
  area?: string
  createdAt: string | null
}

export interface ChannelStatus {
  telegram: { configured: boolean; reason: string | null; running: boolean; allowed_chats: number; outbox_pending?: number }
}

/** A task journal frame joined with its speaker and task, from /api/events/team. */
export interface TeamEvent {
  id: number
  task_id: number
  task_title: string
  event_type: string
  message: string
  created_at: string | null
  agent_id: number | null
  agent_name: string | null
  agent_role: string | null
  step_index: number | null
  provider: string | null
  model: string | null
  actor_agent_id?: number | null
  actor_name?: string | null
  recipient_agent_id?: number | null
  recipient_name?: string | null
  conversation_id?: number | null
}

export interface ClearTasksResult {
  stopped: number[]
  count: number
}

export interface CharacterChatTurn {
  role: 'visitor' | 'character'
  text: string
}

export interface CharacterChatReply {
  reply: string
  ai: boolean
  provider: string
  model: string
  latency_s: number
}

/** Local-CLI bridge to the dry24 Laravel app on the same server. No token is stored. */
export interface PublishCredential {
  id: number
  name: string
  cli_project: string
  cli_php: string
  field_map: Record<string, string>
  enabled: boolean
  created_at: string | null
}

export interface PublishJob {
  id: number
  provider: 'dry24' | 'instagram'
  title: string
  credential_id: number | null
  account_id: number | null
  status: 'preview' | 'approved' | 'sending' | 'published' | 'failed'
  error: string
  approved_by: string
  preview: Record<string, unknown> | null
  response: Record<string, unknown> | null
  created_at: string | null
  approved_at: string | null
  published_at: string | null
}

export interface NewsRunInfo {
  id: number
  run_date: string
  status: string
  conversation_id: number | null
  error: string
  topics: string
}

export interface PublishPreset {
  name: string
  cli_project: string
  cli_php: string
  field_map: Record<string, string>
  command: string
  note: string
}

export interface PublishStatus {
  /** DPAPI is still used for Instagram/Meta credentials; dry24 CLI needs no token at all. */
  storage: 'dpapi' | 'unavailable'
  preset: PublishPreset
  credentials: PublishCredential[]
  instagram_accounts: { id: number; label: string; external_id: string; status: string }[]
  jobs: PublishJob[]
  gate: string
}

export interface ScheduleStatus {
  enabled: boolean
  hour: number
  topics: string
  max_items: number
  runs: NewsRunInfo[]
}

export type ClaudeSessionStatus = 'idle' | 'working' | 'waiting' | 'completed' | 'failed'

export type IntegrationProvider = 'instagram' | 'youtube' | 'meta_ads'

export interface IntegrationAccount {
  id: number
  provider: IntegrationProvider
  label: string
  external_id: string
  status: string
  scopes: string
  expires_at: string | null
  verified_at: string | null
  has_refresh_token: boolean
  last_error: string
  created_at: string | null
}

export interface IntegrationStatus {
  configured: Record<IntegrationProvider, boolean>
  storage: 'dpapi' | 'unavailable'
  redirect_uri: string
  accounts: IntegrationAccount[]
  note: string
}

export interface ClaudeSessionEvent {
  event: string
  summary: string
  created_at: string
}

export interface ClaudeSession {
  session_id: string
  project: string
  cwd: string
  status: ClaudeSessionStatus
  activity: string
  permission_mode: string
  tool_count: number
  started_at: string
  updated_at: string
  events: ClaudeSessionEvent[]
}
