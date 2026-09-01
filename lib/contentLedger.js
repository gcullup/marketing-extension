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

function dateKey(date = new Date()) {
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

/** Overwrites (or creates) the draft for a date — used by both the initial generate and Regenerate. */
export async function saveDraft({ date = new Date(), dayKey, contentType, text }) {
  const all = await readContent();
  const key = dateKey(date);
  const existing = all[key];
  all[key] = {
    date: key,
    dayKey,
    contentType,
    text,
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
