// Client for the router's JSON-RPC API (ubus over uhttpd's /ubus endpoint),
// the same API LuCI uses. Calls made in the same tick go out as one batched
// request. Every result is checked against a zod schema, so the rest of the
// app only ever sees data of the shape it expects.
import { z } from 'zod';

/** ubus status codes (libubus `enum ubus_msg_status`). */
export const UbusStatus = {
  ok: 0,
  invalidCommand: 1,
  invalidArgument: 2,
  methodNotFound: 3,
  notFound: 4,
  noData: 5,
  permissionDenied: 6,
  timeout: 7,
  notSupported: 8,
  unknownError: 9,
  connectionFailed: 10,
} as const;

const statusNames = new Map<number, string>(Object.entries(UbusStatus).map(([name, code]) => [code, name]));

export class UbusError extends Error {
  readonly code: number;

  constructor(object: string, method: string, code: number) {
    super(`${object}.${method}: ${statusNames.get(code) ?? `status ${code}`}`);
    this.name = 'UbusError';
    this.code = code;
  }
}

/** The session is unknown or expired: the user has to log in again. */
export class SessionExpiredError extends Error {
  constructor() {
    super('Session expired');
    this.name = 'SessionExpiredError';
  }
}

/** The router couldn't be reached at all (network down, rebooting, wrong address). */
export class UnreachableError extends Error {
  constructor(cause: unknown) {
    super('The router is not responding', { cause });
    this.name = 'UnreachableError';
  }
}

export const NULL_SESSION = '00000000000000000000000000000000';

let sessionId = NULL_SESSION;
const expiredListeners = new Set<() => void>();

export function setSessionId(id: string): void {
  sessionId = id;
}

export function getSessionId(): string {
  return sessionId;
}

/** Called whenever a call comes back "access denied" for a logged-in session. */
export function onSessionExpired(listener: () => void): () => void {
  expiredListeners.add(listener);
  return () => expiredListeners.delete(listener);
}

const rpcResponse = z.object({
  jsonrpc: z.literal('2.0'),
  id: z.number(),
  result: z.tuple([z.number()], z.unknown()).optional(),
  error: z.object({ code: z.number(), message: z.string() }).optional(),
});

interface Pending {
  id: number;
  object: string;
  method: string;
  params: Record<string, unknown>;
  session: string;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
}

let nextId = 1;
let queue: Pending[] = [];

async function flush(): Promise<void> {
  const batch = queue;
  queue = [];

  let body: unknown;
  try {
    const res = await fetch('/ubus', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(
        batch.map((p) => ({
          jsonrpc: '2.0',
          id: p.id,
          method: 'call',
          params: [p.session, p.object, p.method, p.params],
        })),
      ),
    });
    body = await res.json();
  } catch (err) {
    for (const p of batch) p.reject(new UnreachableError(err));
    return;
  }

  const replies = new Map<number, z.infer<typeof rpcResponse>>();
  for (const item of Array.isArray(body) ? body : [body]) {
    const parsed = rpcResponse.safeParse(item);
    if (parsed.success) replies.set(parsed.data.id, parsed.data);
  }

  const denied: Pending[] = [];
  for (const p of batch) {
    const reply = replies.get(p.id);
    if (reply === undefined) {
      p.reject(new UbusError(p.object, p.method, UbusStatus.unknownError));
    } else if (reply.error !== undefined) {
      // -32002: access denied. For a logged-in session that's an expired
      // session, or a call its permissions (ACL) don't allow: checked below.
      if (reply.error.code === -32002 && p.session !== NULL_SESSION) denied.push(p);
      else p.reject(new UbusError(p.object, p.method, UbusStatus.permissionDenied));
    } else if (reply.result === undefined) {
      p.reject(new UbusError(p.object, p.method, UbusStatus.unknownError));
    } else {
      const [code, data] = reply.result;
      if (code === UbusStatus.ok) p.resolve(data ?? null);
      else p.reject(new UbusError(p.object, p.method, code));
    }
  }

  if (denied.length > 0) await settleDenied(denied);
}

/**
 * Calls refused for a logged-in session: if the session still answers
 * session.access (allowed for every live session), they were missing from
 * its permissions and only they fail; otherwise the session expired.
 */
async function settleDenied(denied: readonly Pending[]): Promise<void> {
  let alive: boolean;
  try {
    const res = await fetch('/ubus', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 0, method: 'call', params: [denied[0]?.session, 'session', 'access', {}] }),
    });
    alive = rpcResponse.safeParse(await res.json()).data?.result !== undefined;
  } catch {
    // unreachable: leave it to the next call to find out
    alive = true;
  }
  for (const p of denied) {
    if (alive) {
      console.error(`ubus: ${p.object}.${p.method} isn't in this session's permissions (ACL)`);
      p.reject(new UbusError(p.object, p.method, UbusStatus.permissionDenied));
    } else {
      p.reject(new SessionExpiredError());
    }
  }
  if (!alive) for (const listener of expiredListeners) listener();
}

function enqueue(object: string, method: string, params: Record<string, unknown>, session: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    if (queue.length === 0) queueMicrotask(() => void flush());
    queue.push({ id: nextId++, object, method, params, session, resolve, reject });
  });
}

/** Call `object.method` with `params` and check the result against `schema`. */
export async function call<S extends z.ZodType>(
  object: string,
  method: string,
  params: Record<string, unknown>,
  schema: S,
): Promise<z.output<S>> {
  const data = await enqueue(object, method, params, sessionId);
  return schema.parse(data);
}

/** Like `call`, for methods that return nothing useful. */
export async function exec(object: string, method: string, params: Record<string, unknown> = {}): Promise<void> {
  await enqueue(object, method, params, sessionId);
}

/** A call made without a session (only `session.login` is allowed that way). */
export async function callAnonymous<S extends z.ZodType>(
  object: string,
  method: string,
  params: Record<string, unknown>,
  schema: S,
): Promise<z.output<S>> {
  const data = await enqueue(object, method, params, NULL_SESSION);
  return schema.parse(data);
}

/**
 * Whether the router answers, and whether it still knows `session`: rpcd
 * keeps sessions in RAM, so one it no longer knows means it restarted.
 * 'down' also covers a router that answers but whose API isn't up yet.
 */
export async function routerHealth(session: string, timeoutMs: number): Promise<'up' | 'restarted' | 'down'> {
  try {
    const res = await fetch('/ubus', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 0, method: 'call', params: [session, 'session', 'access', {}] }),
      cache: 'no-store',
      signal: AbortSignal.timeout(timeoutMs),
    });
    const reply = rpcResponse.safeParse(await res.json()).data;
    if (reply?.result !== undefined) return 'up';
    return reply?.error?.code === -32002 ? 'restarted' : 'down';
  } catch {
    return 'down';
  }
}
