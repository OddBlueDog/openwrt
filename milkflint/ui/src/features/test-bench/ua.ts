// What kind of device and browser a member is, from its user agent string:
// enough for a card ("Safari on iPhone") and a first name ("iPhone"), not a
// fingerprint.

export type DeviceKind = 'phone' | 'tablet' | 'computer';

export interface Agent {
  browser: string | undefined;
  /** the browser's major version */
  version: string | undefined;
  os: string | undefined;
  device: DeviceKind;
  /** what to call the device when nothing better is known */
  label: string;
}

const browsers: readonly [RegExp, string][] = [
  [/\bEdg(?:e|A|iOS)?\/(\d+)/, 'Edge'],
  [/\bSamsungBrowser\/(\d+)/, 'Samsung Internet'],
  [/\bOPR\/(\d+)/, 'Opera'],
  [/\bFirefox\/(\d+)/, 'Firefox'],
  [/\bFxiOS\/(\d+)/, 'Firefox'],
  [/\bCriOS\/(\d+)/, 'Chrome'],
  [/\bChrome\/(\d+)/, 'Chrome'],
  [/\bVersion\/(\d+)[.\d]* (?:Mobile\/\S+ )?Safari\//, 'Safari'],
  [/\bcurl\/(\d+)/, 'curl'],
];

/**
 * `touch`: the page's navigator.maxTouchPoints > 1. An iPad asks for
 * desktop sites by default, so its Safari says "Macintosh"; only touch
 * tells them apart.
 */
export function parseAgent(ua: string | null | undefined, touch = false): Agent {
  const s = ua ?? '';
  let browser: string | undefined;
  let version: string | undefined;
  for (const [re, name] of browsers) {
    const m = re.exec(s);
    if (m !== null) {
      browser = name;
      version = m[1];
      break;
    }
  }
  let os: string | undefined;
  let device: DeviceKind = 'computer';
  let label = 'Computer';
  if (/\biPhone\b/.test(s)) {
    os = 'iOS';
    device = 'phone';
    label = 'iPhone';
  } else if (/\biPad\b/.test(s) || (/\bMacintosh\b/.test(s) && touch)) {
    os = 'iPadOS';
    device = 'tablet';
    label = 'iPad';
  } else if (/\bAndroid\b/.test(s)) {
    os = 'Android';
    device = /\bMobile\b/.test(s) ? 'phone' : 'tablet';
    label = device === 'phone' ? 'Android phone' : 'Android tablet';
  } else if (/\bMacintosh\b/.test(s)) {
    os = 'macOS';
    label = 'Mac';
  } else if (/\bWindows\b/.test(s)) {
    os = 'Windows';
    label = 'Windows PC';
  } else if (/\bCrOS\b/.test(s)) {
    os = 'ChromeOS';
    label = 'Chromebook';
  } else if (/\bLinux\b/.test(s)) {
    os = 'Linux';
    label = 'Linux PC';
  }
  return { browser, version, os, device, label };
}

/** "Safari 26 on macOS", or what's known of it. */
export function agentText(a: Agent): string {
  const b = a.browser === undefined ? undefined : a.version === undefined ? a.browser : `${a.browser} ${a.version}`;
  if (b !== undefined && a.os !== undefined) return `${b} on ${a.os}`;
  return b ?? a.os ?? 'Unknown browser';
}
