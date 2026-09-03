import { listByState, markRequested, countRequestedToday, clearByState } from '../lib/ledger.js';
import { getSettings } from '../lib/store.js';
import { log } from '../lib/log.js';

const summaryEl = document.getElementById('summary');
const limitBannerEl = document.getElementById('limitBanner');
const emptyEl = document.getElementById('empty');
const cardsEl = document.getElementById('cards');
const refreshBtn = document.getElementById('refreshBtn');
const resetBtn = document.getElementById('resetBtn');

// Originally (2026-08-31): assisted click only, one explicit click per
// person, no inter-click pacing needed since a human clicking one at a time
// already paces at human speed. Revised 2026-09-01, per Greg: "Process All"
// (below) sends up to today's limit automatically with a randomized 8-18s
// pause between each — a deliberate step toward the unattended-sequence
// behavior the (still otherwise-unused) autoSend setting was conceptually
// meant to represent. Individual per-card sends are still pure assisted
// click; only Process All introduces pacing and multi-send automation.
async function findSuggestionsTab() {
  const tabs = await chrome.tabs.query({ url: 'https://www.facebook.com/friends/suggestions*' });
  return tabs[0] ?? null;
}

function sendMessageToTab(tabId, message) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      resolve(chrome.runtime.lastError ? { sent: false, reason: chrome.runtime.lastError.message } : response);
    });
  });
}

// Fallback for when a queued person is no longer rendered in the
// suggestions list — confirmed live (2026-08-31) that this hits on the very
// first real Send Queue attempt, not a rare edge case. Their profile URL
// always works regardless of list state, so this opens it in a background
// tab, waits for it to finish loading, clicks Add Friend there using the
// separately-verified profile-page selector, then cleans up the tab either
// way.
function sendViaProfilePage(person, testMode) {
  return new Promise((resolve) => {
    chrome.tabs.create({ url: person.profileUrl, active: false }, (tab) => {
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
        // "complete" fires on the network load; give the SPA content itself
        // a moment more to actually render before looking for the button.
        setTimeout(() => {
          chrome.tabs.sendMessage(tabId, { type: 'CLICK_PROFILE_ADD_FRIEND', testMode }, (response) => {
            const result = chrome.runtime.lastError
              ? { sent: false, reason: chrome.runtime.lastError.message }
              : response;
            // Real concern raised live (2026-09-02), per Greg: the click and
            // the tab close were happening in the same tick — a real person
            // would linger a moment after clicking, not vanish instantly.
            // Clear the 15s give-up timer now that a real result exists (so
            // it can't fire a stale "timed out" finish() during this pause),
            // then wait a randomized ~1.5-2.5s before actually closing.
            clearTimeout(timeoutHandle);
            const closeDelayMs = 1500 + Math.random() * 1000;
            setTimeout(() => finish(result), closeDelayMs);
          });
        }, 1500);
      }
      chrome.tabs.onUpdated.addListener(onUpdated);

      timeoutHandle = setTimeout(() => finish({ sent: false, reason: 'timed out loading their profile page' }), 15000);
    });
  });
}

