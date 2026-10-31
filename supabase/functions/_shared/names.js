// Decides whether a leaderboard name is allowed. Runs on the server, so it can't be skipped.
// tests/names.test.mjs holds the names this must catch: add to it whenever you add a word here.
import { RegExpMatcher, englishDataset, englishRecommendedTransformers } from 'obscenity';

const built = englishDataset.build();
const matcher = new RegExpMatcher({
  ...built,
  ...englishRecommendedTransformers,
  // Real names the library wrongly flags.
  whitelistedTerms: [...built.whitelistedTerms, 'analise'],
});

// Slurs and hate terms the library misses. Banned anywhere in a name, even inside another word.
const BANNED_ANYWHERE = [
  'phuck', 'fuk', 'nigg', 'niqq', 'wetback', 'hitler', 'nazi', 'kkk', 'whitepower', 'whitepride', 'siegheil',
  '1488', 'killyourself', 'pedophile', 'paedo', 'kyke', 'beaner', 'towelhead', 'raghead', 'jigaboo',
  'porchmonkey', 'zipperhead',
];

// Banned only as a whole word, because they're inside innocent ones (Spicy, Raccoon, Torpedo).
const BANNED_WORDS = new Set(['spic', 'coon', 'gook', 'heil', 'pedo', 'kys', 'nig', 'jap', 'wop', 'dago', 'chink']);

const LOOKALIKES = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', 8: 'b', 9: 'g' };
const undisguise = (text) => text.replace(/[013457-9]/g, (d) => LOOKALIKES[d]);

// Strips accents and extra spaces, then allows only plain letters, numbers and spaces. Limiting the
// characters stops lookalike letters from other alphabets slipping a word past the filter.
export function cleanName(raw) {
  if (typeof raw !== 'string') return null;
  const name = raw.normalize('NFKD').replace(/\p{M}/gu, '').trim().replace(/\s+/g, ' ');
  return /^[A-Za-z0-9 ]{2,12}$/.test(name) ? name : null;
}

export function isOffensive(name) {
  const lower = name.toLowerCase();
  const joined = lower.replace(/ /g, '');         // catches "f u c k"
  const plain = undisguise(joined);               // catches "h1tl3r"
  if (matcher.hasMatch(lower) || matcher.hasMatch(joined)) return true;
  if (BANNED_ANYWHERE.some((term) => joined.includes(term) || plain.includes(term))) return true;
  const words = lower.split(' ').flatMap((w) => [w, undisguise(w)]);
  return BANNED_WORDS.has(plain) || words.some((w) => BANNED_WORDS.has(w));
}
