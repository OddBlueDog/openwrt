// Finding a page by name, by its group, or by another word for what it does;
// and a part of a page (a tab such as the radar log, a card such as HTTPS) the
// same way, which opens that part.
import { href } from '@/lib/router';
import { keywords } from './keywords';
import { type Section, sections as allSections } from './sections';
import type { Feature, Group } from './types';

export interface PageMatch {
  feature: Feature;
  group: Group | undefined;
  /** The part of the page it opens, for a tab or card; undefined for the page itself. */
  section: Section | undefined;
  /** Where it goes: #/logs, #/logs/radar */
  href: string;
}

/** Lower case, a hyphen inside a word dropped: "Wi-Fi" is found as "wifi" too. */
const flat = (text: string): string => text.toLowerCase().replace(/([a-z0-9])-(?=[a-z0-9])/g, '$1');

/** A text's words, both ways for a hyphenated one: "wi-fi" gives "wi", "fi" and "wifi". */
const words = (text: string): string[] => {
  const lower = text.toLowerCase();
  return [...new Set([...lower.split(/[^a-z0-9.]+/), ...flat(lower).split(/[^a-z0-9.]+/)].filter(Boolean))];
};

/** What a query's words are matched against: a title, then words that count less and less. */
interface Target {
  title: string;
  /** where it sits: a page's group; for a section, its page's title and group (3) */
  near: readonly string[];
  /** other words for it: a page's or a section's keywords (2) */
  other: readonly string[];
  /** a page's description (1) */
  weak: readonly string[];
}

/**
 * How well every term matches: a title that starts with it (8), a word of the title (5),
 * where it sits (3), another word for it (2), its description or anywhere in its title (1);
 * undefined if a term matches nothing. A section also needs a term of its own (in its title
 * or keywords): its page's name alone lists the page, not its every tab.
 */
function scoreOf(terms: readonly string[], target: Target, needOwn: boolean): number | undefined {
  const title = flat(target.title);
  const titleWords = words(target.title);
  const starts = (list: readonly string[], t: string): boolean => list.some((w) => w.startsWith(t));
  let score = 0;
  let own = false;
  for (const t of terms) {
    if (title.startsWith(t)) {
      score += 8;
      own = true;
    } else if (starts(titleWords, t)) {
      score += 5;
      own = true;
    } else if (starts(target.near, t)) score += 3;
    else if (starts(target.other, t)) {
      score += 2;
      own = true;
    } else if (starts(target.weak, t)) score += 1;
    else if (title.includes(t)) {
      score += 1;
      own = true;
    } else return undefined;
  }
  return needOwn && !own ? undefined : score;
}

/**
 * Pages and parts of pages matching every word of the query, best first (scoreOf), then by
 * title. Parts only of the pages given (the menu's, so none of a page access point mode
 * leaves out).
 */
export function searchPages(
  query: string,
  pages: readonly Feature[],
  groupOf: (f: Feature) => Group | undefined,
  limit = 8,
  sections: readonly Section[] = allSections,
): PageMatch[] {
  const terms = words(flat(query));
  if (terms.length === 0) return [];
  const scored: { match: PageMatch; title: string; score: number }[] = [];
  for (const feature of pages) {
    const group = groupOf(feature);
    const groupWords = words(group?.title ?? '');
    const page = scoreOf(
      terms,
      {
        title: feature.title,
        near: groupWords,
        other: words(keywords[feature.id] ?? ''),
        weak: words(feature.description),
      },
      false,
    );
    if (page !== undefined)
      scored.push({ match: { feature, group, section: undefined, href: href(feature.id) }, title: feature.title, score: page });
    for (const section of sections) {
      if (section.page !== feature.id) continue;
      const score = scoreOf(
        terms,
        { title: section.title, near: [...words(feature.title), ...groupWords], other: words(section.keywords), weak: [] },
        true,
      );
      if (score !== undefined)
        scored.push({
          match: { feature, group, section, href: href(feature.id, section.id) },
          title: section.title,
          score,
        });
    }
  }
  return scored
    .sort((a, b) => (b.score !== a.score ? b.score - a.score : a.title.localeCompare(b.title)))
    .slice(0, limit)
    .map((s) => s.match);
}
