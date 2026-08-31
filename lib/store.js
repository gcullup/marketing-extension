// Storage layer over chrome.storage.local. Versioned schema so future fields
// can be added without breaking existing installs.

const SETTINGS_KEY = 'mkt_settings';
const SCHEMA_VERSION = 1;

// Daily scan/send defaults carried over from the prior build's tuned values
// (visible in its settings screenshots) since they're a real starting point,
// not a guess.
const DEFAULT_SETTINGS = {
  schemaVersion: SCHEMA_VERSION,
  targetPersona:
    'Real estate inspectors and/or appraisers — US-based, owning their own company.',
  includeKeywords: [],
  excludeKeywords: [],
  confidenceThreshold: 90,
  scanLimitsByDay: { sun: 10, mon: 10, tue: 15, wed: 25, thu: 10, fri: 10, sat: 10 },
  caps: { maxRequestsPerDay: 15, maxMessagesPerDay: 15 },
  timing: { minDelaySeconds: 300, maxDelaySeconds: 1800, spreadHours: 8 },
  messageTemplates: {
    intro:
      'Hey {firstName}! I just wanted to reach out and say hello since we recently connected. Looking forward to getting to know you!',
    birthday: 'Happy birthday, {firstName}! Hope you have a wonderful day!',
  },
  claude: { apiKey: '', model: '' },
  testMode: true,
  autoSend: false,
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
