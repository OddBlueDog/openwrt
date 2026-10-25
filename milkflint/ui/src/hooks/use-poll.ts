// Fetch now and then every `intervalMs`, pausing while the tab is hidden.
// Keeps showing the last good data when a refresh fails. When `key` changes
// (what the fetcher asks for), it fetches straight away, and data fetched
// for another key is never returned.
import { useCallback, useEffect, useRef, useState } from 'react';

export interface Poll<T> {
  data: T | undefined;
  error: unknown;
  loading: boolean;
  refresh: () => void;
}

export function usePoll<T>(fetcher: () => Promise<T>, intervalMs: number, key = ''): Poll<T> {
  const [result, setResult] = useState<{ key: string; data: T }>();
  const [error, setError] = useState<unknown>();
  const [loading, setLoading] = useState(true);
  const fetcherRef = useRef(fetcher);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    fetcherRef.current = fetcher;
  });

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;

    const run = async (): Promise<void> => {
      try {
        const data = await fetcherRef.current();
        if (!cancelled) {
          setResult({ key, data });
          setError(undefined);
        }
      } catch (err) {
        if (!cancelled) setError(err);
      } finally {
        if (!cancelled) {
          setLoading(false);
          if (!document.hidden) timer = window.setTimeout(() => void run(), intervalMs);
        }
      }
    };

    const onVisibility = (): void => {
      if (!document.hidden && timer === undefined) void run();
      if (document.hidden && timer !== undefined) {
        window.clearTimeout(timer);
        timer = undefined;
      }
    };

    void run();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [intervalMs, tick, key]);

  const refresh = useCallback(() => {
    setTick((n) => n + 1);
  }, []);

  const current = result?.key === key ? result.data : undefined;
  return { data: current, error, loading: loading || (current === undefined && error === undefined), refresh };
}
