// Orchestrator. This file knows NOTHING about Facebook's DOM — it only
// coordinates storage, logging, and messages to/from content scripts and the
// side panel. See ARCHITECTURE.md: "Governing principle: separate DECIDING
// from DOING."

import { initSettingsIfMissing, getSettings } from '../lib/store.js';
import { log } from '../lib/log.js';
import { matchesAny, matchesAnyExact } from '../lib/fuzzy.js';
import { screenCandidate } from '../lib/claude.js';
import { computeVerdict } from '../lib/verdict.js';
import {
  extractProfileId,
  getPerson,
  recordScreening,
  markRemovalAttempt,
  listByState,
  markAccepted,
} from '../lib/ledger.js';

chrome.runtime.onInstalled.addListener(async () => {
  await initSettingsIfMissing();
  await log('info', 'Extension installed/updated — Phase 0 skeleton running.');
});

// Let clicking the toolbar icon open the side panel directly.
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((err) => console.error('[TNG Marketing Extension] sidePanel setup failed:', err));

function sendToTab(tabId, message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(response);
      }
    });
  });
}

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

// Fire-and-forget progress push to whatever extension page is listening
// (the side panel). No response expected — if nothing's listening (panel
// closed), chrome.runtime.sendMessage rejects, which is fine to swallow
// since this is purely a UI nicety, not something the batch depends on.
function broadcastProgress(payload) {
  chrome.runtime.sendMessage({ type: 'BATCH_PROGRESS', ...payload }).catch(() => {});
}

/**
 * The DECIDE half of the pipeline, for one already-scraped candidate. The
 * content script only scrapes raw text/links (DOING); this is where the
 * tiering logic, the Claude call, and the ledger write live, per the
 * DECIDE/DO split.
 *
 * Tiering, per Greg's design (2026-08-31):
 *   1. Exclude keywords, fuzzy-matched (typo-tolerant) — hard reject, no AI
 *      call. Pure cost-saving; a false exclude just skips someone, which is
 *      a cheaper mistake than a wasted API call.
 *   2. Include keywords, EXACT match only — free instant shortlist, no AI
 *      call.
 *   3. Everything else always goes to the AI with the full text AND the
 *      extracted external links, judged holistically rather than by literal
 *      string match — this is what actually catches cases like a personal
 *      business website or a typo'd occupation.
 *
 * Shared by the single-candidate SCREEN_CANDIDATE message and the discovery
 * batch loop, so both go through identical dedupe/tiering/ledger logic
 * rather than two implementations that could drift apart.
 */
async function screenAndRecord({ text, links = [], targetName, profileUrl }) {
  const id = profileUrl ? extractProfileId(profileUrl) : null;

  async function finalize(result) {
    await log('info', `Screened candidate — ${result.tier}`, {
      targetName,
      verdict: result.verdict,
      confidence: result.confidence,
    });
    if (!id) {
      return { ok: true, ledgerState: null, ledgerNote: 'no stable profile id — not recorded', ...result };
    }
    const record = await recordScreening({ id, name: targetName, profileUrl }, result);
    return { ok: true, ledgerState: record.state, ...result };
  }

  // Dedupe: if this person was already screened, don't waste another AI
  // call (or even re-run the keyword tiers) — the ledger exists specifically
  // so a decided person is never re-litigated.
  if (id) {
    const existing = await getPerson(id);
    if (existing?.screening) {
      await log('info', 'Screening skipped — already in ledger', { targetName, state: existing.state });
      return { ok: true, ledgerState: existing.state, fromCache: true, ...existing.screening };
    }
  }

  const settings = await getSettings();
  const { includeKeywords, excludeKeywords, targetPersona, claude, confidenceThreshold, rejectFloor } = settings;

  // Exclude and exact-include verdicts are deterministic by design — not run
  // through computeVerdict's threshold comparison — so they stay correct
  // regardless of whatever the user sets the sliders to.
  if (matchesAny(text, excludeKeywords)) {
    return finalize({
      tier: 'exclude',
      verdict: 'reject',
      confidence: 0,
      reasoning: 'Matched an exclude keyword.',
      signals: [],
    });
  }

  if (matchesAnyExact(text, includeKeywords)) {
    return finalize({
      tier: 'exact-include',
      verdict: 'auto-add',
      confidence: 100,
      reasoning: 'Exact include-keyword match — auto-shortlisted without an AI call.',
      signals: [],
    });
  }

  const aiResult = await screenCandidate({
    apiKey: claude.apiKey,
    model: claude.model,
    targetPersona,
    profileText: text,
    links,
  });
  const verdict = computeVerdict(aiResult.confidence, { autoAddThreshold: confidenceThreshold, rejectFloor });
  return finalize({ tier: 'ai', verdict, ...aiResult });
}

