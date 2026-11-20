import type { Agent, AiConfig, ChannelStatus, ClaudeSession, CharacterChatReply, CharacterChatTurn, ChatMessage, ClearTasksResult, Conversation, IntegrationAccount, IntegrationProvider, IntegrationStatus, PlanInfo, PlanRead, ProviderName, PublishCredential, PublishJob, PublishStatus, ScheduleStatus, Task, TaskEvent, TaskResult, TeamEvent } from '../types'

// Relative by default so the page keeps working when opened from another device on the LAN;
// Vite proxies `/api` to the backend. Override with VITE_API_BASE only for split deployments.
export const API_BASE = import.meta.env.VITE_API_BASE ?? ''

/** One id per submit, so a retried/double-clicked request is stored once. */
export function clientId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `web-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  })
  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    throw new Error(body.detail ?? `Request failed (${response.status})`)
  }
  return response.json() as Promise<T>
}

export const api = {
  health: () => request<{ status: string }>('/api/health'),
  agents: () => request<Agent[]>('/api/agents'),
  tasks: () => request<Task[]>('/api/tasks'),
  events: (taskId: number) => request<TaskEvent[]>(`/api/tasks/${taskId}/events`),
  createTask: (payload: { title: string; description: string; priority: string; agent_id: number | null }) =>
    request<Task>('/api/tasks', { method: 'POST', body: JSON.stringify(payload) }),
  updateTask: (id: number, payload: Partial<Pick<Task, 'title' | 'description' | 'priority' | 'agent_id' | 'status'>>) =>
    request<Task>(`/api/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  cancelTask: (id: number) => request<Task>(`/api/tasks/${id}/cancel`, { method: 'POST' }),
  stopTask: (id: number) => request<Task>(`/api/tasks/${id}/stop`, { method: 'POST' }),
  clearTasks: () => request<ClearTasksResult>('/api/tasks/clear', { method: 'POST' }),
  reassignTask: (id: number, agent_id: number, note = '') =>
    request<Task>(`/api/tasks/${id}/reassign`, { method: 'POST', body: JSON.stringify({ agent_id, note }) }),
  aiConfig: () => request<AiConfig>('/api/ai/config'),
  claudeSessions: () => request<{ sessions: ClaudeSession[] }>('/api/claude/sessions'),
  patchAiConfig: (payload: Partial<AiConfig>) =>
    request<AiConfig>('/api/ai/config', { method: 'PATCH', body: JSON.stringify(payload) }),
  aiModels: (provider?: ProviderName) =>
    request<{ models: string[] }>(`/api/ai/models${provider ? `?provider=${provider}` : ''}`),
  executeTask: (id: number, mode: 'direct' | 'plan') =>
    request<Task>(`/api/tasks/${id}/execute`, { method: 'POST', body: JSON.stringify({ mode }) }),
  qcRerun: (id: number) => request<Task>(`/api/tasks/${id}/qc-rerun`, { method: 'POST' }),
  taskResult: (id: number) => request<TaskResult>(`/api/tasks/${id}/result`),
  conversations: () => request<Conversation[]>('/api/conversations'),
  createConversation: (first_message: string, client_message_id?: string) =>
    request<Conversation>('/api/conversations', {
      method: 'POST',
      body: JSON.stringify({ first_message, client_message_id }),
    }),
  conversationMessages: (id: number) => request<ChatMessage[]>(`/api/conversations/${id}/messages`),
  postConversationMessage: (id: number, content: string, client_message_id?: string) =>
    request<ChatMessage>(`/api/conversations/${id}/messages`, {
      method: 'POST',
      body: JSON.stringify({ content, client_message_id }),
    }),
  conversationPlan: (id: number) => request<PlanInfo>(`/api/conversations/${id}/plan`),
  approvePlan: (id: number, plan_version: number) =>
    request<PlanRead>(`/api/conversations/${id}/approve`, { method: 'POST', body: JSON.stringify({ plan_version }) }),
  revisePlan: (id: number, notes: string) =>
    request<Conversation>(`/api/conversations/${id}/revise`, { method: 'POST', body: JSON.stringify({ notes }) }),
  cancelConversation: (id: number) =>
    request<Conversation>(`/api/conversations/${id}/cancel`, { method: 'POST' }),
  channelsStatus: () => request<ChannelStatus>('/api/channels/status'),
  integrationStatus: () => request<IntegrationStatus>('/api/integrations'),
  integrationStart: (provider: IntegrationProvider) =>
    request<{ provider: IntegrationProvider; state: string; auth_url: string; redirect_uri: string }>(
      '/api/integrations/start', { method: 'POST', body: JSON.stringify({ provider }) }),
  integrationComplete: (provider: IntegrationProvider, code: string, state: string) =>
    request<IntegrationAccount>('/api/integrations/complete', {
      method: 'POST', body: JSON.stringify({ provider, code, state }),
    }),
  integrationSave: (payload: { provider: IntegrationProvider; access_token: string; refresh_token?: string; label?: string; external_id?: string }) =>
    request<IntegrationAccount>('/api/integrations/save', { method: 'POST', body: JSON.stringify(payload) }),
  integrationVerify: (id: number) => request<IntegrationAccount>(`/api/integrations/${id}/verify`, { method: 'POST' }),
  integrationDisconnect: (id: number) => request<{ ok: boolean }>(`/api/integrations/${id}/disconnect`, { method: 'POST' }),
  publishStatus: () => request<PublishStatus>('/api/publish/status'),
  publishSaveCredential: (payload: { name: string; api_url: string; token?: string; method?: string; auth_header?: string; auth_scheme?: string; field_map?: Record<string, string>; headers?: Record<string, string>; credential_id?: number | null }) =>
    request<PublishCredential>('/api/publish/credentials', { method: 'POST', body: JSON.stringify(payload) }),
  publishDeleteCredential: (id: number) => request<{ ok: boolean }>(`/api/publish/credentials/${id}`, { method: 'DELETE' }),
  publishPreview: (payload: { provider: 'dry24' | 'instagram'; article: Record<string, string>; credential_id?: number | null; account_id?: number | null; title?: string }) =>
    request<PublishJob>('/api/publish/preview', { method: 'POST', body: JSON.stringify(payload) }),
  publishApprove: (id: number) => request<PublishJob>(`/api/publish/${id}/approve`, { method: 'POST' }),
  publishExecute: (id: number) => request<PublishJob>(`/api/publish/${id}/execute`, { method: 'POST' }),
  publishSchedule: () => request<ScheduleStatus>('/api/publish/schedule'),
  publishPatchSchedule: (payload: { enabled: boolean; hour: number; topics: string; max_items: number }) =>
    request<ScheduleStatus>('/api/publish/schedule', { method: 'PATCH', body: JSON.stringify(payload) }),
  publishScheduleDryRun: () => request<{ ran: boolean; reason: string; prompt?: string }>('/api/publish/schedule/dry-run', { method: 'POST' }),
  teamEvents: (limit = 60, conversationId?: number) =>
    request<TeamEvent[]>(`/api/events/team?limit=${limit}${conversationId ? `&conversation_id=${conversationId}` : ''}`),
  characterChat: (character: string, message: string, history: CharacterChatTurn[], signal?: AbortSignal) =>
    request<CharacterChatReply>('/api/characters/chat', {
      method: 'POST',
      body: JSON.stringify({ character, message, history }),
      signal,
    }),
}
