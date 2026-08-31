// Person Ledger — one record per human, ever. Every Step 1/2/9 feature is a
// query over this one table (see ARCHITECTURE.md: "Central data model").
// Stored under its own chrome.storage.local key, so it rides along with
// Settings' existing export/import backup mechanism without being coupled
// to it.

const LEDGER_KEY = 'mkt_ledger';

// Every state a person can be in. Only discovered → rejected/needs_review/
// queued are reachable so far — the rest are named up front as placeholders
// for the send flow (task 1.9+) and Step 9, so future code doesn't need to
// invent new state names ad hoc mid-implementation.
export const STATES = Object.freeze({
  DISCOVERED: 'discovered',
  REJECTED: 'rejected',
  NEEDS_REVIEW: 'needs_review',
  QUEUED: 'queued',
  REQUESTED: 'requested',
  PENDING: 'pending',
  ACCEPTED: 'accepted',
  CANCELLED: 'cancelled',
  EXPIRED: 'expired',
  DM_QUEUED: 'dm_queued',
  DM_SENT: 'dm_sent',
  REPLIED: 'replied',
});

/**
 * Extracts a stable identity from a profile URL — the username slug, never
 * the display name (names collide, get typo'd, and duplicate across
 * people). Lowercased so differently-cased references to the same profile
 * don't fork into two ledger entries. Returns null if `href` isn't a
 * recognizable single-segment profile URL.
 */
export function extractProfileId(href) {
  try {
    const u = new URL(href);
    const segments = u.pathname.split('/').filter(Boolean);
    if (segments.length !== 1) return null;
    return segments[0].toLowerCase();
  } catch {
    return null;
  }
}

function deriveStateFromVerdict(verdict) {
  if (verdict === 'reject') return STATES.REJECTED;
  if (verdict === 'auto-add') return STATES.QUEUED;
  return STATES.NEEDS_REVIEW;
}

async function readLedger() {
  const data = await chrome.storage.local.get(LEDGER_KEY);
  return data[LEDGER_KEY] ?? {};
}

async function writeLedger(ledger) {
  await chrome.storage.local.set({ [LEDGER_KEY]: ledger });
}

export async function getPerson(id) {
  const ledger = await readLedger();
  return ledger[id] ?? null;
}

export async function getAllPeople() {
  const ledger = await readLedger();
  return Object.values(ledger);
}

export async function listByState(state) {
  const people = await getAllPeople();
  return people.filter((p) => p.state === state);
}

function appendHistory(record, note) {
  record.history = record.history ?? [];
  record.history.push({ at: Date.now(), state: record.state, note });
  return record;
}

/**
 * The main entry point: records a screening result for a candidate,
 * deriving the ledger state from the verdict, and persists it. Creates the
 * record on first contact, or updates the existing one on a re-screen
 * (e.g. after a settings change) without dropping prior history.
 */
export async function recordScreening(candidate, screening) {
  const { id, name, profileUrl } = candidate;
  if (!id) throw new Error('recordScreening requires a stable id (see extractProfileId).');

  const ledger = await readLedger();
  const record = ledger[id] ?? {
    id,
    name,
    profileUrl,
    state: STATES.DISCOVERED,
    discoveredAt: Date.now(),
    history: [],
  };

  record.name = name ?? record.name;
  record.profileUrl = profileUrl ?? record.profileUrl;
  record.screening = { ...screening, screenedAt: Date.now() };
  record.state = deriveStateFromVerdict(screening.verdict);
  appendHistory(record, `screened — tier=${screening.tier} verdict=${screening.verdict}`);

  ledger[id] = record;
  await writeLedger(ledger);
  return record;
}

/** Human review-queue action: approve someone out of needs_review into queued. */
export async function approvePerson(id) {
  const ledger = await readLedger();
  const record = ledger[id];
  if (!record) throw new Error(`No ledger record for ${id}`);
  record.state = STATES.QUEUED;
  appendHistory(record, 'approved by human review');
  ledger[id] = record;
  await writeLedger(ledger);
  return record;
}

/** Human review-queue action: skip someone out of needs_review into rejected. */
export async function skipPerson(id) {
  const ledger = await readLedger();
  const record = ledger[id];
  if (!record) throw new Error(`No ledger record for ${id}`);
  record.state = STATES.REJECTED;
  appendHistory(record, 'skipped by human review');
  ledger[id] = record;
  await writeLedger(ledger);
  return record;
}
