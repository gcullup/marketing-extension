import { getSettings } from '../lib/store.js';
import { log } from '../lib/log.js';
import { getAllPeople, getDmCandidates } from '../lib/ledger.js';

const statusEl = document.getElementById('status');
const pingBtn = document.getElementById('pingBtn');
const pingResult = document.getElementById('pingResult');
const reviewQueueLink = document.getElementById('reviewQueueLink');
const sendQueueLink = document.getElementById('sendQueueLink');
const dmQueueLink = document.getElementById('dmQueueLink');

async function refreshQueueCounts() {
  const people = await getAllPeople();
  const pendingCount = people.filter((p) => p.state === 'needs_review').length;
  reviewQueueLink.textContent = pendingCount ? `Review Queue (${pendingCount} waiting)` : 'Review Queue';

  const queuedCount = people.filter((p) => p.state === 'queued').length;
  sendQueueLink.textContent = queuedCount ? `Send Queue (${queuedCount} queued)` : 'Send Queue';

  const settings = await getSettings();
  const dmCount = (await getDmCandidates(settings.dmDelayDays)).length;
  dmQueueLink.textContent = dmCount ? `DM Queue (${dmCount} eligible)` : 'DM Queue';
}

// The side panel stays open in the background while Review/Send Queue open
// in separate tabs — confirmed live (2026-09-01) that approving someone in
// Review Queue never updated the panel's count, since it was only ever
// computed once at open time. chrome.storage.onChanged fires for a write
// from ANY extension page, so this keeps the counts live regardless of
// where the ledger actually changed.
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local' && changes.mkt_ledger) {
    refreshQueueCounts();
  }
});

async function init() {
  try {
    const settings = await getSettings();
    statusEl.textContent = `Storage OK. Target persona: "${settings.targetPersona}"`;
    await log('info', 'Side panel opened');
  } catch (err) {
    statusEl.textContent = `Storage error: ${err.message}`;
  }

  await refreshQueueCounts();
  restoreBatchStatus();
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

const testScrapeBtn = document.getElementById('testScrapeBtn');
const scrapeResult = document.getElementById('scrapeResult');

testScrapeBtn.addEventListener('click', async () => {
  scrapeResult.textContent = 'Scraping (read-only)…';
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url?.includes('facebook.com')) {
    scrapeResult.textContent = 'Active tab is not facebook.com — open a Facebook tab first.';
    return;
  }
  chrome.tabs.sendMessage(tab.id, { type: 'TEST_SCRAPE' }, (response) => {
    if (chrome.runtime.lastError) {
      scrapeResult.textContent = `No response: ${chrome.runtime.lastError.message}`;
      return;
    }
    scrapeResult.textContent = JSON.stringify(response, null, 2);
  });
});

const testClickBtn = document.getElementById('testClickBtn');
const clickResult = document.getElementById('clickResult');

testClickBtn.addEventListener('click', async () => {
  clickResult.textContent = 'Clicking first candidate and waiting for navigation…';
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url?.includes('facebook.com')) {
    clickResult.textContent = 'Active tab is not facebook.com — open a Facebook tab first.';
    return;
  }
  chrome.tabs.sendMessage(tab.id, { type: 'TEST_CLICK_FIRST_CANDIDATE' }, (response) => {
    if (chrome.runtime.lastError) {
      clickResult.textContent = `No response: ${chrome.runtime.lastError.message}`;
      return;
    }
    clickResult.textContent = JSON.stringify(response, null, 2);
  });
});

const testFullScrapeBtn = document.getElementById('testFullScrapeBtn');
const fullScrapeResult = document.getElementById('fullScrapeResult');

