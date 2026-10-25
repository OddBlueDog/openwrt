import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/** The message of an unknown thrown value, for showing to the user. */
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
