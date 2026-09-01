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
  markCancelled,
} from '../lib/ledger.js';

chrome.runtime.onInstalled.addListener(async () => {
  await initSettingsIfMissing();
  await log('info', 'Extension installed/updated — Phase 0 skeleton running.');
  await selfHealDiscoveryAlarm();
});

// A dev reload of the unpacked extension (already documented elsewhere in
// this project as orphaning content scripts) also clears any chrome.alarms
// that were scheduled — but NOT the discovery batch's persisted state in
// chrome.storage.local, which survives untouched. Left alone, that strands
// a "running" batch forever with no alarm left to wake it. Re-armed here on
// both install/reload and browser startup so it isn't only fixed by luck of
// someone happening to click "Run Discovery Batch" again.
chrome.runtime.onStartup.addListener(selfHealDiscoveryAlarm);

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

// ---------------------------------------------------------------------------
// Discovery batch — persisted, chrome.alarms-driven (rebuilt 2026-09-01)
// ---------------------------------------------------------------------------
//
// Replaces a previous design that ran the entire batch inside one
// continuous while(true) loop in a single message-handler invocation.
// Confirmed dead live (2026-09-01): a real 50-candidate batch screened
// steadily for ~27 minutes, then simply stopped — no "Discovery batch
// finished" log line ever appeared, and the side panel's
// chrome.runtime.sendMessage callback got
// chrome.runtime.lastError.message === "The message channel closed before a
// response was received." — the classic MV3 service-worker-termination
// signature (see ARCHITECTURE.md hazard #2). Nothing already-screened was
// lost (every candidate was written to the ledger immediately, not
// buffered), but the batch itself silently died without ever completing.
//
// Redesigned so NO single invocation of this code can span more than
// roughly one candidate's worth of real work:
//   - All progress lives in chrome.storage.local (DISCOVERY_STATE_KEY),
//     saved after every candidate — not just at the end — so a killed and
//     restarted service worker resumes exactly where it left off.
//   - The NEXT step is scheduled via chrome.alarms.create, never an
//     in-process await/setTimeout. chrome.alarms survives the service
//     worker being torn down and restarted; a pending setTimeout does not.
//   - chrome.alarms.onAlarm drives every step after the first, reading
//     persisted state, processing more work, and either scheduling the next
//     alarm or finalizing.
//
// Real, deliberate tradeoff (see PR description for the full writeup):
// Chrome clamps alarms to fire no more than once per ~30 seconds, even when
// asked for less. The old 3-15s inter-candidate pacing can no longer be
// honored at that granularity — every real-interaction step is now
// realistically at least ~30s from the next. Judged worth it: surviving
// termination reliably matters more than sub-30s pacing precision, and the
// bigger anti-detection lever was always session-level (daily caps, human
// approval gates), not the exact number of seconds between two candidates.

const DISCOVERY_ALARM_NAME = 'mkt_discovery_batch_step';
const DISCOVERY_STATE_KEY = 'mkt_discovery_batch_state';

// Safety nets independent of the daily scan limit, so a bug in list-growth
// detection or an unexpected page state can't spin forever. Candidate cap
// unchanged from the original design.
const BATCH_SAFETY_MAX_CANDIDATES_TRIED = 300;
// Widened from the original 20 minutes: that figure assumed the whole batch
// ran as one in-process loop with a few-second pacing gap. Now every
// real-interaction step is realistically ~30s+ apart (chrome.alarms' floor,
// see above), so a full-scale batch (e.g. the default 80/day scan limit)
// can legitimately take well over an hour of real wall-clock time with
// nothing wrong at all. This cap exists to catch a genuinely stuck/looping
// bug, not to bound normal operation.
const BATCH_SAFETY_MAX_DURATION_MS = 4 * 60 * 60 * 1000; // 4 hours