testFullScrapeBtn.addEventListener('click', async () => {
  fullScrapeResult.textContent = 'Clicking, waiting, scrolling, extracting… this can take up to ~15s.';
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url?.includes('facebook.com')) {
    fullScrapeResult.textContent = 'Active tab is not facebook.com — open a Facebook tab first.';
    return;
  }
  chrome.tabs.sendMessage(tab.id, { type: 'TEST_FULL_CANDIDATE_SCRAPE' }, (response) => {
    if (chrome.runtime.lastError) {
      fullScrapeResult.textContent = `No response: ${chrome.runtime.lastError.message}`;
      return;
    }
    fullScrapeResult.textContent = JSON.stringify(response, null, 2);
  });
});

const testAiScreenBtn = document.getElementById('testAiScreenBtn');
const aiScreenResult = document.getElementById('aiScreenResult');

testAiScreenBtn.addEventListener('click', async () => {
  aiScreenResult.textContent = 'Scraping first candidate (click + scroll + extract)…';
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url?.includes('facebook.com')) {
    aiScreenResult.textContent = 'Active tab is not facebook.com — open a Facebook tab first.';
    return;
  }

  chrome.tabs.sendMessage(tab.id, { type: 'TEST_FULL_CANDIDATE_SCRAPE' }, (scrapeResponse) => {
    if (chrome.runtime.lastError) {
      aiScreenResult.textContent = `No response from content script: ${chrome.runtime.lastError.message}`;
      return;
    }
    if (!scrapeResponse?.ok) {
      aiScreenResult.textContent = `Scrape failed: ${scrapeResponse?.reason ?? 'unknown error'}`;
      return;
    }

    if (scrapeResponse.skippedScrape) {
      // Already in the ledger — the content script caught this before ever
      // clicking or scrolling, so there's nothing new to send for scoring.
      aiScreenResult.textContent = JSON.stringify(scrapeResponse, null, 2);
      return;
    }

    aiScreenResult.textContent = `Scraped ${scrapeResponse.targetName}. Screening (exclude → exact-include → AI)…`;
    chrome.runtime.sendMessage(
      {
        type: 'SCREEN_CANDIDATE',
        text: scrapeResponse.text,
        links: scrapeResponse.links,
        targetName: scrapeResponse.targetName,
        profileUrl: scrapeResponse.finalUrl,
      },
      (screenResponse) => {
        if (chrome.runtime.lastError) {
          aiScreenResult.textContent = `No response from background: ${chrome.runtime.lastError.message}`;
          return;
        }
        aiScreenResult.textContent = JSON.stringify(
          { targetName: scrapeResponse.targetName, finalUrl: scrapeResponse.finalUrl, ...screenResponse },
          null,
          2
        );
      }
    );
  });
});

const viewLedgerBtn = document.getElementById('viewLedgerBtn');
const ledgerResult = document.getElementById('ledgerResult');

viewLedgerBtn.addEventListener('click', async () => {
  const people = await getAllPeople();
  if (!people.length) {
    ledgerResult.textContent = 'Ledger is empty — no one has been screened yet.';
    return;
  }
  const summary = people.map((p) => ({
    name: p.name,
    state: p.state,
    tier: p.screening?.tier,
    confidence: p.screening?.confidence,
  }));
  ledgerResult.textContent = `${people.length} record(s):\n${JSON.stringify(summary, null, 2)}`;
});

const runBatchBtn = document.getElementById('runBatchBtn');
const stopBatchBtn = document.getElementById('stopBatchBtn');
const batchResult = document.getElementById('batchResult');
const batchSpinner = document.getElementById('batchSpinner');
const batchProgressWrap = document.getElementById('batchProgressWrap');
const batchProgressBar = document.getElementById('batchProgressBar');
const batchProgressText = document.getElementById('batchProgressText');

// Revised 2026-09-01: the discovery batch used to be one continuous
// background call that blocked on a single final response — confirmed live
// to silently die mid-batch when MV3 kills the service worker (see
// ARCHITECTURE.md hazard #2 and background/service-worker.js's discovery
// batch section for the full story). It's now chrome.alarms-driven and
// spans many separate invocations, so RUN_DISCOVERY_BATCH only ever starts
// (or attaches to) the batch and returns almost immediately — the actual
// progress arrives via these two broadcasts instead of a blocking response.
function setBatchRunningUi(running) {
  runBatchBtn.disabled = running;
  stopBatchBtn.style.display = running ? 'inline-block' : 'none';
  batchSpinner.style.display = running ? 'inline-block' : 'none';
  batchProgressWrap.style.display = running ? 'block' : 'none';
}

