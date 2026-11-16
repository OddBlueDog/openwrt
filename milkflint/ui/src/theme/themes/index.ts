// Every built-in theme. Adding one: write its file beside these (copy
// plain-milk.ts, or spread it as honey-milk.ts does and change the colours),
// add it here, run the tests (they check every token, every contrast pair and
// the chart colours), and it appears on the Themes page unless it's hidden.
// The first answers for :root, so a page with no theme attribute still has
// every token. Custom themes, made on the Themes page, are a built-in one
// with some colours changed (src/theme/custom.ts).
import type { Theme } from '../contract.ts';
import { honeyMilk } from './honey-milk.ts';
import { minimamilk } from './minimamilk.ts';
import { plainMilk } from './plain-milk.ts';
import { proof } from './proof.ts';

export const themes: readonly Theme[] = [honeyMilk, plainMilk, proof, minimamilk];

/** The theme a new router starts with. */
export const DEFAULT_THEME_ID = honeyMilk.id;
