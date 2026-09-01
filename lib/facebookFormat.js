// Facebook's post composer doesn't render real HTML/markdown formatting on
// paste — **bold** markdown just shows up as literal asterisks once pasted.
// The standard workaround used across social media (since this is a
// platform limitation, not something any tool can fix) is Unicode
// "Mathematical Bold" lookalike characters that LOOK bold in any plain-text
// context, including after a normal copy/paste — no clipboard tricks
// needed, since they're just different Unicode codepoints, not markup.
// This converts **bold** markdown into that Unicode bold text and strips
// the markdown markers, so a draft's final text is exactly what should be
// pasted into Facebook. Per Greg's request (2026-09-01).

const BOLD_UPPER_START = 0x1d400; // MATHEMATICAL BOLD CAPITAL A
const BOLD_LOWER_START = 0x1d41a; // MATHEMATICAL BOLD SMALL A
const BOLD_DIGIT_START = 0x1d7ce; // MATHEMATICAL BOLD DIGIT ZERO

function boldChar(ch) {
  const code = ch.charCodeAt(0);
  if (code >= 65 && code <= 90) return String.fromCodePoint(BOLD_UPPER_START + (code - 65));
  if (code >= 97 && code <= 122) return String.fromCodePoint(BOLD_LOWER_START + (code - 97));
  if (code >= 48 && code <= 57) return String.fromCodePoint(BOLD_DIGIT_START + (code - 48));
  return ch; // punctuation/spaces/emoji have no bold Unicode variant -- left as-is
}

function boldify(str) {
  return [...str].map(boldChar).join(''); // spread by code point, not UTF-16 unit, so emoji/surrogate pairs survive intact
}

/** Converts **bold** markdown into real bold-looking Unicode text, stripping the markers. */
export function toFacebookFormatted(text) {
  return text.replace(/\*\*(.+?)\*\*/gs, (_, inner) => boldify(inner));
}

/**
 * Actual character count as a person (or Facebook) would count it — the
 * Unicode bold characters above are outside the Basic Multilingual Plane,
 * so they take 2 UTF-16 units each in a JS string; plain `.length` would
 * overcount them by roughly 2x once a post has much bold text in it.
 */
export function displayLength(text) {
  return [...text].length;
}
