// Storage layer over chrome.storage.local. Versioned schema so future fields
// can be added without breaking existing installs. Real settings fields
// (keywords, quotas, timing, Claude key) get filled in during step 0.11 —
// this is intentionally minimal for the Phase 0 skeleton.

const SETTINGS_KEY = 'mkt_settings';
const SCHEMA_VERSION = 1;

const DEFAULT_SETTINGS = {
  schemaVersion: SCHEMA_VERSION,
  targetPersona:
    'Real estate inspectors and/or appraisers — US-based, owning their own company.',
  includeKeywords: [],
  excludeKeywords: [],
  claude: { apiKey: '', model: '' },
  caps: { maxRequestsPerDay: 10, maxMessagesPerDay: 10 },
  testMode: true,
};

export async function getSettings() {
  const data = await chrome.storage.local.get(SETTINGS_KEY);
  return data[SETTINGS_KEY] ?? DEFAULT_SETTINGS;
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
