// The layout the user saved for Home, kept on the router for every device
// (api.ts); undefined while Home follows the theme's. Read when Home opens.
// A router without the call (an older firmware) has nothing saved. Any other
// failure (a busy router, a dropped connection) isn't "nothing saved": Home
// shows the theme's meanwhile but can't be edited, as a save would replace
// the user's own, and it asks again.
import { useCallback, useEffect, useState } from 'react';
import { UbusError, UbusStatus } from '@/lib/ubus';
import { getHomeLayout, setHomeLayout } from './api';
import type { Layout } from './layout';
import { parseHome, type WidgetId } from './widgets';

/** How long before asking again after a failed read. */
const RETRY_MS = 10_000;

export interface HomeLayout {
  /** False until the router has answered (or failed to). */
  ready: boolean;
  /** False while what the router keeps isn't known: Home can't be edited. */
  editable: boolean;
  saved: Layout<WidgetId> | undefined;
  /** Saves for every device, at once; undefined goes back to the theme's. Throws if the router didn't save it. */
  save: (layout: Layout<WidgetId> | undefined) => Promise<void>;
}

/** The router has no such call: an image from before Home's layout was kept. */
function missing(e: unknown): boolean {
  return e instanceof UbusError && (e.code === UbusStatus.methodNotFound || e.code === UbusStatus.notFound);
}

export function useHomeLayout(): HomeLayout {
  const [state, setState] = useState<{ ready: boolean; editable: boolean; saved: Layout<WidgetId> | undefined }>({
    ready: false,
    editable: false,
    saved: undefined,
  });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    getHomeLayout().then(
      (raw) => {
        if (!cancelled) setState({ ready: true, editable: true, saved: raw === undefined ? undefined : parseHome(raw) });
      },
      (e: unknown) => {
        if (cancelled) return;
        const gone = missing(e);
        setState({ ready: true, editable: gone, saved: undefined });
        if (!gone)
          retry = setTimeout(() => {
            setAttempt((a) => a + 1);
          }, RETRY_MS);
      },
    );
    return () => {
      cancelled = true;
      if (retry !== undefined) clearTimeout(retry);
    };
  }, [attempt]);
  const save = useCallback(async (layout: Layout<WidgetId> | undefined) => {
    await setHomeLayout(layout);
    setState({ ready: true, editable: true, saved: layout });
  }, []);
  return { ...state, save };
}