function renderBatchProgress({ candidatesTried, newlyScreened, dailyLimit, lastName }) {
  const pct = dailyLimit > 0 ? Math.min(100, Math.round((newlyScreened / dailyLimit) * 100)) : 0;
  batchProgressBar.style.width = `${pct}%`;
  batchProgressText.textContent = lastName
    ? `${newlyScreened}/${dailyLimit} screened (${candidatesTried} tried) — last: ${lastName}`
    : `${newlyScreened}/${dailyLimit} screened (${candidatesTried} tried)`;
}

// Pushed live from background/service-worker.js's processDiscoveryStep
// (once per candidate) — the only way to show real progress during a run
// that can now legitimately span far longer than before, since chrome.alarms
// paces steps at least ~30s apart (see the background file for why).
// BATCH_COMPLETE is new: the old code's single request/response used to
// deliver the final summary directly; now that RUN_DISCOVERY_BATCH returns
// immediately, this broadcast is the only way the panel finds out the batch
// actually finished (daily limit reached, list exhausted, stopped, or
// errored out — e.g. the original tab was closed or navigated away).
chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === 'BATCH_PROGRESS') {
    renderBatchProgress(message);
    return;
  }
  if (message?.type === 'BATCH_COMPLETE') {
    setBatchRunningUi(false);
    batchResult.textContent = JSON.stringify(message, null, 2);
    return;
  }
});

const SUGGESTIONS_URL = 'https://www.facebook.com/friends/suggestions';

// Real gap found live (2026-09-01): the old check only required "any
// facebook.com tab," not specifically the suggestions page — clicking this
// from, say, the main feed silently ran a real batch against the wrong page,
// which correctly (if confusingly) found zero candidates and immediately
// reported list_exhausted. Rather than just telling the user to go there
// themselves, navigate the active tab there directly — the same "just
// handle it" instinct already applied to Send Queue's "open a suggestions
// tab" link and the DM/friend-request profile-page fallbacks.
function ensureOnSuggestionsPage(tab) {
  if (tab.url && tab.url.startsWith(SUGGESTIONS_URL)) return Promise.resolve(tab);

  return new Promise((resolve, reject) => {
    let settled = false;
    let timeoutHandle;

    function finish(result, err) {
      if (settled) return;
      settled = true;
      chrome.tabs.onUpdated.removeListener(onUpdated);
      clearTimeout(timeoutHandle);
      if (err) reject(err);
      else resolve(result);
    }

    function onUpdated(updatedTabId, changeInfo, updatedTab) {
      if (updatedTabId !== tab.id || changeInfo.status !== 'complete') return;
      // Let the SPA content itself render before handing back, same
      // reasoning as the profile-page fallbacks elsewhere in this project.
      setTimeout(() => finish(updatedTab), 1500);
    }
    chrome.tabs.onUpdated.addListener(onUpdated);

    timeoutHandle = setTimeout(() => finish(null, new Error('timed out loading the suggestions page')), 15000);
    chrome.tabs.update(tab.id, { url: SUGGESTIONS_URL });
  });
}

