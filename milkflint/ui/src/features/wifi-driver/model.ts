// The Wi-Fi driver page's form: every band's radio as Networks & radios
// loads it (wifi/model.ts's RadioForm), of which this page edits only the
// driver's part. Its checks are the bands' own (validateDriver), each error
// on its band's field.
import { z } from 'zod';
import { type RadioForm, validateDriver } from '../wifi/model';

export const driverFormSchema = z.object({ radios: z.array(z.custom<RadioForm>()) }).superRefine((f, ctx) => {
  f.radios.forEach((radio, i) => {
    for (const [key, message] of Object.entries(validateDriver(radio))) {
      ctx.addIssue({ code: 'custom', path: ['radios', i, key], message });
    }
  });
});

export type DriverForm = z.infer<typeof driverFormSchema>;