// Same safe-rendering discipline as review.js: person.name is scraped
// Facebook text, effectively untrusted — every dynamic value goes through
// textContent/property assignment, never interpolated into innerHTML.
function renderCard(person, remaining) {
  const card = document.createElement('div');
  card.className = 'card';
  card.dataset.personId = person.id; // lets Process All track "already attempted this run"
  card.innerHTML = `
    <div>
      <a class="name-link" target="_blank" rel="noopener"></a>
      <div class="card-meta"></div>
      <div class="card-status"></div>
    </div>
    <button class="sendBtn">Send Friend Request</button>
  `;

  const nameLink = card.querySelector('.name-link');
  nameLink.href = person.profileUrl ?? '#';
  nameLink.textContent = person.name ?? '(unknown name)';

  const s = person.screening ?? {};
  card.querySelector('.card-meta').textContent = `tier: ${s.tier ?? 'unknown'} · confidence: ${s.confidence ?? '?'}%`;

  const statusEl = card.querySelector('.card-status');
  const sendBtn = card.querySelector('.sendBtn');

  if (remaining <= 0) {
    sendBtn.disabled = true;
  }

  // Pulled out of the click handler so Process All (below) can await this
  // exact same logic directly instead of simulating a click and guessing
  // when it's finished — one implementation, two callers, no duplication.
  async function sendThisOne() {
    sendBtn.disabled = true;
    statusEl.textContent = 'Sending…';

    const settings = await getSettings();
    const tab = await findSuggestionsTab();
    let result = tab
      ? await sendMessageToTab(tab.id, {
          type: 'SEND_FRIEND_REQUEST',
          href: person.profileUrl,
          testMode: settings.testMode,
        })
      : { sent: false, reason: 'no suggestions tab open' };

    // Both "no suggestions tab at all" and "tab open but this person isn't
    // currently rendered in it" land on the same remedy: their profile page
    // works regardless of list/tab state. Falling back automatically here
    // (rather than stopping to ask, like the old "open one" link did) is
    // what makes Process All able to run unattended without a suggestions
    // tab open at all.
    if (!result.sent && (result.reason === 'candidate not found in list' || result.reason === 'no suggestions tab open')) {
      statusEl.textContent = tab
        ? 'Not currently visible in the suggestions list — trying their profile page directly…'
        : 'No suggestions tab open — trying their profile page directly…';
      result = await sendViaProfilePage(person, settings.testMode);
    }

    await log('info', 'Send Queue: friend request attempt', { name: person.name, result });

    if (result.sent) {
      await markRequested(person.id);
      statusEl.textContent = 'Sent.';
      card.remove();
      // Real gap found live (2026-09-01): this only ever updated the summary
      // text/banner — nothing stopped a person from clicking several other
      // cards' Send buttons in the same sitting and sailing past the daily
      // cap before ever seeing it. Disabling every remaining card here, in
      // the one shared sendThisOne implementation, closes it for both the
      // manual button AND Process All (which calls this same function),
      // rather than fixing only one of the two call sites.
      const remaining = await refreshSummary();
      if (remaining <= 0) {
        for (const otherCard of cardsEl.children) {
          const btn = otherCard.querySelector('.sendBtn');
          if (btn) btn.disabled = true;
        }
      }
    } else {
      // Not found in the currently-loaded list is the expected failure mode
      // if they were queued a while ago (Facebook's virtualized list moves
      // on) — give a direct fallback instead of a dead end.
      statusEl.innerHTML = '';
      statusEl.append(`Not sent: ${result.reason ?? 'unknown reason'}. `);
      const fallback = document.createElement('a');
      fallback.className = 'fallback-link';
      fallback.href = person.profileUrl ?? '#';
      fallback.target = '_blank';
      fallback.rel = 'noopener';
      fallback.textContent = 'Open their profile to send it manually';
      statusEl.append(fallback);
      sendBtn.disabled = false;
    }
    return result;
  }

  sendBtn.addEventListener('click', sendThisOne);
  card._sendThisOne = sendThisOne;

  return card;
}

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

async function refreshSummary() {
  const settings = await getSettings();
  const todayKey = DAY_KEYS[new Date().getDay()];
  const maxPerDay = settings.caps?.maxRequestsPerDayByDay?.[todayKey] ?? 0;
  const sentToday = await countRequestedToday();
  const remaining = Math.max(0, maxPerDay - sentToday);

  summaryEl.textContent = `${sentToday} of ${maxPerDay} friend requests sent today.`;
  if (remaining <= 0) {
    limitBannerEl.textContent = "Today's send limit is reached — come back tomorrow, or raise it in Settings.";
    limitBannerEl.style.display = 'block';
  } else {
    limitBannerEl.style.display = 'none';
  }
  return remaining;
}

async function loadQueue() {
  summaryEl.textContent = 'Loading…';
  cardsEl.innerHTML = '';
  const remaining = await refreshSummary();
  const people = await listByState('queued');
  emptyEl.style.display = people.length ? 'none' : 'block';
  for (const person of people) {
    cardsEl.appendChild(renderCard(person, remaining));
  }
}

