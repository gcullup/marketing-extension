// Orchestrator. This file knows NOTHING about Facebook's DOM — it only
// coordinates storage, logging, and messages to/from content scripts and the
// side panel. See ARCHITECTURE.md: "Governing principle: separate DECIDING
// from DOING."

import { initSettingsIfMissing, getSettings } from '../lib/store.js';
import { log } from '../lib/log.js';
import { matchesAny, matchesAnyExact } from '../lib/fuzzy.js';
import { screenCandidate } from '../lib/claude.js';

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
  if (message?.type === 'SCREEN_CANDIDATE') {
    // The DECIDE half of the pipeline. The content script only scrapes raw
    // text/links (DOING); this is where the tiering logic and the Claude
    // call live, per the DECIDE/DO split (see ARCHITECTURE.md).
    //
    // Tiering, per Greg's design (2026-08-31):
    //   1. Exclude keywords, fuzzy-matched (typo-tolerant) — hard reject,
    //      no AI call. Pure cost-saving; a false exclude just skips someone,
    //      which is a cheaper mistake than a wasted API call.
    //   2. Include keywords, EXACT match only — free instant shortlist, no
    //      AI call.
    //   3. Everything else always goes to the AI with the full text AND the
    //      extracted external links, judged holistically rather than by
    //      literal string match — this is what actually catches cases like
    //      a personal business website or a typo'd occupation.
    (async () => {
      const { text, links = [], targetName } = message;
      try {
        const settings = await getSettings();
        const { includeKeywords, excludeKeywords, targetPersona, claude } = settings;

        if (matchesAny(text, excludeKeywords)) {
          const result = { tier: 'exclude', confidence: 0, reasoning: 'Matched an exclude keyword.', signals: [] };
          await log('info', 'Screened candidate — excluded by keyword', { targetName });
          sendResponse({ ok: true, ...result });
          return;
        }

        if (matchesAnyExact(text, includeKeywords)) {
          const result = {
            tier: 'exact-include',
            confidence: 100,
            reasoning: 'Exact include-keyword match — auto-shortlisted without an AI call.',
            signals: [],
          };
          await log('info', 'Screened candidate — exact include match', { targetName });
          sendResponse({ ok: true, ...result });
          return;
        }

        const aiResult = await screenCandidate({
          apiKey: claude.apiKey,
          model: claude.model,
          targetPersona,
          profileText: text,
          links,
        });
        await log('info', 'Screened candidate — AI call', { targetName, confidence: aiResult.confidence });
        sendResponse({ ok: true, tier: 'ai', ...aiResult });
      } catch (err) {
        await log('error', 'Screening failed', { targetName, error: err.message });
        sendResponse({ ok: false, error: err.message });
      }
    })();
    return true;
  }
  return false;
});
