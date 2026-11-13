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
  created_at: string
  updated_at: string
}

export type ProviderName = 'opencode' | 'qoder'

export interface ProviderInfo {
  available: boolean
  reason: string | null
  coding: boolean
  coding_flags?: string
}

export interface AiConfig {
  ai_enabled: boolean
  ai_model: string
  ai_timeout_s: number
  provider: ProviderName
  ai_model_qoder: string
  fallback_enabled: boolean
  retry_max: number
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
}

export interface PlanRead {
  id: number
  conversation_id: number
  version: number
  status: string
  summary: string
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

export interface TaskResult {
  id: number
  title: string
  status: TaskStatus
  run_mode: string
  result: string
  artifact_path: string
  children: Task[]
  plan_steps?: PlanStep[]
  qc_reviews?: QcReview[]
  diff_path?: string
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
