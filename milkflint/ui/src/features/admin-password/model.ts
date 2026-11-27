// Router access's password form: a new password of at least 8 characters,
// typed twice.
import { z } from 'zod';

export const passwordFormSchema = z
  .object({
    pw: z.string().min(8, 'Use at least 8 characters.'),
    again: z.string(),
  })
  .superRefine((f, ctx) => {
    if (f.again !== f.pw) ctx.addIssue({ code: 'custom', path: ['again'], message: 'The two don’t match.' });
  });

export type PasswordForm = z.infer<typeof passwordFormSchema>;

export const EMPTY_PASSWORD: PasswordForm = { pw: '', again: '' };
