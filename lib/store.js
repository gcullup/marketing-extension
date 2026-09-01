// Storage layer over chrome.storage.local. Versioned schema so future fields
// can be added without breaking existing installs.

const SETTINGS_KEY = 'mkt_settings';
const SCHEMA_VERSION = 1;

// Daily scan/send defaults carried over from the prior build's tuned values
// (visible in its settings screenshots) since they're a real starting point,
// not a guess.
//
// scanLimitsByDay clarified 2026-08-31, per Greg: this caps TOTAL profiles
// evaluated per day, regardless of verdict — a separate, deliberately much
// larger number than send-side limits (below), since most scanned profiles
// won't become friend requests (some rejected, some queued for human
// review). This is a NEW-INSTALL default only — never overwrites an
// already-configured value (see deepMergeDefaults below).
const DEFAULT_SETTINGS = {
  schemaVersion: SCHEMA_VERSION,
  targetPersona:
    'Real estate inspectors and/or appraisers — US-based, owning their own company.',
  includeKeywords: [],
  excludeKeywords: [],
  confidenceThreshold: 90, // auto-approve at/above this
  rejectFloor: 25, // auto-deny at/below this; strictly between the two goes to human review
  scanLimitsByDay: { sun: 80, mon: 80, tue: 80, wed: 80, thu: 80, fri: 80, sat: 80 },
  // maxRequestsPerDayByDay made variable per day of week (2026-08-31, per
  // Greg), matching scanLimitsByDay's pattern — was a single flat number.
  caps: {
    maxRequestsPerDayByDay: { sun: 15, mon: 15, tue: 15, wed: 15, thu: 15, fri: 15, sat: 15 },
    maxMessagesPerDay: 15,
  },
  // minDelaySeconds/maxDelaySeconds redefined 2026-09-01, per Greg: pause
  // between finishing one candidate and starting the next within a
  // Discovery Batch run. Was previously completely inert (confirmed by
  // grep — nothing read it), inherited from the old tool's screenshot
  // without knowing its real granularity there. spreadHours remains
  // deliberately unused — it only makes sense for unattended autoSend,
  // which isn't built.
  timing: { minDelaySeconds: 3, maxDelaySeconds: 15, spreadHours: 8 },
  // Added 2026-09-01, per Greg: an outstanding friend request that's never
  // accepted after this many days gets cancelled during the acceptance
  // check, rather than sitting forever. Maps to the original Step 2 spec
  // ("cancel outstanding requests"), just time-based here rather than the
  // volume-based (200/150) trigger described there originally.
  staleRequestDays: 14,
  messageTemplates: {
    intro:
      'Hey {firstName}! I just wanted to reach out and say hello since we recently connected. Looking forward to getting to know you!',
    birthday: 'Happy birthday, {firstName}! Hope you have a wonderful day!',
  },
  claude: { apiKey: '', model: '' },
  testMode: true,
  autoSend: false,
};

// Recursively backfills any field missing from `stored` using `defaults`,
// without touching fields the user (or an earlier version) already set —
// even if that existing value happens to equal an old default. Only true
// gaps get filled in. This is what makes it safe to add new settings fields
// later without breaking or silently resetting an existing install.
function deepMergeDefaults(stored, defaults) {
  const result = { ...defaults, ...stored };
  for (const key of Object.keys(defaults)) {
    const defVal = defaults[key];
    const storedVal = stored?.[key];
    const bothPlainObjects =
      defVal &&
      typeof defVal === 'object' &&
      !Array.isArray(defVal) &&
      storedVal &&
      typeof storedVal === 'object' &&
      !Array.isArray(storedVal);
    if (bothPlainObjects) {
      result[key] = { ...defVal, ...storedVal };
    }
  }
  return result;
}

// One-time shape migration, run before the generic backfill below: an
// already-configured flat maxRequestsPerDay (the old shape) is spread across
// all seven days rather than being silently discarded when the new
// per-day-of-week shape is introduced — deepMergeDefaults only backfills
// truly missing keys, it doesn't know how to rename/reshape an existing one.
// Verified live (2026-08-31) against a real old-shape value, an
// already-migrated value (must be left alone), and a fresh empty install.
function migrateSettings(stored) {
  if (stored?.caps && typeof stored.caps.maxRequestsPerDay === 'number' && !stored.caps.maxRequestsPerDayByDay) {
    const v = stored.caps.maxRequestsPerDay;
    stored.caps.maxRequestsPerDayByDay = { sun: v, mon: v, tue: v, wed: v, thu: v, fri: v, sat: v };
    delete stored.caps.maxRequestsPerDay;
  }

  // One-time reset of timing.minDelaySeconds/maxDelaySeconds (2026-09-01):
  // these fields had zero effect on anything until today (confirmed by
  // grep before making this change), so no stored value represents an
  // informed choice under their NEW meaning. The old inherited 250-1800s
  // range would make a Discovery Batch take hours if reused literally at
  // this granularity, so reset once to a sensible default. Guarded by a
  // flag — verified live that a second migration pass never re-clobbers a
  // later deliberate edit — so this only ever fires once per install.
  if (stored && !stored.timingPacingMigratedV1) {
    stored.timing = stored.timing ?? {};
    stored.timing.minDelaySeconds = 3;
    stored.timing.maxDelaySeconds = 15;
    stored.timingPacingMigratedV1 = true;
  }

  return stored;
}

export async function getSettings() {
  const data = await chrome.storage.local.get(SETTINGS_KEY);
  const stored = migrateSettings(data[SETTINGS_KEY]);
  if (!stored) return DEFAULT_SETTINGS;

  const healed = deepMergeDefaults(stored, DEFAULT_SETTINGS);
  if (JSON.stringify(healed) !== JSON.stringify(stored)) {
    await chrome.storage.local.set({ [SETTINGS_KEY]: healed });
  }
  return healed;
}

export function getDefaultSettings() {
  return JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
}

export async function saveSettings(partial) {
  const current = await getSettings();
  const next = { ...current, ...partial };
  await chrome.storage.local.set({ [SETTINGS_KEY]: next });
  return next;
}

export async function initSettingsIfMissing() {
  const data = await chrome.storage.local.get(SETTINGS_KEY);
  if (!data[SETTINGS_KEY]) {
    await chrome.storage.local.set({ [SETTINGS_KEY]: DEFAULT_SETTINGS });
  }
}

export async function exportAll() {
  return chrome.storage.local.get(null);
}

export async function importAll(dump) {
  await chrome.storage.local.clear();
  await chrome.storage.local.set(dump);
}
