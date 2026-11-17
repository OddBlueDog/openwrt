// One router call at a time for something several parts of a page read at
// once (Home may show a widget twice; its VPN and Remote access widgets read
// the same status): while a call is on its way, asking again gets its answer
// rather than a second call. Each later ask, once it's back, calls afresh.
export function sharedCall<T>(call: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | undefined;
  return () => {
    pending ??= call().finally(() => {
      pending = undefined;
    });
    return pending;
  };
}
