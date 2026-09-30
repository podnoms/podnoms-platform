import { z } from 'zod'

export const credentialsSchema = z.object({
  // Stored lowercased so sign-in is case-insensitive.
  email: z.string().trim().toLowerCase().pipe(z.email('Enter a valid email address').max(254)),
  password: z.string().min(8, 'Password must be at least 8 characters').max(200),
})
export type Credentials = z.infer<typeof credentialsSchema>
