import { z } from 'zod'

const passwordSchema = z.string().min(8, 'Password must be at least 8 characters').max(200)

export const credentialsSchema = z.object({
  // Stored lowercased so sign-in is case-insensitive.
  email: z.string().trim().toLowerCase().pipe(z.email('Enter a valid email address').max(254)),
  password: passwordSchema,
})
export type Credentials = z.infer<typeof credentialsSchema>

// Setting a password on the security settings page. The current password is
// needed only to change one, not to add one to an OAuth-only account.
export const setPasswordSchema = z
  .object({
    currentPassword: z.string().max(200).optional(),
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((input) => input.password === input.confirmPassword, {
    message: "The passwords don't match",
    path: ['confirmPassword'],
  })
export type SetPasswordInput = z.infer<typeof setPasswordSchema>
