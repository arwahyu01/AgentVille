import type { TaskStatus } from '../types'

export const statusLabel: Record<TaskStatus, string> = {
  pending: 'Antrean',
  clarifying: 'Menunggu jawabanmu',
  awaiting_approval: 'Butuh persetujuan',
  approved: 'Disetujui',
  queued: 'Antrean',
  running: 'Dikerjakan',
  reviewing: 'QC',
  awaiting_acceptance: 'Menunggu persetujuan akhir',
  completed: 'Selesai',
  failed: 'Gagal',
  cancelled: 'Dibatalkan',
}

/** Work is still moving (or about to move) without a human decision. */
export const ACTIVE_STATUSES: TaskStatus[] = ['approved', 'queued', 'running', 'reviewing']

export function isActive(status: TaskStatus): boolean {
  return ACTIVE_STATUSES.includes(status)
}
