// Orchestrator. This file knows NOTHING about Facebook's DOM — it only
// coordinates storage, logging, and messages to/from content scripts and the
// side panel. See ARCHITECTURE.md: "Governing principle: separate DECIDING
// from DOING."

import { initSettingsIfMissing } from '../lib/store.js';
import { log } from '../lib/log.js';

chrome.runtime.onInstalled.addListener(async () => {
  await initSettingsIfMissing();
  await log('info', 'Extension installed/updated — Phase 0 skeleton running.');
});

// Let clicking the toolbar icon open the side panel directly.
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((err) => console.error('[TNG Marketing Extension] sidePanel setup failed:', err));

// Minimal message router. Real screening/queueing logic arrives in Phase 1.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'PING') {
    sendResponse({ type: 'PONG', from: 'background', at: Date.now() });
    return true;
  }
  return false;
});