refreshBtn.addEventListener('click', loadQueue);

resetBtn.addEventListener('click', async () => {
  const count = cardsEl.children.length;
  if (!count) return;
  const confirmed = confirm(
    `Delete all ${count} people currently in the Send Queue? This removes them from the ledger ` +
      `entirely (not just their state) — if any reappear in a future scan, they'll be freshly ` +
      `re-screened. This cannot be undone unless you've already exported a backup in Settings.`
  );
  if (!confirmed) return;
  const deleted = await clearByState('queued');
  await log('info', 'Send Queue reset', { deleted });
  await loadQueue();
});

const processAllBtn = document.getElementById('processAllBtn');
const stopProcessingBtn = document.getElementById('stopProcessingBtn');
const processAllStatus = document.getElementById('processAllStatus');
let stopRequested = false;

// Checks stopRequested every 500ms rather than one long setTimeout, so
// clicking Stop during the 8-18s wait takes effect within ~0.5s instead of
// up to 18s late. An in-progress send itself still always finishes —
// only the wait between sends is interruptible.
async function interruptibleDelay(ms) {
  const stepMs = 500;
  let elapsed = 0;
  while (elapsed < ms && !stopRequested) {
    const chunk = Math.min(stepMs, ms - elapsed);
    await new Promise((resolve) => setTimeout(resolve, chunk));
    elapsed += chunk;
  }
}

// Per Greg's design (2026-09-01): a single click sends up to today's limit
// automatically, ~8-18s apart, instead of clicking each Send button one at
// a time. This is a real step up from pure assisted-click toward the kind
// of unattended sequence the (currently unused) autoSend setting was
// conceptually meant to represent — worth being direct about that rather
// than treating it as a trivial UI convenience. Reuses sendThisOne exactly
// (no duplicated send logic), skips past a failed send instead of retrying
// it forever (tracked via attemptedIds, verified in a live browser JS
// engine before wiring in), and can be interrupted mid-run via Stop.
processAllBtn.addEventListener('click', async () => {
  const startingCount = cardsEl.children.length;
  const confirmed = confirm(
    `Send up to today's remaining limit automatically, ~8-18 seconds apart, with no confirmation ` +
      `per person, until the limit is reached or the queue (${startingCount} people) runs out? ` +
      `You can stop it mid-run.`
  );
  if (!confirmed) return;

  stopRequested = false;
  processAllBtn.style.display = 'none';
  stopProcessingBtn.style.display = 'inline-block';
  const attemptedIds = new Set();

  let remaining = await refreshSummary();
  while (remaining > 0 && !stopRequested) {
    const cards = [...cardsEl.children];
    const nextCard = cards.find((c) => !attemptedIds.has(c.dataset.personId));
    if (!nextCard) break; // nothing left this run hasn't already tried

    attemptedIds.add(nextCard.dataset.personId);
    processAllStatus.textContent = `Sending ${attemptedIds.size} of up to ${remaining} remaining…`;
    await nextCard._sendThisOne();
    remaining = await refreshSummary();

    const cardsAfter = [...cardsEl.children];
    const anyLeftToTry = cardsAfter.some((c) => !attemptedIds.has(c.dataset.personId));
    if (remaining > 0 && anyLeftToTry && !stopRequested) {
      const delayMs = (8 + Math.random() * 10) * 1000;
      processAllStatus.textContent = `Waiting ${Math.round(delayMs / 1000)}s before the next one…`;
      await interruptibleDelay(delayMs);
    }
  }

  processAllBtn.style.display = 'inline-block';
  stopProcessingBtn.style.display = 'none';
  processAllStatus.textContent = stopRequested
    ? `Stopped after attempting ${attemptedIds.size}.`
    : `Done — attempted ${attemptedIds.size} this run.`;
  await log('info', 'Send Queue: Process All finished', { attempted: attemptedIds.size, stopped: stopRequested });
});

stopProcessingBtn.addEventListener('click', () => {
  stopRequested = true;
  processAllStatus.textContent = 'Stopping after the current send finishes…';
});

loadQueue();
