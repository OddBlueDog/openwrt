import { z } from 'zod';
import { call } from '@/lib/ubus';

/** One tracked connection, as the router's conntrack reader owns it (features/connections/bin/conntrack.uc). */
export interface Conn {
  l3: 'ipv4' | 'ipv6';
  l4: string;
  state: string | null;
  /** The device's address, or "router" for the router's own. */
  owner: string;
  remote: string;
  rport: number | null;
  lport: number | null;
  /** Bytes the owner sent and received. */
  out_bytes: number;
  in_bytes: number;
  offloaded: boolean;
  /** Started from outside (a port forward, a VPN handshake). */
  inbound: boolean;
}

export interface Connections {
  /** Lines read (the table is cut at 16,384: then `partial`). */
  total: number;
  /** Connections the kernel tracks now (nf_conntrack_count): the table's real size when `partial`. */
  count: number;
  /** The table's size limit (nf_conntrack_max). */
  max: number;
  offloaded: number;
  partial: boolean;
  /** The router's own CPU time for the call, in ms: the next call waits 100 times this. */
  cost_ms: number;
  family: { ipv4: number; ipv6: number };
  proto: { tcp: number; udp: number; other: number };
  /** One per owner address (and "router"), busiest first, over the whole table; out and in are what it sent and received. */
  devices: { addr: string; n: number; bytes: number; out: number; in: number }[];
  /** After the filters, busiest first, at most the rows asked for. */
  rows: Conn[];
  /** The filtered count minus the rows returned. */
  cut: number;
}

const connSchema = z.object({
  l3: z.enum(['ipv4', 'ipv6']),
  l4: z.string(),
  state: z.string().nullable(),
  owner: z.string(),
  remote: z.string(),
  rport: z.number().nullable(),
  lport: z.number().nullable(),
  out_bytes: z.number(),
  in_bytes: z.number(),
  offloaded: z.boolean(),
  inbound: z.boolean(),
});

export const connectionsSchema: z.ZodType<Connections> = z.object({
  total: z.number(),
  count: z.number(),
  max: z.number(),
  offloaded: z.number(),
  partial: z.boolean(),
  cost_ms: z.number(),
  family: z.object({ ipv4: z.number(), ipv6: z.number() }),
  proto: z.object({ tcp: z.number(), udp: z.number(), other: z.number() }),
  devices: z.array(z.object({ addr: z.string(), n: z.number(), bytes: z.number(), out: z.number(), in: z.number() })),
  rows: z.array(connSchema),
  cut: z.number(),
});

/** One word of the search box, for the router. */
export interface SearchTerm {
  /** Lower case, at most 64 characters. */
  text: string;
  /** Owners whose name or MAC holds the word: their connections match it too (only the page knows the names). */
  owners?: string[];
}

/**
 * The router's connections. The summary describes the whole table; family,
 * addrs ("router" or an address) and search (up to 8 words: a connection is
 * kept when it matches every one) only choose the rows; rows is 0 to 500
 * (default 200, 0 for the summary alone).
 */
export function getConnections(args: {
  family?: 'ipv4' | 'ipv6';
  addrs?: string[];
  rows?: number;
  search?: SearchTerm[];
}): Promise<Connections> {
  return call('milkflint.connections', 'list', args, connectionsSchema);
}
