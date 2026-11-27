// A settings or static query with the shape useLive gives (and useLoad
// gave): the data, the last error (undefined when there's none), whether
// there's nothing to show yet, and a way to read again.
import { useQuery } from '@tanstack/react-query';
import { useCallback } from 'react';
import type { RouterQuery } from './options';

export interface Read<T> {
  data: T | undefined;
  error: unknown;
  loading: boolean;
  refresh: () => void;
}

export function useRead<T>(options: RouterQuery<T>): Read<T> {
  const query = useQuery(options);
  const { refetch } = query;
  const refresh = useCallback(() => {
    void refetch();
  }, [refetch]);
  return {
    data: query.data,
    error: query.error ?? undefined,
    loading: query.data === undefined && query.error === null,
    refresh,
  };
}
