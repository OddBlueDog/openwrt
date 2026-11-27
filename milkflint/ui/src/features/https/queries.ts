// What the HTTPS part of Router access reads and writes (see ARCHITECTURE.md).
import { useMutation, type UseMutationResult } from '@tanstack/react-query';
import { type RouterQuery, settingsQuery } from '@/lib/query/options';
import { type Loaded, loadHttps, renewCertificate } from './api';

export const httpsQueries = {
  /** uhttpd's settings and what the running web server does */
  settings: (): RouterQuery<Loaded> => settingsQuery(['https', 'settings'], loadHttps),
};

/** Make a new certificate; uhttpd restarts a second after the router answers (the caller reads again after that). */
export function useRenewCertificate(): UseMutationResult<void, Error, void> {
  return useMutation({ mutationFn: renewCertificate });
}
