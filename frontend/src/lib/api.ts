import type { Agent, AiConfig, ChannelStatus, ClaudeSession, CharacterChatReply, CharacterChatTurn, ChatMessage, ClearTasksResult, Conversation, PlanInfo, PlanRead, ProviderName, Task, TaskEvent, TaskResult, TeamEvent } from '../types'

// Relative by default so the page keeps working when opened from another device on the LAN;
// Vite proxies `/api` to the backend. Override with VITE_API_BASE only for split deployments.
export const API_BASE = import.meta.env.VITE_API_BASE ?? ''

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
  resumeTask: (id: number) => request<Task>(`/api/tasks/${id}/resume`, { method: 'POST' }),
  qcRerun: (id: number) => request<Task>(`/api/tasks/${id}/qc-rerun`, { method: 'POST' }),
  taskResult: (id: number) => request<TaskResult>(`/api/tasks/${id}/result`),
  conversations: () => request<Conversation[]>('/api/conversations'),
  createConversation: (first_message: string) =>
    request<Conversation>('/api/conversations', { method: 'POST', body: JSON.stringify({ first_message }) }),
  conversationMessages: (id: number) => request<ChatMessage[]>(`/api/conversations/${id}/messages`),
  postConversationMessage: (id: number, content: string) =>
    request<ChatMessage>(`/api/conversations/${id}/messages`, { method: 'POST', body: JSON.stringify({ content }) }),
  conversationPlan: (id: number) => request<PlanInfo>(`/api/conversations/${id}/plan`),
  approvePlan: (id: number, plan_version: number) =>
    request<PlanRead>(`/api/conversations/${id}/approve`, { method: 'POST', body: JSON.stringify({ plan_version }) }),
  acceptResult: (id: number) => request<Conversation>(`/api/conversations/${id}/accept`, { method: 'POST' }),
  revisePlan: (id: number, notes: string) =>
    request<Conversation>(`/api/conversations/${id}/revise`, { method: 'POST', body: JSON.stringify({ notes }) }),
  cancelConversation: (id: number) =>
    request<Conversation>(`/api/conversations/${id}/cancel`, { method: 'POST' }),
  channelsStatus: () => request<ChannelStatus>('/api/channels/status'),
  teamEvents: (limit = 60, conversationId?: number) =>
    request<TeamEvent[]>(`/api/events/team?limit=${limit}${conversationId ? `&conversation_id=${conversationId}` : ''}`),
  characterChat: (character: string, message: string, history: CharacterChatTurn[], signal?: AbortSignal) =>
    request<CharacterChatReply>('/api/characters/chat', {
      method: 'POST',
      body: JSON.stringify({ character, message, history }),
      signal,
    }),
}