// Cache-hit / already-decided candidates cost ~nothing (no real Facebook
// interaction, no pacing delay owed) and are safe to process back to back
// within one invocation — this bounds how many can run in a single
// alarm-triggered step, so a long contiguous run of already-known
// candidates can't itself become an unbounded-duration call.
const MAX_FREE_STEPS_PER_INVOCATION = 25;
// Same reasoning for the "need to scroll the virtualized list to find more
// candidates" path — bounds how many scrolls one invocation will attempt
// before yielding back to a fresh alarm-triggered invocation.
const MAX_SCROLLS_PER_INVOCATION = 15;
// Chrome silently clamps delayInMinutes below this to ~30s anyway (see
// chrome.alarms docs) — computed this way rather than pretending
// finer-grained scheduling is actually possible.
const MIN_ALARM_DELAY_MINUTES = 0.5;

async function getDiscoveryState() {
  const data = await chrome.storage.local.get(DISCOVERY_STATE_KEY);
  return data[DISCOVERY_STATE_KEY] ?? null;
}

async function saveDiscoveryState(state) {
  state.updatedAt = Date.now();
  await chrome.storage.local.set({ [DISCOVERY_STATE_KEY]: state });
  return state;
}

async function clearDiscoveryAlarm() {
  await chrome.alarms.clear(DISCOVERY_ALARM_NAME);
}

function finalSummary(state) {
  return {
    ok: state.status !== 'error',
    status: state.status,
    candidatesTried: state.candidatesTried,
    newlyScreened: state.newlyScreened,
    results: state.results,
    stoppedReason: state.stoppedReason,
    todayKey: state.todayKey,
    dailyLimit: state.dailyLimit,
    error: state.error,
  };
}

function broadcastComplete(state) {
  chrome.runtime.sendMessage({ type: 'BATCH_COMPLETE', ...finalSummary(state) }).catch(() => {});
}

// A dev reload of the unpacked extension clears any scheduled chrome.alarms
// but NOT the persisted state in chrome.storage.local — left alone, that
// would strand a "running" batch forever with nothing left to wake it up.
// Called on both onInstalled and onStartup, and reused from
// startDiscoveryBatch's "already running" branch so a stray click on "Run
// Discovery Batch" after a reload also self-heals rather than just reporting
// a batch that (silently) can never actually resume.
async function selfHealDiscoveryAlarm() {
  const state = await getDiscoveryState();
  if (state?.status !== 'running') return;
  const scheduled = await chrome.alarms.get(DISCOVERY_ALARM_NAME);
  if (!scheduled) {
    await chrome.alarms.create(DISCOVERY_ALARM_NAME, { delayInMinutes: MIN_ALARM_DELAY_MINUTES });
    await log('info', 'Discovery batch: re-armed a stranded alarm', { tabId: state.tabId });
  }
}

/**
 * Confirms the batch's original Facebook tab is still usable before doing
 * more work against it. A resumed batch can now span a real gap of minutes
 * (or longer) between steps — nothing like the old in-process loop's
 * negligible gap — so the tab it was launched against might have been
 * closed, or navigated away from Facebook entirely, by the time a later
 * alarm fires.
 *
 * Deliberately does NOT require the tab's URL to still be the literal
 * suggestions page: clicking into a candidate is a genuine, already-verified
 * split-view URL change (see WORKFLOW-MAP.md Phase 1 — the list stays live
 * underneath, nothing is a full navigation away), so requiring an exact URL
 * match would misfire on every normal candidate visit, not just a real
 * navigate-away. Only flags a hard failure: the tab is gone, or it's now on
 * some entirely different site.
 */
async function validateBatchTab(tabId) {
  let tab;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch {
    return { ok: false, reason: 'The original Facebook tab was closed before the batch finished.' };
  }
  if (!tab.url || !tab.url.startsWith('https://www.facebook.com')) {
    return { ok: false, reason: 'The original tab navigated away from Facebook before the batch finished.' };
  }
  return { ok: true };
}

/**
 * Starts a new discovery batch, or reports/self-heals an already-running
 * one. Never lets a second batch start while one is already in progress —
 * per Greg's edge case: reopening the panel, opening a new tab, or clicking
 * "Run Discovery Batch" again mid-batch should attach to the existing run,
 * not race a second one against it.
 */