runBatchBtn.addEventListener('click', async () => {
  let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) {
    batchResult.textContent = 'No active tab found.';
    return;
  }

  batchResult.textContent = '';
  setBatchRunningUi(true);
  batchProgressBar.style.width = '0%';
  batchProgressText.textContent = 'Opening the suggestions page…';

  try {
    tab = await ensureOnSuggestionsPage(tab);
  } catch (err) {
    setBatchRunningUi(false);
    batchResult.textContent = `Couldn't open the suggestions page: ${err.message}`;
    return;
  }

  batchProgressText.textContent = 'Starting…';

  chrome.runtime.sendMessage({ type: 'RUN_DISCOVERY_BATCH', tabId: tab.id }, (response) => {
    if (chrome.runtime.lastError) {
      setBatchRunningUi(false);
      batchResult.textContent = `No response from background: ${chrome.runtime.lastError.message}`;
      return;
    }
    if (!response) {
      setBatchRunningUi(false);
      batchResult.textContent = 'Batch failed to start: no response from background.';
      return;
    }
    if (response.alreadyRunning) {
      // Someone else already started this (or it's resuming after a
      // reload) — attach to it rather than reporting a fresh start.
      batchProgressText.textContent = 'A batch is already running — showing its live progress…';
      renderBatchProgress(response);
      return; // stays in the "running" UI state; broadcasts take it from here
    }
    if (response.status === 'done' || response.status === 'error' || response.status === 'stopped') {
      // Finished before ever scheduling an alarm — e.g. today's scan limit
      // is set to 0.
      setBatchRunningUi(false);
      batchResult.textContent = JSON.stringify(response, null, 2);
      return;
    }
    // status === 'running' (just started) — leave the running UI up;
    // BATCH_PROGRESS and the eventual BATCH_COMPLETE broadcast take over
    // from here. The very first progress update can take up to ~30s
    // (chrome.alarms' minimum interval), not the near-instant start the old
    // in-process loop had.
    batchProgressText.textContent = 'Started — first candidate will be screened shortly (can take up to ~30s)…';
  });
});

stopBatchBtn.addEventListener('click', () => {
  batchProgressText.textContent = 'Stopping — can take up to one inter-candidate pause before it fully lands…';
  chrome.runtime.sendMessage({ type: 'STOP_DISCOVERY_BATCH' }, (response) => {
    if (chrome.runtime.lastError) {
      batchResult.textContent = `No response from background: ${chrome.runtime.lastError.message}`;
    }
    // Final UI cleanup happens when the BATCH_COMPLETE broadcast arrives.
  });
});

// Restores the running/idle UI correctly if the panel is opened (or
// reopened) while a batch is already in progress — otherwise reopening mid-
// batch would show the button as idle and ready to click, which would then
// incorrectly report "already running" instead of just reflecting reality
// up front.
function restoreBatchStatus() {
  chrome.runtime.sendMessage({ type: 'GET_BATCH_STATUS' }, (response) => {
    if (chrome.runtime.lastError || !response) return;
    if (response.status === 'running') {
      setBatchRunningUi(true);
      renderBatchProgress(response);
    }
  });
}

const checkAcceptancesBtn = document.getElementById('checkAcceptancesBtn');
const acceptancesResult = document.getElementById('acceptancesResult');
const acceptancesSpinner = document.getElementById('acceptancesSpinner');

// Doesn't need an active facebook.com tab the way the discovery batch and
// scrape tests do — it opens its own background tab per person, so it can
// run regardless of what's currently on screen.
checkAcceptancesBtn.addEventListener('click', async () => {
  checkAcceptancesBtn.disabled = true;
  acceptancesSpinner.style.display = 'inline-block';
  acceptancesResult.textContent = 'Checking pending requests — this opens a background tab per person…';

  chrome.runtime.sendMessage({ type: 'CHECK_ACCEPTANCES' }, (response) => {
    checkAcceptancesBtn.disabled = false;
    acceptancesSpinner.style.display = 'none';

    if (chrome.runtime.lastError) {
      acceptancesResult.textContent = `No response from background: ${chrome.runtime.lastError.message}`;
      return;
    }
    if (!response?.ok) {
      acceptancesResult.textContent = `Check failed: ${response?.error ?? 'unknown error'}`;
      return;
    }
    acceptancesResult.textContent = JSON.stringify(response, null, 2);
  });
});

init();