// Safety nets independent of the daily scan limit, so a bug in list-growth
// detection or an unexpected page state can't spin forever.
const BATCH_SAFETY_MAX_CANDIDATES_TRIED = 300;
const BATCH_SAFETY_MAX_DURATION_MS = 20 * 60 * 1000; // 20 minutes

/**
 * Walks the candidate list in order, screening each one via the same
 * scrape → tier → AI → ledger path as the manual test button, until either
 * today's scan limit (Settings, per day of week) is reached or the list is
 * exhausted. Already-known candidates are cheap to pass over: their scrape
 * is skipped entirely at the content-script level (see
 * scrapeCandidateProfile's cache check) and they don't count against the
 * daily limit, since nothing new was screened.
 *
 * Every candidate is recorded to the ledger as soon as they're screened,
 * not buffered until the end — MV3 can terminate the background service
 * worker after ~30s of no extension-API activity, and a full batch can run
 * for several minutes. If that happens mid-batch, nothing already-completed
 * is lost, and running the batch again picks up where it left off (dedupe
 * skips everyone already done). This hasn't been tested against a real
 * multi-person batch yet — see WORKFLOW-MAP.md.
 */
async function runDiscoveryBatch(tabId) {
  const settings = await getSettings();
  const todayKey = DAY_KEYS[new Date().getDay()];
  const dailyLimit = settings.scanLimitsByDay?.[todayKey] ?? 0;

  const results = [];
  if (dailyLimit <= 0) {
    return { newlyScreened: 0, results, stoppedReason: 'daily_limit_is_zero', todayKey };
  }

  const startedAt = Date.now();
  let newlyScreened = 0;
  let index = 0;
  let previousListLength = -1;
  let noGrowthStreak = 0;
  let candidatesTried = 0;
  let stoppedReason = 'unknown';

  while (true) {
    if (newlyScreened >= dailyLimit) {
      stoppedReason = 'daily_limit_reached';
      break;
    }
    if (candidatesTried >= BATCH_SAFETY_MAX_CANDIDATES_TRIED) {
      stoppedReason = 'safety_cap_candidates';
      break;
    }
    if (Date.now() - startedAt >= BATCH_SAFETY_MAX_DURATION_MS) {
      stoppedReason = 'safety_cap_duration';
      break;
    }

    const { candidates } = await sendToTab(tabId, { type: 'GET_CANDIDATE_LIST' });

    if (index >= candidates.length) {
      // Need more candidates than are currently rendered — scroll the list
      // (it's virtualized) and check again. Two consecutive scrolls with no
      // growth means we've hit the real end, not just a lazy-load delay.
      if (candidates.length === previousListLength) {
        noGrowthStreak++;
        if (noGrowthStreak >= 2) {
          stoppedReason = 'list_exhausted';
          break;
        }
      } else {
        noGrowthStreak = 0;
      }
      previousListLength = candidates.length;
      await sendToTab(tabId, { type: 'SCROLL_LIST' });
      continue;
    }

    const candidate = candidates[index];
    index++;
    candidatesTried++;

    // Confirmed live (2026-08-31): a single candidate's Claude call can fail
    // schema validation even after the built-in retry, and previously that
    // exception propagated straight out of this loop, aborting the entire
    // batch and abandoning everyone after it — even though every candidate
    // before it had already been safely recorded. One bad candidate should
    // never take the rest of the batch down with it.
    //
    // didInteractWithFacebook (2026-09-01) gates the inter-candidate pause
    // below: pacing only makes sense after real DOM interaction (a click,
    // scroll, extraction) happened, not after an instant cache-skip where
    // nothing visible occurred.
    let didInteractWithFacebook = false;
    try {
      const scrapeResult = await sendToTab(tabId, {
        type: 'SCRAPE_CANDIDATE',
        name: candidate.name,
        href: candidate.href,
      });

      if (!scrapeResult.ok) {
        results.push({ name: candidate.name, error: scrapeResult.reason });
        continue;
      }
      if (scrapeResult.skippedScrape) {
        // Already known — doesn't count toward today's limit, since nothing
        // new was screened. But if they were rejected and removal never
        // actually succeeded (confirmed live, 2026-09-01: removal used to be
        // a one-shot attempt tied to the exact moment of the fresh reject —
        // anyone whose attempt failed, or who was rejected before Remove
        // existed at all, sat visible in the list forever, since every later
        // cache hit silently skipped past the removal logic), retry it here.
        // Cheap — we already have their href from the currently-loaded list,
        // no re-scrape needed, and since we just found them via
        // listCandidates(), their row is confirmed present right now.
        let removed = scrapeResult.removedFromSuggestions === true ? true : undefined;
        let removedReason;
        if (scrapeResult.ledgerState === 'rejected' && scrapeResult.removedFromSuggestions !== true) {
          didInteractWithFacebook = true; // a real click, even though the scrape itself was skipped
          const removeResult = await sendToTab(tabId, {
            type: 'REMOVE_CANDIDATE',
            href: candidate.href,
            testMode: settings.testMode,
          });
          removed = removeResult.removed;
          removedReason = removeResult.reason;
          if (removed) {
            const id = extractProfileId(candidate.href);
            if (id) await markRemovalAttempt(id, true);
          }
        }
        results.push({
          name: candidate.name,
          ledgerState: scrapeResult.ledgerState,
          skipped: true,
          removed,
          removedReason,
        });
        continue;
      }

      didInteractWithFacebook = true;
      const screenResult = await screenAndRecord({
        text: scrapeResult.text,
        links: scrapeResult.links,
        targetName: candidate.name,
        profileUrl: scrapeResult.finalUrl,
      });

      // Per Greg's design (2026-08-31): a fresh reject dismisses the
      // suggestion via Facebook's own "Remove" affordance, so rejected
      // people stop cluttering future scans. Only for a FRESH reject, not a
      // cached one — a cache hit means this was already attempted on an
      // earlier run.
      let removed;
      let removedReason;
      if (screenResult.verdict === 'reject') {
        const removeResult = await sendToTab(tabId, {
          type: 'REMOVE_CANDIDATE',
          href: candidate.href,
          testMode: settings.testMode,
        });
        removed = removeResult.removed;
        removedReason = removeResult.reason; // surfaced so "removed: false" is never a guessing game
        if (removed) {
          const id = extractProfileId(candidate.href);
          if (id) await markRemovalAttempt(id, true);
        }
      }

      results.push({
        name: candidate.name,
        tier: screenResult.tier,
        verdict: screenResult.verdict,
        confidence: screenResult.confidence,
        ledgerState: screenResult.ledgerState,
        removed,
        removedReason,
      });
      newlyScreened++;
    } catch (err) {
      // Conservative: an error partway through likely means some real
      // interaction already happened before it failed, so still pace here.
      didInteractWithFacebook = true;
      await log('error', 'Candidate screening failed — continuing batch', {
        name: candidate.name,
        error: err.message,
      });
      results.push({ name: candidate.name, error: err.message });
      // Not recorded to the ledger, so this candidate is naturally retried
      // on the next batch run rather than being permanently skipped.
    } finally {
      // Fires exactly once per iteration regardless of which branch above
      // ran (skip, success, or error) — a `finally` runs on every path out
      // of the try block, including `continue`, so this doesn't need to be
      // duplicated at each exit point.
      broadcastProgress({ candidatesTried, newlyScreened, dailyLimit, lastName: candidate.name });

      if (didInteractWithFacebook) {
        const { minDelaySeconds, maxDelaySeconds } = settings.timing;
        const delayMs = (minDelaySeconds + Math.random() * (maxDelaySeconds - minDelaySeconds)) * 1000;
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  await log('info', 'Discovery batch finished', { todayKey, dailyLimit, newlyScreened, stoppedReason });
  return { newlyScreened, results, stoppedReason, todayKey, dailyLimit };
}

// Step 9's foundational check, one person at a time: opens their real
// profile in a background tab, waits for it to load, checks for the
// Friends button (see content/scrape.js's checkFriendStatus), then cleans
// up the tab either way. Mirrors send.js's sendViaProfilePage pattern
// exactly — same reasoning applies: a background tab won't disrupt
// whatever the user is doing in their active tab, and "complete" firing on
// network load needs a little extra time before the SPA content itself has
// actually rendered.
function checkProfileFriendStatus(profileUrl) {
  return new Promise((resolve) => {
    chrome.tabs.create({ url: profileUrl, active: false }, (tab) => {
      const tabId = tab.id;
      let settled = false;
      let timeoutHandle;

      function finish(result) {
        if (settled) return;
        settled = true;
        chrome.tabs.onUpdated.removeListener(onUpdated);
        clearTimeout(timeoutHandle);
        chrome.tabs.remove(tabId).catch(() => {});
        resolve(result);
      }

      function onUpdated(updatedTabId, changeInfo) {
        if (updatedTabId !== tabId || changeInfo.status !== 'complete') return;
        setTimeout(() => {
          sendToTab(tabId, { type: 'CHECK_FRIEND_STATUS' })
            .then(finish)
            .catch((err) => finish({ isFriend: false, reason: err.message }));
        }, 1500);
      }
      chrome.tabs.onUpdated.addListener(onUpdated);

      timeoutHandle = setTimeout(() => finish({ isFriend: false, reason: 'timed out loading profile page' }), 15000);
    });
  });
}

/**
 * Walks everyone currently in `requested` state and checks whether they've
 * actually accepted. This is deliberately a separate, on-demand step, not
 * something folded into the discovery batch — checking acceptance means
 * opening a real background tab per person, which is a meaningfully
 * different (and slower) kind of work than screening a suggestions list.
 */
async function checkAcceptances() {
  const requested = await listByState('requested');
  const results = [];
  for (const person of requested) {
    try {
      const status = await checkProfileFriendStatus(person.profileUrl);
      if (status.isFriend) {
        await markAccepted(person.id);
        await log('info', 'Friend request accepted', { name: person.name });
        results.push({ name: person.name, accepted: true });
      } else {
        results.push({ name: person.name, accepted: false, reason: status.reason });
      }
    } catch (err) {
      await log('error', 'Acceptance check failed — continuing', { name: person.name, error: err.message });
      results.push({ name: person.name, accepted: false, error: err.message });
    }
  }
  return { checked: requested.length, accepted: results.filter((r) => r.accepted).length, results };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'PING') {
    sendResponse({ type: 'PONG', from: 'background', at: Date.now() });
    return true;
  }
  if (message?.type === 'CHECK_CACHED_SCREENING') {
    // Lets the content script check the ledger using only the candidate's
    // list-page href — BEFORE clicking, waiting for navigation, or
    // scrolling — so an already-screened person never gets re-clicked and
    // re-scrolled just to produce a result we already had. The dedupe
    // benefit is worthless if it only kicks in after the expensive DOM
    // work has already happened.
    (async () => {
      const { profileUrl } = message;
      const id = profileUrl ? extractProfileId(profileUrl) : null;
      if (!id) {
        sendResponse({ cached: false });
        return;
      }
      const existing = await getPerson(id);
      if (existing?.screening) {
        sendResponse({
          cached: true,
          ledgerState: existing.state,
          removedFromSuggestions: existing.removedFromSuggestions === true,
          ...existing.screening,
        });
      } else {
        sendResponse({ cached: false });
      }
    })();
    return true;
  }
  if (message?.type === 'SCREEN_CANDIDATE') {
    (async () => {
      try {
        sendResponse(await screenAndRecord(message));
      } catch (err) {
        await log('error', 'Screening failed', { targetName: message.targetName, error: err.message });
        sendResponse({ ok: false, error: err.message });
      }
    })();
    return true;
  }
  if (message?.type === 'RUN_DISCOVERY_BATCH') {
    (async () => {
      try {
        sendResponse(await runDiscoveryBatch(message.tabId));
      } catch (err) {
        await log('error', 'Discovery batch failed', { error: err.message });
        sendResponse({ ok: false, error: err.message });
      }
    })();
    return true;
  }
  if (message?.type === 'CHECK_ACCEPTANCES') {
    (async () => {
      try {
        sendResponse({ ok: true, ...(await checkAcceptances()) });
      } catch (err) {
        await log('error', 'Acceptance check batch failed', { error: err.message });
        sendResponse({ ok: false, error: err.message });
      }
    })();
    return true;
  }
  return false;
});
