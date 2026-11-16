// Finding a page by name, by its group, or by another word for what it does.
import { keywords } from './keywords';
import type { Feature, Group } from './types';

export interface PageMatch {
  feature: Feature;
  group: Group | undefined;
}

const words = (text: string): string[] =>
  text
    .toLowerCase()
    .split(/[^a-z0-9.]+/)
    .filter(Boolean);

/**
 * Pages matching every word of the query, best first: a title that starts
 * with it, then a word of the title, then the group, keywords and description.
 */
export function searchPages(
  query: string,
  pages: readonly Feature[],
  groupOf: (f: Feature) => Group | undefined,
  limit = 8,
): PageMatch[] {
  const terms = words(query);
  if (terms.length === 0) return [];
  const scored: { match: PageMatch; score: number }[] = [];
  for (const feature of pages) {
    const group = groupOf(feature);
    const title = feature.title.toLowerCase();
    const titleWords = words(feature.title);
    const rest = [...words(group?.title ?? ''), ...words(keywords[feature.id] ?? ''), ...words(feature.description)];
    let score = 0;
    let all = true;
    for (const t of terms) {
      if (title.startsWith(t)) score += 8;
      else if (titleWords.some((w) => w.startsWith(t))) score += 5;
      else if (rest.some((w) => w.startsWith(t))) score += 2;
      else if (title.includes(t)) score += 1;
      else {
        all = false;
        break;
      }
    }
    if (all) scored.push({ match: { feature, group }, score });
  }
  return scored
    .sort((a, b) => (b.score !== a.score ? b.score - a.score : a.match.feature.title.localeCompare(b.match.feature.title)))
    .slice(0, limit)
    .map((s) => s.match);
}
