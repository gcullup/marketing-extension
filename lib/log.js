// Ring-buffer log. Every meaningful action and every AI call should be
// recorded here so a bad result is auditable after the fact, not guessed at.

const LOG_KEY = 'mkt_log';
const MAX_ENTRIES = 500;

export async function log(level, message, meta = {}) {
  const data = await chrome.storage.local.get(LOG_KEY);
  const entries = data[LOG_KEY] ?? [];
  entries.push({ ts: Date.now(), level, message, meta });
  while (entries.length > MAX_ENTRIES) entries.shift();
  await chrome.storage.local.set({ [LOG_KEY]: entries });
}

export async function getLogs() {
  const data = await chrome.storage.local.get(LOG_KEY);
  return data[LOG_KEY] ?? [];
}

export async function clearLogs() {
  await chrome.storage.local.set({ [LOG_KEY]: [] });
}
