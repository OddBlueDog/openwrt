// The theme editor's form: what the theme is called, and the colours it
// changes from its base, per scheme.
import { z } from 'zod';
import type { ColorChanges, SchemeName } from '@/theme/custom';

export const themeFormSchema = z.object({
  name: z.string().refine((v) => v.trim() !== '', 'Give it a name.'),
  colors: z.custom<Record<SchemeName, ColorChanges>>(),
});

export type ThemeForm = z.infer<typeof themeFormSchema>;
