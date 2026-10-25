// Load once (and again on reload()), for settings pages: unlike usePoll, it
// doesn't refresh on its own, so it never overwrites what the user is editing.
import { useCallback, useEffect, useState } from 'react';

export interface Load<T> {
  data: T | undefined;
  error: unknown;
  loading: boolean;
  reload: () => void;
}

export function useLoad<T>(fetcher: () => Promise<T>): Load<T> {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<unknown>();
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const [load] = useState(() => fetcher);

  useEffect(() => {
    let cancelled = false;
    load().then(
      (result) => {
        if (!cancelled) {
          setData(result);
          setError(undefined);
          setLoading(false);
        }
      },
      (err: unknown) => {
        if (!cancelled) {
          setError(err);
          setLoading(false);
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [load, tick]);

  const reload = useCallback(() => {
    setLoading(true);
    setTick((n) => n + 1);
  }, []);

  return { data, error, loading, reload };
}