async function startDiscoveryBatch(tabId) {
  const existing = await getDiscoveryState();
  if (existing?.status === 'running') {
    await selfHealDiscoveryAlarm();
    return { ok: true, alreadyRunning: true, ...finalSummary(existing) };
  }

  const settings = await getSettings();
  const todayKey = DAY_KEYS[new Date().getDay()];
  const dailyLimit = settings.scanLimitsByDay?.[todayKey] ?? 0;

  const state = {
    status: 'running',
    tabId,
    todayKey,
    dailyLimit,
    startedAt: Date.now(),
    index: 0,
    previousListLength: -1,
    noGrowthStreak: 0,
    candidatesTried: 0,
    newlyScreened: 0,
    results: [],
    stopRequested: false,
    stoppedReason: null,
    error: null,
  };

  if (dailyLimit <= 0) {
    state.status = 'done';
    state.stoppedReason = 'daily_limit_is_zero';
    await saveDiscoveryState(state);
    broadcastComplete(state);
    return finalSummary(state);
  }

  await saveDiscoveryState(state);
  // Every step — including the very first — goes through the same
  // chrome.alarms path rather than special-casing "the first step runs
  // inline." One consistent code path is easier to verify than two. The
  // real cost: a ~30s wait (Chrome's alarm floor) before the first candidate
  // is actually screened, instead of the near-instant start the old
  // synchronous loop had — a minor, deliberate trade for structural safety.
  await chrome.alarms.create(DISCOVERY_ALARM_NAME, { delayInMinutes: MIN_ALARM_DELAY_MINUTES });
  await log('info', 'Discovery batch started', { todayKey, dailyLimit, tabId });
  return { ok: true, started: true, ...finalSummary(state) };
}

/**
 * Requests a stop. Does NOT clear the already-scheduled alarm — the next
 * tick sees stopRequested and finalizes cleanly on its own. That means Stop
 * can take up to one inter-candidate pacing interval to fully land (at
 * least Chrome's ~30s alarm floor), not the sub-second response the Send
 * Queue's Process All Stop button gets — there's no in-process wait loop
 * left here to poll every 500ms, on purpose, since removing that
 * long-running loop is the entire point of this redesign.
 */
async function stopDiscoveryBatch() {
  const state = await getDiscoveryState();
  if (!state || state.status !== 'running') {
    return { ok: true, wasRunning: false };
  }
  state.stopRequested = true;
  await saveDiscoveryState(state);
  return { ok: true, wasRunning: true };
}

async function getDiscoveryBatchStatus() {
  const state = await getDiscoveryState();
  if (!state) return { status: 'idle' };
  return finalSummary(state);
}

/**
 * One alarm-driven step. Processes up to MAX_FREE_STEPS_PER_INVOCATION
 * "free" (no real Facebook interaction) candidates back to back, or exactly
 * one real-interaction candidate, persisting state after every single one —
 * then yields back by scheduling the next alarm rather than sleeping
 * in-process. This bounds every invocation to roughly the time of one real
 * profile scrape at most — the scale already proven safe (a small batch has
 * never shown a sign of being killed); the confirmed failure mode was
 * chaining dozens of these across one continuous multi-minute function
 * call, which this eliminates by construction rather than by hoping the
 * kill timing stays favorable.
 */
