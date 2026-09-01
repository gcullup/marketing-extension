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
 *
 * Confirmed live bug (2026-08-31): anyone without a custom Facebook username
 * uses the URL shape `facebook.com/profile.php?id=NNNN` — the path is just
 * `/profile.php` for every such person, so using the path segment alone
 * collapsed every numeric-ID profile onto the identical id `"profile.php"`.
 * In a real batch run, three genuinely different people (Andrew Lee, Angel
 * Ramos, Zac Smith) were silently treated as duplicates of whoever hit that
 * bogus shared id first and never actually got screened — the same
 * false-negative failure category as the original fuzzy-matching bug, just
 * surfacing somewhere new. Fixed by reading the real identity out of the
 * `id` query parameter for this specific URL shape.
 */
export function extractProfileId(href) {
  try {
    const u = new URL(href);
    const segments = u.pathname.split('/').filter(Boolean);
    if (segments.length !== 1) return null;
    const segment = segments[0].toLowerCase();
    if (segment === 'profile.php') {
      const numericId = u.searchParams.get('id');
      return numericId ? `profile.php?id=${numericId}` : null;
    }
    return segment;
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

/**
 * Records whether a suggestions-list removal actually succeeded — persisted
 * so future cache hits know whether a retry is still needed. Confirmed live
 * (2026-09-01): removal was previously a one-shot attempt tied to the exact
 * moment of a FRESH reject, with nothing recorded about the outcome —
 * anyone whose attempt failed (or who was rejected before the Remove
 * feature existed at all) sat visible in the list forever, since every
 * later cache-hit silently skipped past the removal logic entirely. Only
 * ever sets the flag to true; a failed attempt leaves it as whatever it
 * already was, so retries keep happening until one actually succeeds.
 */
export async function markRemovalAttempt(id, removed) {
  if (removed !== true) return null;
  const ledger = await readLedger();
  const record = ledger[id];
  if (!record) return null;
  record.removedFromSuggestions = true;
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

/**
 * Deletes every record currently in `state` from the ledger entirely — not
 * just changing their state. Used by the Review/Send Queue "Reset Queue"
 * controls (per Greg, 2026-08-31): deleting rather than bulk-rejecting means
 * anyone who reappears in a future scan gets freshly re-screened instead of
 * being permanently blocked by today's test-run artifacts. Irreversible
 * without a prior export (Settings → Export All Data) — callers must
 * confirm with the user before calling this.
 */
export async function clearByState(state) {
  const ledger = await readLedger();
  let count = 0;
  for (const id of Object.keys(ledger)) {
    if (ledger[id].state === state) {
      delete ledger[id];
      count++;
    }
  }
  await writeLedger(ledger);
  return count;
}

/**
 * Records an actual friend request send (assisted click — Greg's design
 * decision was assisted, not autonomous: the extension screens/scores/
 * queues, Greg clicks to send). Moves someone from `queued` to `requested`.
 */
export async function markRequested(id) {
  const ledger = await readLedger();
  const record = ledger[id];
  if (!record) throw new Error(`No ledger record for ${id}`);
  record.state = STATES.REQUESTED;
  record.requestedAt = Date.now();
  appendHistory(record, 'friend request sent (assisted click)');
  ledger[id] = record;
  await writeLedger(ledger);
  return record;
}

function isSameLocalDay(timestampMs, reference) {
  const a = new Date(timestampMs);
  return (
    a.getFullYear() === reference.getFullYear() &&
    a.getMonth() === reference.getMonth() &&
    a.getDate() === reference.getDate()
  );
}

/**
 * How many friend requests have actually been sent today (local time) —
 * derived from `requestedAt` timestamps rather than a separate counter, so
 * the ledger stays the single source of truth. Counts by when the request
 * was sent, not current state, so someone who's since progressed to
 * `accepted` still correctly counts toward today's send total.
 */
export async function countRequestedToday(now = new Date()) {
  const people = await getAllPeople();
  return people.filter((p) => p.requestedAt && isSameLocalDay(p.requestedAt, now)).length;
}
