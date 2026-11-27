// Field schemas more than one form uses. Each takes its message from the
// caller, since pages word the same rule their own way; a rule only one
// form has stays in that feature's model.ts.
import { z } from 'zod';
import { ipToInt } from '@/lib/api/network';

/** A dotted IPv4 address (as ipToInt reads it). */
export function ipv4(message: string): z.ZodString {
  return z.string().refine((v) => ipToInt(v) !== undefined, message);
}

/** An IPv4 address (as a number) in 10/8, 172.16/12 or 192.168/16. */
export function isPrivateIpv4(ip: number): boolean {
  const a = Math.floor(ip / 2 ** 24);
  const b = Math.floor(ip / 2 ** 16) % 256;
  return a === 10 || (a === 172 && b >= 16 && b < 32) || (a === 192 && b === 168);
}

/** A MAC address written with colons: aa:bb:cc:dd:ee:ff, either case. */
export function isMac(v: string): boolean {
  return /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i.test(v);
}

export function mac(message: string): z.ZodString {
  return z.string().refine(isMac, message);
}

/** A port (1–65535) or a range of them, 8000-8010 (or fw4's 8000:8010). */
export function isPortOrRange(v: string): boolean {
  const m = /^(\d{1,5})(?:[-:](\d{1,5}))?$/.exec(v);
  if (m === null) return false;
  const a = Number(m[1]);
  const b = m[2] === undefined ? a : Number(m[2]);
  return a >= 1 && b <= 65535 && b >= a;
}

export function portOrRange(message: string): z.ZodString {
  return z.string().refine(isPortOrRange, message);
}
