/** The page a device opens to join: this page's own address, so it's how this device reached the router. */
export function joinUrl(token: string): string {
  return `${window.location.origin}${window.location.pathname}#/test-bench/join/${token}`;
}

/** "AZDXBSQC" -> "AZDX-BSQC" */
export function codeText(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}
