/** The protocol this page came in on ('http:' or 'https:'); undefined outside a browser. */
export function pageProtocol(): string | undefined {
  return typeof location === 'undefined' ? undefined : location.protocol;
}

/**
 * The web interface's address on a router at `host`, over the protocol this
 * page came in on: a page opened over HTTPS sends people on over HTTPS (and
 * with "Always use HTTPS" on, an HTTP address would only bounce there).
 */
export function routerUrl(host: string, protocol: string | undefined = pageProtocol()): string {
  return `${protocol === 'https:' ? 'https' : 'http'}://${host}/`;
}
