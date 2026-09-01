import { getDmCandidates } from '../lib/ledger.js';
import { getSettings } from '../lib/store.js';
import { renderTemplate } from '../lib/template.js';

const summaryEl = document.getElementById('summary');
const emptyEl = document.getElementById('empty');
const cardsEl = document.getElementById('cards');
const refreshBtn = document.getElementById('refreshBtn');

// Per Greg's design (2026-09-01): the greeting DM is NOT AI-drafted — it's
// the fixed "Introductory message template" from Settings with {firstName}
// substituted in, same as the existing birthday template. Sending itself
// (clicking Message, typing, and actually sending) isn't wired up yet — it
// needs the Messenger composer's real DOM verified live first, same
// discipline as every other Facebook interaction this session. Until then,
// this page is read-only: it shows exactly who qualifies and exactly what
// they'd be sent, with a direct link to send it manually.
function daysSince(timestampMs, now) {
  return Math.floor((now - timestampMs) / (24 * 60 * 60 * 1000));
}

function renderCard(person, template, now) {
  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = `
    <div class="card-top">
      <div>
        <a class="name-link" target="_blank" rel="noopener"></a>
        <div class="card-meta"></div>
      </div>
    </div>
    <div class="card-preview"></div>
    <a class="fallback-link" target="_blank" rel="noopener">Open their profile to message them</a>
  `;

  const nameLink = card.querySelector('.name-link');
  nameLink.href = person.profileUrl ?? '#';
  nameLink.textContent = person.name ?? '(unknown name)';

  card.querySelector('.card-meta').textContent = `accepted ${daysSince(person.acceptedAt, now)} days ago`;
  card.querySelector('.card-preview').textContent = renderTemplate(template, person);

  const openLink = card.querySelector('.fallback-link');
  openLink.href = person.profileUrl ?? '#';

  return card;
}

async function loadQueue() {
  summaryEl.textContent = 'Loading…';
  cardsEl.innerHTML = '';
  const settings = await getSettings();
  const people = await getDmCandidates(settings.dmDelayDays);
  const now = Date.now();

  summaryEl.textContent = `${people.length} accepted friend${people.length === 1 ? '' : 's'} eligible for the greeting DM (accepted more than ${settings.dmDelayDays} day${settings.dmDelayDays === 1 ? '' : 's'} ago, never messaged).`;
  emptyEl.style.display = people.length ? 'none' : 'block';
  for (const person of people) {
    cardsEl.appendChild(renderCard(person, settings.messageTemplates?.intro ?? '', now));
  }
}

refreshBtn.addEventListener('click', loadQueue);

loadQueue();