async function processDiscoveryStep() {
  const state = await getDiscoveryState();
  if (!state || state.status !== 'running') return; // stray alarm fire — nothing to do

  if (state.stopRequested) {
    state.status = 'stopped';
    state.stoppedReason = 'user_stopped';
    await saveDiscoveryState(state);
    await clearDiscoveryAlarm();
    await log('info', 'Discovery batch stopped by user', { todayKey: state.todayKey, newlyScreened: state.newlyScreened });
    broadcastComplete(state);
    return;
  }

  const tabCheck = await validateBatchTab(state.tabId);
  if (!tabCheck.ok) {
    state.status = 'error';
    state.error = tabCheck.reason;
    state.stoppedReason = 'tab_unavailable';
    await saveDiscoveryState(state);
    await clearDiscoveryAlarm();
    await log('error', 'Discovery batch failed — tab unavailable', { reason: tabCheck.reason });
    broadcastComplete(state);
    return;
  }

  const settings = await getSettings();
  let freeStepsThisInvocation = 0;
  let scrollsThisInvocation = 0;
  let pacedDelayNeeded = false;

  while (true) {
    if (state.newlyScreened >= state.dailyLimit) {
      state.status = 'done';
      state.stoppedReason = 'daily_limit_reached';
      break;
    }
    if (state.candidatesTried >= BATCH_SAFETY_MAX_CANDIDATES_TRIED) {
      state.status = 'done';
      state.stoppedReason = 'safety_cap_candidates';
      break;
    }
    if (Date.now() - state.startedAt >= BATCH_SAFETY_MAX_DURATION_MS) {
      state.status = 'done';
      state.stoppedReason = 'safety_cap_duration';
      break;
    }
    if (state.stopRequested) {
      state.status = 'stopped';
      state.stoppedReason = 'user_stopped';
      break;
    }

    let candidates;
    try {
      ({ candidates } = await sendToTab(state.tabId, { type: 'GET_CANDIDATE_LIST' }));
    } catch (err) {
      // Passed validateBatchTab a moment ago but messaging it just failed
      // anyway (closed in the interim, content script not there, etc.) —
      // same outcome as a tab-unavailable failure, not a crash.
      state.status = 'error';
      state.error = `Lost contact with the Facebook tab: ${err.message}`;
      state.stoppedReason = 'tab_unavailable';
      break;
    }

    if (state.index >= candidates.length) {
      // Need more candidates than are currently rendered — scroll the list
      // (it's virtualized) and check again. Two consecutive scrolls with no
      // growth means we've hit the real end, not just a lazy-load delay.
      if (candidates.length === state.previousListLength) {
        state.noGrowthStreak++;
        if (state.noGrowthStreak >= 2) {
          state.status = 'done';
          state.stoppedReason = 'list_exhausted';
          break;
        }
      } else {
        state.noGrowthStreak = 0;
      }
      state.previousListLength = candidates.length;
      await sendToTab(state.tabId, { type: 'SCROLL_LIST' });
      scrollsThisInvocation++;
      if (scrollsThisInvocation >= MAX_SCROLLS_PER_INVOCATION) break; // yield, still running — short delay, see below
      continue;
    }

    const candidate = candidates[state.index];
    state.index++;
    state.candidatesTried++;

    // Confirmed live (2026-08-31): a single candidate's Claude call can fail
    // schema validation even after the built-in retry — one bad candidate
    // must never take the rest of the batch down with it.
    //
    // didInteractWithFacebook gates whether this invocation owes a paced
    // delay before the next one: pacing only makes sense after real DOM
    // interaction happened, not after an instant cache-skip where nothing
    // visible occurred.
    let didInteractWithFacebook = false;
    try {
      const scrapeResult = await sendToTab(state.tabId, {
        type: 'SCRAPE_CANDIDATE',
        name: candidate.name,
        href: candidate.href,
      });

      if (!scrapeResult.ok) {
        state.results.push({ name: candidate.name, error: scrapeResult.reason });
      } else if (scrapeResult.skippedScrape) {
        // Already known — doesn't count toward today's limit, since nothing
        // new was screened. But if they were rejected and removal never
        // actually succeeded, retry it here (cheap — href already in hand,
        // row confirmed present right now via listCandidates()).
        let removed = scrapeResult.removedFromSuggestions === true ? true : undefined;
        let removedReason;
        if (scrapeResult.ledgerState === 'rejected' && scrapeResult.removedFromSuggestions !== true) {
          didInteractWithFacebook = true; // a real click, even though the scrape itself was skipped
          const removeResult = await sendToTab(state.tabId, {
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
        state.results.push({
          name: candidate.name,
          ledgerState: scrapeResult.ledgerState,
          skipped: true,
          removed,
          removedReason,
        });
      } else {
        didInteractWithFacebook = true;
        const screenResult = await screenAndRecord({
          text: scrapeResult.text,
          links: scrapeResult.links,
          targetName: candidate.name,
          profileUrl: scrapeResult.finalUrl,
        });

        // Per Greg's design (2026-08-31): a fresh reject dismisses the
        // suggestion via Facebook's own "Remove" affordance. Only for a
        // FRESH reject, not a cached one — a cache hit means this was
        // already attempted on an earlier run (handled in the branch above).
        let removed;
        let removedReason;
        if (screenResult.verdict === 'reject') {
          const removeResult = await sendToTab(state.tabId, {
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

        state.results.push({
          name: candidate.name,
          tier: screenResult.tier,
          verdict: screenResult.verdict,
          confidence: screenResult.confidence,
          ledgerState: screenResult.ledgerState,
          removed,
          removedReason,
        });
        state.newlyScreened++;
      }
    } catch (err) {
      // Conservative: an error partway through likely means some real
      // interaction already happened before it failed, so still pace here.
      didInteractWithFacebook = true;
      await log('error', 'Candidate screening failed — continuing batch', {
        name: candidate.name,
        error: err.message,
      });
      state.results.push({ name: candidate.name, error: err.message });
      // Not recorded to the ledger, so this candidate is naturally retried
      // on a future step rather than being permanently skipped.
    }

    broadcastProgress({
      candidatesTried: state.candidatesTried,
      newlyScreened: state.newlyScreened,
      dailyLimit: state.dailyLimit,
      lastName: candidate.name,
    });
    await saveDiscoveryState(state); // persisted after EVERY candidate, not just at the end

    if (didInteractWithFacebook) {
      // A real step happened — stop this invocation here and let the next
      // alarm (paced per settings.timing, floored to Chrome's ~30s minimum)
      // pick up the next candidate, rather than sleeping in-process.
      pacedDelayNeeded = true;
      break;
    }

    freeStepsThisInvocation++;
    if (freeStepsThisInvocation >= MAX_FREE_STEPS_PER_INVOCATION) break; // yield anyway — see constant's comment
    // else loop again immediately — this candidate was free (cache hit, no
    // Facebook interaction), so no pacing delay is owed before the next one.
  }

  await saveDiscoveryState(state); // catch-all: covers every break path above, including the stop-condition checks at the top of the loop

  if (state.status === 'running') {
    let delayMinutes = MIN_ALARM_DELAY_MINUTES;
    if (pacedDelayNeeded) {
      const { minDelaySeconds, maxDelaySeconds } = settings.timing;
      const delaySeconds = minDelaySeconds + Math.random() * (maxDelaySeconds - minDelaySeconds);
      delayMinutes = Math.max(MIN_ALARM_DELAY_MINUTES, delaySeconds / 60);
    }
    await chrome.alarms.create(DISCOVERY_ALARM_NAME, { delayInMinutes: delayMinutes });
  } else {
    await clearDiscoveryAlarm();
    await log('info', 'Discovery batch finished', {
      todayKey: state.todayKey,
      dailyLimit: state.dailyLimit,
      newlyScreened: state.newlyScreened,
      stoppedReason: state.stoppedReason,
    });
    broadcastComplete(state);
  }
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== DISCOVERY_ALARM_NAME) return;
  processDiscoveryStep().catch((err) => log('error', 'Discovery batch step crashed', { error: err.message }));
});

// Opens a person's real profile in a background tab, waits for it to load,
// lets `callback` send as many messages to that tab as it needs, then
// cleans up the tab either way. Mirrors send.js's sendViaProfilePage
// pattern, generalized (2026-09-01) so one profile visit can both check
// acceptance AND, if warranted, act on it (cancel a stale request) without
// opening the same profile twice. A background tab won't disrupt whatever
// the user is doing in their active tab, and "complete" firing on network
// load needs a little extra time before the SPA content itself has
// actually rendered.
function withProfileTab(profileUrl, callback) {
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
        setTimeout(async () => {
          try {
            finish(await callback(tabId));
          } catch (err) {
            finish({ error: err.message });
          }
        }, 1500);
      }
      chrome.tabs.onUpdated.addListener(onUpdated);

      timeoutHandle = setTimeout(() => finish({ error: 'timed out loading profile page' }), 15000);
    });
  });
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Walks everyone currently in `requested` state, one profile visit each:
 * check acceptance, and if not accepted AND outstanding past
 * settings.staleRequestDays, cancel it in the same visit rather than
 * opening their profile twice. Deliberately a separate, on-demand step, not
 * folded into the discovery batch — this is a meaningfully different (and
 * slower) kind of work than screening a suggestions list.
 */
