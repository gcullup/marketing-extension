import { listByState, approvePerson, skipPerson, clearByState } from '../lib/ledger.js';
import { getSettings } from '../lib/store.js';
import { log } from '../lib/log.js';

const countEl = document.getElementById('count');
const emptyEl = document.getElementById('empty');
const cardsEl = document.getElementById('cards');
const refreshBtn = document.getElementById('refreshBtn');
const resetBtn = document.getElementById('resetBtn');

function confidenceClass(confidence) {
  if (confidence >= 70) return 'high';
  if (confidence >= 40) return 'mid';
  return '';
}

// Best-effort only: dismissing from Facebook's suggestions feed requires
// that person to actually be rendered on a live facebook.com/friends/
// suggestions tab right now, which won't always be true when reviewing the
// queue later (they may have scrolled out of the virtualized list, or no
// such tab may even be open). A failure here is not an error — the ledger
// state change (the part that actually matters) always succeeds regardless.
async function tryRemoveFromSuggestions(profileUrl) {
  try {
    const tabs = await chrome.tabs.query({ url: 'https://www.facebook.com/friends/suggestions*' });
    if (!tabs.length) return { attempted: false };
    const settings = await getSettings();
    const result = await new Promise((resolve) => {
      chrome.tabs.sendMessage(
        tabs[0].id,
        { type: 'REMOVE_CANDIDATE', href: profileUrl, testMode: settings.testMode },
        (response) => {
          resolve(chrome.runtime.lastError ? { removed: false, reason: chrome.runtime.lastError.message } : response);
        }
      );
    });
    return { attempted: true, ...result };
  } catch (err) {
    return { attempted: false, error: err.message };
  }
}

// Every dynamic value below is set via textContent/property assignment,
// never interpolated into innerHTML — person.name is scraped Facebook text
// and s.reasoning/s.signals are AI-generated, both effectively untrusted
// input. This page has ledger, settings, and Claude-key access, so a
// maliciously-crafted profile name (or AI output echoing something
// injected) landing in innerHTML would be a real XSS vector here, not a
// hypothetical one.
function renderCard(person) {
  const s = person.screening ?? {};
  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = `
    <div class="card-header">
      <a class="name-link" target="_blank" rel="noopener"></a>
      <span class="confidence"></span>
    </div>
    <div class="meta"></div>
    <div class="reasoning"></div>
    <ul class="signals"></ul>
    <div class="actions">
      <button class="approveBtn">Approve → Queue</button>
      <button class="skipBtn">Skip → Reject</button>
    </div>
    <div class="card-status"></div>
  `;

  const nameLink = card.querySelector('.name-link');
  nameLink.href = person.profileUrl ?? '#';
  nameLink.textContent = person.name ?? '(unknown name)';

  const confidenceEl = card.querySelector('.confidence');
  confidenceEl.textContent = `${s.confidence ?? '?'}% confidence`;
  const cls = confidenceClass(s.confidence ?? 0);
  if (cls) confidenceEl.classList.add(cls);

  card.querySelector('.meta').textContent =
    `tier: ${s.tier ?? 'unknown'} · screened ${s.screenedAt ? new Date(s.screenedAt).toLocaleString() : 'unknown time'}`;

  card.querySelector('.reasoning').textContent = s.reasoning ?? '(no reasoning recorded)';

  const signalsEl = card.querySelector('.signals');
  if (s.signals?.length) {
    for (const sig of s.signals) {
      const li = document.createElement('li');
      li.textContent = sig;
      signalsEl.appendChild(li);
    }
  } else {
    signalsEl.remove();
  }

  const statusEl = card.querySelector('.card-status');
  const approveBtn = card.querySelector('.approveBtn');
  const skipBtn = card.querySelector('.skipBtn');

  approveBtn.addEventListener('click', async () => {
    approveBtn.disabled = true;
    skipBtn.disabled = true;
    await approvePerson(person.id);
    await log('info', 'Approved from review queue', { name: person.name });
    card.remove();
    updateCount();
  });

  skipBtn.addEventListener('click', async () => {
    approveBtn.disabled = true;
    skipBtn.disabled = true;
    statusEl.textContent = 'Skipping…';
    await skipPerson(person.id);
    const removeResult = await tryRemoveFromSuggestions(person.profileUrl);
    await log('info', 'Skipped from review queue', { name: person.name, removeResult });

    // Show the actual outcome here instead of making it something only
    // findable by digging through Settings' log viewer — confirmed live
    // (2026-08-31) that this was real friction, not a hypothetical.
    statusEl.textContent = removeResult.removed
      ? 'Skipped — also removed from the suggestions list.'
      : `Skipped (rejected in the ledger). Suggestions-list cleanup didn't happen: ${
          removeResult.reason ?? (removeResult.attempted ? 'unknown reason' : 'no suggestions tab open')
        }.`;
    setTimeout(() => {
      card.remove();
      updateCount();
    }, 2200);
  });

  return card;
}

function updateCount() {
  const remaining = cardsEl.children.length;
  countEl.textContent = remaining
    ? `${remaining} waiting for review`
    : '';
  emptyEl.style.display = remaining ? 'none' : 'block';
}

async function loadQueue() {
  countEl.textContent = 'Loading…';
  cardsEl.innerHTML = '';
  const people = await listByState('needs_review');
  // Highest confidence first — review the strongest candidates before the
  // marginal ones, rather than a FIFO order that treats them all as equal.
  people.sort((a, b) => (b.screening?.confidence ?? 0) - (a.screening?.confidence ?? 0));
  for (const person of people) {
    cardsEl.appendChild(renderCard(person));
  }
  updateCount();
}

refreshBtn.addEventListener('click', loadQueue);

resetBtn.addEventListener('click', async () => {
  const count = cardsEl.children.length;
  if (!count) return;
  const confirmed = confirm(
    `Delete all ${count} people currently in the Review Queue? This removes them from the ledger ` +
      `entirely (not just their state) — if any reappear in a future scan, they'll be freshly ` +
      `re-screened. This cannot be undone unless you've already exported a backup in Settings.`
  );
  if (!confirmed) return;
  const deleted = await clearByState('needs_review');
  await log('info', 'Review Queue reset', { deleted });
  await loadQueue();
});

loadQueue();
