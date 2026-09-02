// Content Ledger — one record per calendar date, holding that day's
// generated post draft and its review state. Mirrors lib/ledger.js's shape
// (own storage key, plain get/save functions) but for Step 3 content rather
// than people. `postedTo` is scaffolding for the not-yet-built 3A-3D posting
// actions (personal page / business page / story / group) — pre-declared
// now so that work doesn't need to invent the shape later, same reasoning
// as lib/ledger.js's STATES enum pre-declaring DM_QUEUED/DM_SENT early on.

const CONTENT_KEY = 'mkt_content';

export const CONTENT_STATES = Object.freeze({
  DRAFT: 'draft',
  APPROVED: 'approved',
});

export function dateKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

async function readContent() {
  const data = await chrome.storage.local.get(CONTENT_KEY);
  return data[CONTENT_KEY] ?? {};
}

async function writeContent(all) {
  await chrome.storage.local.set({ [CONTENT_KEY]: all });
}

export async function getContentForDate(date = new Date()) {
  const all = await readContent();
  return all[dateKey(date)] ?? null;
}

/** Every content record, newest-first — for the Content Ledger manager page. */
export async function getAllContent() {
  const all = await readContent();
  return Object.values(all).sort((a, b) => b.date.localeCompare(a.date));
}

/**
 * Deletes specific content records by their date key, entirely. Added
 * 2026-09-01, per Greg's request for the same checkbox-based delete
 * interface already built for the Person Ledger. Silently ignores any date
 * key not actually present, so a stale checkbox selection can't throw.
 */
export async function deleteContent(dateKeys) {
  const all = await readContent();
  let count = 0;
  for (const key of dateKeys) {
    if (all[key]) {
      delete all[key];
      count++;
    }
  }
  await writeContent(all);
  return count;
}

/**
 * Overwrites (or creates) the draft for a date — used by both the initial
 * generate and Regenerate. `modifier` is the optional free-text theme Greg
 * can attach (e.g. "Labor Day"); `overrideType` is the optional forced
 * content type (short-form/long-form/engagement) overriding the day's
 * default. Both saved alongside the draft so reopening the page later still
 * shows what actually produced it, and Regenerate defaults to the same
 * choices rather than silently dropping them.
 */
export async function saveDraft({ date = new Date(), dayKey, contentType, text, modifier = '', overrideType = null }) {
  const all = await readContent();
  const key = dateKey(date);
  const existing = all[key];
  all[key] = {
    date: key,
    dayKey,
    contentType,
    text,
    modifier,
    overrideType,
    state: CONTENT_STATES.DRAFT,
    generatedAt: Date.now(),
    approvedAt: null,
    postedTo: existing?.postedTo ?? { personal: null, businessPage: null, story: null, group: null },
  };
  await writeContent(all);
  return all[key];
}

/** Marks a date's content approved, saving whatever text is passed in (Greg may have hand-edited it). */
export async function approveContent(date = new Date(), text) {
  const all = await readContent();
  const key = dateKey(date);
  const record = all[key];
  if (!record) throw new Error(`No content drafted for ${key} yet.`);
  record.text = text ?? record.text;
  record.state = CONTENT_STATES.APPROVED;
  record.approvedAt = Date.now();
  all[key] = record;
  await writeContent(all);
  return record;
}

/**
 * Approved content from the last `days`, per Greg (2026-09-01): feeds Claude
 * a "don't repeat these" list so the same angle/opening/phrasing doesn't get
 * recycled too soon. "Approved" specifically (not just drafted) — the
 * closest proxy this app has for "content that actually represents what got
 * posted," since the real posting actions (3A-3D) aren't built yet. Excludes
 * `excludeDateKey` (today's own date) so a Regenerate on an already-approved
 * day doesn't compare a draft against itself. Oldest-first, so a prompt
 * reading top-to-bottom sees them in chronological order.
 */
export async function getApprovedContentSince(days, excludeDateKey, date = new Date()) {
  const all = await readContent();
  const cutoff = date.getTime() - days * 24 * 60 * 60 * 1000;
  return Object.values(all)
    .filter(
      (r) =>
        r.state === CONTENT_STATES.APPROVED &&
        r.approvedAt &&
        r.approvedAt >= cutoff &&
        r.date !== excludeDateKey
    )
    .sort((a, b) => a.approvedAt - b.approvedAt)
    .map((r) => ({ date: r.date, contentType: r.contentType, text: r.text }));
}
