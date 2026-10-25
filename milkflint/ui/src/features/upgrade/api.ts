import { z } from 'zod';
import { call, exec, getSessionId } from '@/lib/ubus';

export const IMAGE_PATH = '/tmp/firmware.bin';

/** Upload the image to the router's RAM through cgi-io (as LuCI does), reporting progress 0..1. */
export function uploadImage(file: File, onProgress: (fraction: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append('sessionid', getSessionId());
    form.append('filename', IMAGE_PATH);
    form.append('filemode', '0600');
    form.append('filedata', file);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/cgi-bin/cgi-upload');
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`Upload failed (${String(xhr.status)}).`));
    };
    xhr.onerror = () => {
      reject(new Error('Upload failed: the router stopped responding.'));
    };
    xhr.send(form);
  });
}

const validationSchema = z
  .object({
    valid: z.boolean(),
    forceable: z.boolean().optional(),
    allow_backup: z.boolean().optional(),
    tests: z.record(z.string(), z.boolean()).optional(),
  })
  .loose();
export type Validation = z.output<typeof validationSchema>;

export function validateImage(): Promise<Validation> {
  return call('system', 'validate_firmware_image', { path: IMAGE_PATH }, validationSchema);
}

const checkSchema = z.object({
  present: z.boolean(),
  size: z.number().optional(),
  sha256: z.string().optional(),
  test_ok: z.boolean().optional(),
  test_output: z.string().optional(),
});
export type Check = z.output<typeof checkSchema>;

export function checkImage(): Promise<Check> {
  return call('milkflint.upgrade', 'check', {}, checkSchema);
}

export function startUpgrade(keep: boolean, force: boolean): Promise<void> {
  return exec('milkflint.upgrade', 'start', { keep, force });
}

export function discardImage(): Promise<void> {
  return exec('milkflint.upgrade', 'discard');
}
