import { listByState, markRequested, countRequestedToday } from '../lib/ledger.js';
import { getSettings } from '../lib/store.js';
import { log } from '../lib/log.js';

const summaryEl = document.getElementById('summary');
const limitBannerEl = document.getElementById('limitBanner');
const emptyEl = document.getElementById('empty');
const cardsEl = document.getElementById('cards');
const refreshBtn = document.getElementById('refreshBtn');

// Assisted click by design (Greg's decision, 2026-08-31): this page never
// sends anything on its own — every request needs an explicit click here.
// Because of that, there's no need for the randomized inter-click pacing
// the automated discovery batch uses; a human clicking one at a time from
// this list already paces itself at human speed. The real safety control
// needed here is the daily cap, not simulated delays.
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

// Same safe-rendering discipline as review.js: person.name is scraped
// Facebook text, effectively untrusted — every dynamic value goes through
// textContent/property assignment, never interpolated into innerHTML.
function renderCard(person, remaining) {
  const card = document.createElement('div');
  card.className = 'card';
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

  sendBtn.addEventListener('click', async () => {
    sendBtn.disabled = true;
    statusEl.textContent = 'Sending…';

    const tab = await findSuggestionsTab();
    if (!tab) {
      statusEl.textContent = 'No facebook.com/friends/suggestions tab open — open one and try again.';
      sendBtn.disabled = false;
      return;
    }

    const settings = await getSettings();
    const result = await sendMessageToTab(tab.id, {
      type: 'SEND_FRIEND_REQUEST',
      href: person.profileUrl,
      testMode: settings.testMode,
    });
    await log('info', 'Send Queue: friend request attempt', { name: person.name, result });

    if (result.sent) {
      await markRequested(person.id);
      statusEl.textContent = 'Sent.';
      card.remove();
      await refreshSummary();
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
  });

  return card;
}

async function refreshSummary() {
  const settings = await getSettings();
  const maxPerDay = settings.caps?.maxRequestsPerDay ?? 0;
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

loadQueue();
