import { z } from 'zod'

export const taskFormSchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(160, 'Title is too long (max 160 characters)'),
  description: z.string().trim().max(4000, 'Description is too long (max 4000 characters)'),
  priority: z.enum(['low', 'normal', 'high']),
})

export type TaskFormValues = z.infer<typeof taskFormSchema>

export function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? 'Invalid input'
}
