// formErrors: a form schema's verdict as the old validate() functions gave
// it, so model tests keep their expected messages.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { z } from 'zod';
import { fieldName, firstError, formErrors } from '../src/lib/form/errors.ts';

const port = z
  .string()
  .regex(/^\d+$/, 'Enter a number.')
  .refine((v) => Number(v) >= 1 && Number(v) <= 65535, 'A port is 1 to 65535.');

test('one message per field: the first rule it fails', () => {
  const schema = z.object({ port, name: z.string().min(1, 'Enter a name.') });
  assert.deepEqual(formErrors(schema, { port: 'x', name: '' }), { port: 'Enter a number.', name: 'Enter a name.' });
  assert.deepEqual(formErrors(schema, { port: '70000', name: 'ok' }), { port: 'A port is 1 to 65535.' });
});

test('a valid value gives none', () => {
  assert.deepEqual(formErrors(z.object({ port }), { port: '443' }), {});
});

test('fields in lists are named as TanStack Form names them', () => {
  const schema = z.object({
    windows: z.array(z.object({ start: z.string().regex(/^\d\d:\d\d$/, 'Use hh:mm.') })),
  });
  assert.deepEqual(formErrors(schema, { windows: [{ start: '08:00' }, { start: '8' }] }), {
    'windows[1].start': 'Use hh:mm.',
  });
  assert.equal(fieldName(['a', 0, 'b', 'c']), 'a[0].b.c');
});

test('a cross-field rule lands on the field its path names', () => {
  const schema = z.object({ start: z.string(), end: z.string() }).superRefine((f, ctx) => {
    if (f.end < f.start) ctx.addIssue({ code: 'custom', path: ['end'], message: 'Ends before it starts.' });
  });
  assert.deepEqual(formErrors(schema, { start: '10', end: '09' }), { end: 'Ends before it starts.' });
});

test('firstError reads schema issues and plain strings, and ignores the rest', () => {
  assert.equal(firstError([{ message: 'Enter a number.', path: ['port'] }, 'later']), 'Enter a number.');
  assert.equal(firstError(['Plain.']), 'Plain.');
  assert.equal(firstError([undefined, 3]), undefined);
  assert.equal(firstError([]), undefined);
});
