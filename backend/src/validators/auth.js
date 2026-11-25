import { z } from 'zod';

const email = z.string().trim().toLowerCase().email().max(254);
const password = z.string().min(12).max(128)
  .regex(/[A-Z]/, 'Password must include an uppercase letter.')
  .regex(/[0-9]/, 'Password must include a number.')
  .regex(/[!@#$%^&*]/, 'Password must include a special character.');

export const registerSchema = z.object({
  body: z.object({
    name: z.string().trim().min(1).max(120),
    email,
    password,
    phone: z.string().trim().max(32).optional(),
  }),
});

export const loginSchema = z.object({
  body: z.object({
    email,
    password: z.string().min(1).max(128),
  }),
});

export const refreshSessionSchema = z.object({
  body: z.object({ refreshToken: z.string().min(20).max(2048) }).strict(),
});

export const emailSchema = z.object({ body: z.object({ email }) });

export const verifyEmailSchema = z.object({
  body: z.object({
    email: email.optional(),
    token: z.string().min(32).max(256).optional(),
    accessToken: z.string().min(32).optional(),
  }).refine((value) => value.accessToken || value.token, {
    message: 'A Supabase access token or email verification token is required.',
  }),
});

export const resetPasswordSchema = z.object({
  body: z.object({ newPassword: password, accessToken: z.string().min(32).optional() }),
});

export const changePasswordSchema = z.object({
  body: z.object({ currentPassword: z.string().min(1).max(128), newPassword: password }).strict(),
});
