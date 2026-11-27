// The sign-in form: the admin password, whatever it is (none counts too).
import { z } from 'zod';

export const loginFormSchema = z.object({ password: z.string() });
