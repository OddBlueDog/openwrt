// Field hints: the line that shows, and the rest behind "Why?".

/**
 * A hint's first sentence, and the rest. A hint of more than one sentence
 * shows its first on the row and the rest behind "Why?", so a page of
 * settings reads as a list of settings rather than a wall of explanation.
 */
export function splitHint(hint: string): { lead: string; rest: string | undefined } {
  // a sentence ends at . ! or ? followed by a space and a capital, digit or quote;
  // "e.g. 911" and "i.e. this" don't end one
  const end = /(?<!\b(?:e\.g|i\.e|etc|vs|approx))[.!?](?=\s+[A-Z0-9“"'(])/.exec(hint);
  if (end === null) return { lead: hint, rest: undefined };
  const cut = end.index + 1;
  const rest = hint.slice(cut).trim();
  return rest.length < 12 ? { lead: hint, rest: undefined } : { lead: hint.slice(0, cut), rest };
}
