// A list of your own, as the feed sheet edits it, and banIP's checks of it
// (luci-app-banip's custom feed editor's): tests/banip-model.test.ts.
import type { FeedDefinition } from './api';

const URL = /^https?:\/\/[A-Za-z0-9[\]{}/.?&+_@%=:~#-]+$/;

export interface FeedForm {
  name: string;
  descr: string;
  url_4: string;
  url_6: string;
  rule: string;
  chain: 'in' | 'out' | 'inout';
  flag: string;
}

/** What's wrong with the form, field by field (banIP's own checks: name, description, addresses, rule, flag). */
export function checkFeedForm(f: FeedForm, taken: readonly string[], editing: boolean): Partial<Record<keyof FeedForm, string>> {
  const e: Partial<Record<keyof FeedForm, string>> = {};
  if (!/^[a-z0-9]{3,15}$/.test(f.name)) e.name = '3 to 15 small letters or digits.';
  else if (!editing && taken.includes(f.name)) e.name = 'There’s a list of that name already.';
  else if (f.name === 'allowlist' || f.name === 'blocklist') e.name = 'That one is banIP’s own.';
  if (f.descr.trim().length < 3 || f.descr.length > 40 || /["\\]/.test(f.descr)) e.descr = '3 to 40 characters, without " or \\.';
  if (f.url_4 === '' && f.url_6 === '') e.url_4 = 'At least one address, for IPv4 or IPv6.';
  if (f.url_4 !== '' && !URL.test(f.url_4)) e.url_4 = 'A web address (http or https), without spaces.';
  if (f.url_6 !== '' && !URL.test(f.url_6)) e.url_6 = 'A web address (http or https), without spaces.';
  if (!/^(feed|suricata)( [^ "\\]{1,40}| "){1,3}$/.test(f.rule)) e.rule = 'A rule as banIP takes it, e.g. “feed 1”.';
  if (f.flag !== '' && !/^(gz|tcp|udp|\d{1,5}(-\d{1,5})?)( (gz|tcp|udp|\d{1,5}(-\d{1,5})?))*$/.test(f.flag)) e.flag = 'gz, tcp, udp and ports, e.g. “tcp udp 80 443”.';
  return e;
}

export function definitionOf(f: FeedForm): FeedDefinition {
  return {
    ...(f.url_4 === '' ? {} : { url_4: f.url_4 }),
    ...(f.url_6 === '' ? {} : { url_6: f.url_6 }),
    rule: f.rule,
    chain: f.chain,
    descr: f.descr.trim(),
    ...(f.flag === '' ? {} : { flag: f.flag }),
  };
}

