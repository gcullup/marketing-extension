import { getSettings } from '../lib/store.js';
import { log } from '../lib/log.js';

const statusEl = document.getElementById('status');
const pingBtn = document.getElementById('pingBtn');
const pingResult = document.getElementById('pingResult');

async function init() {
  try {
    const settings = await getSettings();
    statusEl.textContent = `Storage OK. Target persona: "${settings.targetPersona}"`;
    await log('info', 'Side panel opened');
  } catch (err) {
    statusEl.textContent = `Storage error: ${err.message}`;
  }
}

pingBtn.addEventListener('click', async () => {
  pingResult.textContent = 'Pinging content script on the active tab…';
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url?.includes('facebook.com')) {
    pingResult.textContent = 'Active tab is not facebook.com — open a Facebook tab first.';
    return;
  }
  chrome.tabs.sendMessage(tab.id, { type: 'GET_PAGE_INFO' }, (response) => {
    if (chrome.runtime.lastError) {
      pingResult.textContent = `No response: ${chrome.runtime.lastError.message}`;
      return;
    }
    pingResult.textContent = `Content script responded: ${JSON.stringify(response)}`;
  });
});

init();
