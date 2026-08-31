// Orchestrator. This file knows NOTHING about Facebook's DOM — it only
// coordinates storage, logging, and messages to/from content scripts and the
// side panel. See ARCHITECTURE.md: "Governing principle: separate DECIDING
// from DOING."

import { initSettingsIfMissing, getSettings } from '../lib/store.js';
import { log } from '../lib/log.js';
import { matchesAny, matchesAnyExact } from '../lib/fuzzy.js';
import { screenCandidate } from '../lib/claude.js';
import { computeVerdict } from '../lib/verdict.js';
import { extractProfileId, getPerson, recordScreening } from '../lib/ledger.js';

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
      const { text, links = [], targetName, profileUrl } = message;
      const id = profileUrl ? extractProfileId(profileUrl) : null;

      // Record the result to the Person Ledger and respond — the one path
      // every branch below funnels through, so dedupe/history/state is
      // handled identically regardless of which tier decided the verdict.
      async function finalize(result) {
        await log('info', `Screened candidate — ${result.tier}`, {
          targetName,
          verdict: result.verdict,
          confidence: result.confidence,
        });
        if (!id) {
          sendResponse({ ok: true, ledgerState: null, ledgerNote: 'no stable profile id — not recorded', ...result });
          return;
        }
        const record = await recordScreening({ id, name: targetName, profileUrl }, result);
        sendResponse({ ok: true, ledgerState: record.state, ...result });
      }

      try {
        // Dedupe: if this person was already screened before, don't waste
        // another AI call (or even re-run the keyword tiers) — the ledger
        // exists specifically so a decided person is never re-litigated.
        if (id) {
          const existing = await getPerson(id);
          if (existing?.screening) {
            await log('info', 'Screening skipped — already in ledger', { targetName, state: existing.state });
            sendResponse({ ok: true, ledgerState: existing.state, fromCache: true, ...existing.screening });
            return;
          }
        }

        const settings = await getSettings();
        const { includeKeywords, excludeKeywords, targetPersona, claude, confidenceThreshold, rejectFloor } =
          settings;

        // Exclude and exact-include verdicts are deterministic by design —
        // not run through computeVerdict's threshold comparison — so they
        // stay correct regardless of whatever the user sets the sliders to.
        if (matchesAny(text, excludeKeywords)) {
          await finalize({
            tier: 'exclude',
            verdict: 'reject',
            confidence: 0,
            reasoning: 'Matched an exclude keyword.',
            signals: [],
          });
          return;
        }

        if (matchesAnyExact(text, includeKeywords)) {
          await finalize({
            tier: 'exact-include',
            verdict: 'auto-add',
            confidence: 100,
            reasoning: 'Exact include-keyword match — auto-shortlisted without an AI call.',
            signals: [],
          });
          return;
        }

        const aiResult = await screenCandidate({
          apiKey: claude.apiKey,
          model: claude.model,
          targetPersona,
          profileText: text,
          links,
        });
        const verdict = computeVerdict(aiResult.confidence, {
          autoAddThreshold: confidenceThreshold,
          rejectFloor,
        });
        await finalize({ tier: 'ai', verdict, ...aiResult });
      } catch (err) {
        await log('error', 'Screening failed', { targetName, error: err.message });
        sendResponse({ ok: false, error: err.message });
      }
    })();
    return true;
  }
  return false;
});