async function checkAcceptances() {
  const settings = await getSettings();
  const staleMs = (settings.staleRequestDays ?? 14) * DAY_MS;
  const requested = await listByState('requested');
  const results = [];

  for (const person of requested) {
    try {
      const outcome = await withProfileTab(person.profileUrl, async (tabId) => {
        const status = await sendToTab(tabId, { type: 'CHECK_FRIEND_STATUS' });
        if (status.isFriend) return { isFriend: true };

        const ageMs = person.requestedAt ? Date.now() - person.requestedAt : 0;
        if (person.requestedAt && ageMs > staleMs) {
          const cancelResult = await sendToTab(tabId, {
            type: 'CANCEL_FRIEND_REQUEST',
            testMode: settings.testMode,
          });
          return { isFriend: false, stale: true, cancelResult, daysWaiting: Math.floor(ageMs / DAY_MS) };
        }
        return { isFriend: false, stale: false, daysWaiting: Math.floor(ageMs / DAY_MS) };
      });

      if (outcome.error) {
        results.push({ name: person.name, accepted: false, error: outcome.error });
      } else if (outcome.isFriend) {
        await markAccepted(person.id);
        await log('info', 'Friend request accepted', { name: person.name });
        results.push({ name: person.name, accepted: true });
      } else if (outcome.stale && outcome.cancelResult?.cancelled) {
        await markCancelled(person.id);
        await log('info', 'Stale friend request cancelled', { name: person.name, daysWaiting: outcome.daysWaiting });
        results.push({ name: person.name, accepted: false, cancelled: true, daysWaiting: outcome.daysWaiting });
      } else if (outcome.stale) {
        // Stale enough to try, but the cancel click itself didn't succeed
        // (e.g. Test Mode) — surfaced so this is never a guessing game.
        results.push({
          name: person.name,
          accepted: false,
          cancelled: false,
          cancelReason: outcome.cancelResult?.reason,
          daysWaiting: outcome.daysWaiting,
        });
      } else {
        results.push({ name: person.name, accepted: false, stillWaiting: true, daysWaiting: outcome.daysWaiting });
      }
    } catch (err) {
      await log('error', 'Acceptance check failed — continuing', { name: person.name, error: err.message });
      results.push({ name: person.name, accepted: false, error: err.message });
    }
  }

  return {
    checked: requested.length,
    accepted: results.filter((r) => r.accepted).length,
    cancelled: results.filter((r) => r.cancelled).length,
    results,
  };
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
    // Starts (or attaches to) a batch and returns almost immediately — the
    // batch itself now runs across many chrome.alarms-driven steps, not one
    // long-lived call, so this can no longer block on a final summary. See
    // BATCH_PROGRESS/BATCH_COMPLETE broadcasts and GET_BATCH_STATUS below.
    (async () => {
      try {
        sendResponse(await startDiscoveryBatch(message.tabId));
      } catch (err) {
        await log('error', 'Discovery batch failed to start', { error: err.message });
        sendResponse({ ok: false, error: err.message });
      }
    })();
    return true;
  }
  if (message?.type === 'STOP_DISCOVERY_BATCH') {
    (async () => {
      try {
        sendResponse(await stopDiscoveryBatch());
      } catch (err) {
        sendResponse({ ok: false, error: err.message });
      }
    })();
    return true;
  }
  if (message?.type === 'GET_BATCH_STATUS') {
    // Lets the side panel restore the right UI if it's opened (or
    // reopened) while a batch is already running in the background.
    (async () => {
      try {
        sendResponse(await getDiscoveryBatchStatus());
      } catch (err) {
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
