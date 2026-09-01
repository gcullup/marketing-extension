import { getDmCandidates, markDmSent, countDmSentToday } from '../lib/ledger.js';
import { getSettings } from '../lib/store.js';
import { renderTemplate } from '../lib/template.js';
import { log } from '../lib/log.js';

const summaryEl = document.getElementById('summary');
const limitBannerEl = document.getElementById('limitBanner');
const emptyEl = document.getElementById('empty');
const cardsEl = document.getElementById('cards');
const refreshBtn = document.getElementById('refreshBtn');

// Per Greg's design (2026-09-01): the greeting DM is NOT AI-drafted — it's
// the fixed "Introductory message template" from Settings with {firstName}
// substituted in. Once sent, Greg takes over the conversation directly, so
// there's no draft-review step; this page just needs to send exactly the
// text it previews. Assisted click, matching D6 (Send Queue's original
// design), since messaging is the more heavily policed surface — no "Process
// All" equivalent here unless Greg asks for one later.
function daysSince(timestampMs, now) {
  return Math.floor((now - timestampMs) / (24 * 60 * 60 * 1000));
}

// Opens the person's real profile in a background tab, sends SEND_DM (which
// clicks Message, waits for the chat popup, types the rendered text, and —
// unless Test Mode — presses Enter to actually send), then cleans up the
// tab either way. Mirrors send.js's sendViaProfilePage pattern exactly,
// since this is the same shape of on-demand per-person action.
function sendGreetingDm(person, text, testMode) {
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
        setTimeout(() => {
          chrome.tabs.sendMessage(tabId, { type: 'SEND_DM', text, testMode }, (response) => {
            finish(chrome.runtime.lastError ? { sent: false, reason: chrome.runtime.lastError.message } : response);
          });
        }, 1500);
      }
      chrome.tabs.onUpdated.addListener(onUpdated);

      // Real bug found live (2026-09-01): this single deadline covers the
      // WHOLE round trip (page load, opening the composer, and — since
      // sendComposedMessage now types character-by-character with a
      // human-like pace rather than instantly — the actual typing itself),
      // not just page load despite the old fixed 15s value and message
      // implying otherwise. That fixed 15s was sized for the original
      // instant-paste flow; it started firing mid-typing and force-closing
      // the tab the moment real pacing was added, misreported as "timed out
      // loading their profile page" when the page had loaded fine. Scaled to
      // the actual message length now, with a generous per-character
      // allowance (well above the real ~35-400ms/char pace) plus a fixed
      // buffer for page load, opening the composer, and the pre/post-send
      // pauses in sendComposedMessage.
      const timeoutMs = 20000 + text.length * 200;
      timeoutHandle = setTimeout(
        () => finish({ sent: false, reason: 'timed out — no response from their profile page within the expected time' }),
        timeoutMs
      );
    });
  });
}

function renderCard(person, template, now) {
  const card = document.createElement('div');
  card.className = 'card';
  const message = renderTemplate(template, person);

  card.innerHTML = `
    <div class="card-top">
      <div>
        <a class="name-link" target="_blank" rel="noopener"></a>
        <div class="card-meta"></div>
      </div>
      <button class="sendBtn">Send Message</button>
    </div>
    <div class="card-preview"></div>
    <div class="card-status"></div>
  `;

  const nameLink = card.querySelector('.name-link');
  nameLink.href = person.profileUrl ?? '#';
  nameLink.textContent = person.name ?? '(unknown name)';

  card.querySelector('.card-meta').textContent = `accepted ${daysSince(person.acceptedAt, now)} days ago`;
  card.querySelector('.card-preview').textContent = message;

  const sendBtn = card.querySelector('.sendBtn');
  const statusEl = card.querySelector('.card-status');

  sendBtn.addEventListener('click', async () => {
    sendBtn.disabled = true;
    statusEl.textContent = 'Opening their profile and messaging…';

    const settings = await getSettings();
    const result = await sendGreetingDm(person, message, settings.testMode);
    await log('info', 'DM Queue: greeting DM attempt', { name: person.name, result });

    if (result.sent) {
      await markDmSent(person.id, message);
      statusEl.textContent = 'Sent.';
      card.remove();
      await refreshSummary();
    } else if (result.reason?.startsWith('test mode')) {
      statusEl.textContent = `Test Mode: ${result.reason}`;
      sendBtn.disabled = false;
    } else {
      statusEl.innerHTML = '';
      statusEl.append(`Not sent: ${result.reason ?? 'unknown reason'}. `);
      const fallback = document.createElement('a');
      fallback.className = 'fallback-link';
      fallback.href = person.profileUrl ?? '#';
      fallback.target = '_blank';
      fallback.rel = 'noopener';
      fallback.textContent = 'Open their profile to message them manually';
      statusEl.append(fallback);
      sendBtn.disabled = false;
    }
  });

  return card;
}

async function refreshSummary() {
  const settings = await getSettings();
  const maxPerDay = settings.caps?.maxMessagesPerDay ?? 0;
  const sentToday = await countDmSentToday();
  const remaining = Math.max(0, maxPerDay - sentToday);

  const eligible = (await getDmCandidates(settings.dmDelayDays)).length;
  summaryEl.textContent =
    `${eligible} accepted friend${eligible === 1 ? '' : 's'} eligible (accepted more than ` +
    `${settings.dmDelayDays} day${settings.dmDelayDays === 1 ? '' : 's'} ago, never messaged). ` +
    `${sentToday} of ${maxPerDay} messages sent today.`;

  if (remaining <= 0) {
    limitBannerEl.textContent = "Today's message limit is reached — come back tomorrow, or raise it in Settings.";
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
  const settings = await getSettings();
  const people = await getDmCandidates(settings.dmDelayDays);
  const now = Date.now();

  emptyEl.style.display = people.length ? 'none' : 'block';
  for (const person of people) {
    const card = renderCard(person, settings.messageTemplates?.intro ?? '', now);
    if (remaining <= 0) card.querySelector('.sendBtn').disabled = true;
    cardsEl.appendChild(card);
  }
}

refreshBtn.addEventListener('click', loadQueue);

loadQueue();
