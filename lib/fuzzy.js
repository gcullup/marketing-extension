// Fuzzy keyword matching. Pure logic, no chrome.* dependency, so it can be
// unit-tested directly under plain Node.
//
// This exists specifically to fix the confirmed root cause of the prior
// build's false negatives: exact substring matching rejected real matches
// over trivial typos ("real estatte investor" vs "real estate investor").
// Matching now tolerates small edit-distance differences instead of
// requiring an exact substring.

export function normalize(str) {
  return String(str)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  let prevRow = Array.from({ length: n + 1 }, (_, j) => j);
  let currRow = new Array(n + 1);

  for (let i = 1; i <= m; i++) {
    currRow[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      currRow[j] = Math.min(
        prevRow[j] + 1, // deletion
        currRow[j - 1] + 1, // insertion
        prevRow[j - 1] + cost // substitution
      );
    }
    [prevRow, currRow] = [currRow, prevRow];
  }
  return prevRow[n];
}

export function similarity(a, b) {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(a, b) / maxLen;
}

/**
 * True if `keyword` fuzzy-matches somewhere inside `text`, tolerating typos
 * and minor phrasing differences. Slides a window the width of the keyword's
 * word count across the text's tokens rather than comparing whole strings,
 * so a multi-word phrase can match anywhere in a longer profile description.
 */
export function fuzzyIncludes(text, keyword, threshold = 0.82) {
  const normText = normalize(text);
  const normKeyword = normalize(keyword);
  if (!normKeyword) return false;
  if (normText.includes(normKeyword)) return true; // fast path

  const textTokens = normText.split(' ');
  const keywordTokens = normKeyword.split(' ');
  const windowSize = keywordTokens.length;

  for (let i = 0; i <= textTokens.length - windowSize; i++) {
    const window = textTokens.slice(i, i + windowSize).join(' ');
    if (similarity(window, normKeyword) >= threshold) return true;
  }
  return false;
}

export function matchesAny(text, keywords, threshold = 0.82) {
  return keywords.some((kw) => fuzzyIncludes(text, kw, threshold));
}
