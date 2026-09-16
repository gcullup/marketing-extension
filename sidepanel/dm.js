import { getDmCandidates, markDmSent, countDmSentToday } from '../lib/ledger.js';
import { getSettings } from '../lib/store.js';
import { renderTemplate } from '../lib/template.js';
import { log } from '../lib/log.js';

const summaryEl = document.getElementById('summary');
const limitBannerEl = document.getElementById('limitBanner');
const emptyEl = document.getElementById('empty');
const cardsEl = document.getElementById('cards');
const refreshBtn = document.getElementById('refreshBtn');

// Per Greg's design (2026-09-01, revised 2026-09-16): the greeting DM is NOT
// AI-drafted — it's the fixed "Introductory message template" from Settings
// with {firstName} substituted in. Assisted click throughout, matching D6
// (Send Queue's original design) and, as of 2026-09-16, matching 3A/3C/3D's
// "type and stop" shape too: the extension types the message and stops
// there, Greg reviews it and presses Enter himself to actually send, then
// confirms via "Mark as Sent" once he has (see renderCard below) — the
// ledger is only updated on that explicit confirmation, not automatically.
function daysSince(timestampMs, now) {
  return Math.floor((now - timestampMs) / (24 * 60 * 60 * 1000));
}

// Opens the person's real profile, sends DRAFT_DM (which clicks Message,
// waits for the chat popup, and types the rendered text in), then either
// leaves the tab open for Greg to review/send himself, or cleans it up if
// nothing useful ever made it to screen. Mostly mirrors send.js's
// sendViaProfilePage, with two deliberate differences: this tab is opened
// ACTIVE (foreground), not background, and — unlike every other
// background-tab flow in this project — it usually does NOT get closed
// automatically at the end (see finishLeaveOpen below).
//
// Real bug found live (2026-09-01), per Greg: with the tab in the
// background (as every other profile-tab action in this project safely is —
// Add Friend, Cancel Request, checking friend status), typing silently
// failed unless Greg manually switched to the tab himself. Root cause:
// plain element.click() (what every other background-tab action uses)
// doesn't care whether the tab is actually focused, but
// document.execCommand('insertText', ...) does — Chrome only applies it for
// real when the tab genuinely has focus, not just "is the active tab of its
// own position in a background window." Bringing the tab to the foreground
// for the duration of the type is the fix.
//
// Real, more serious risk found live (2026-09-16), per Greg: this used to
// also simulate pressing Enter to actually send, right after typing. But if
// focus shifted to a DIFFERENT chat popup in the gap between typing and that
// simulated Enter (e.g. a new incoming-message notification stealing focus),
// the send could land in the wrong conversation entirely — sending the
// greeting to the wrong person. Removed the automatic send outright rather
// than trying to detect/guard against a focus shift after the fact. Since
// Greg now needs to actually look at the typed message and press Enter
// himself, the tab can no longer be closed the instant a response comes
// back either (the old behavior) — it stays open and in the foreground
// whenever there's something on screen worth him seeing.
function sendGreetingDm(person, text) {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, ([previousTab]) => {
      chrome.tabs.create({ url: person.profileUrl, active: true }, (tab) => {
        const tabId = tab.id;
        let settled = false;
        let timeoutHandle;

        function cleanup() {
          chrome.tabs.onUpdated.removeListener(onUpdated);
          clearTimeout(timeoutHandle);
        }

        // Used when nothing useful ever reached the screen (the content
        // script was unreachable, or the whole round trip timed out) —
        // nothing for Greg to review, so close the tab and switch back to
        // whatever he was doing, same as this project's other background-tab
        // flows.
        function finishAndClose(result) {
          if (settled) return;
          settled = true;
          cleanup();
          chrome.tabs.remove(tabId).catch(() => {});
          if (previousTab) chrome.tabs.update(previousTab.id, { active: true }).catch(() => {});
          resolve(result);
        }

        // Used whenever a real response came back — the chat popup is
        // showing something worth Greg looking at, whether typing fully
        // succeeded or only got partway. Leaves the tab open and in the
        // foreground rather than closing out from under him.
        function finishLeaveOpen(result) {
          if (settled) return;
          settled = true;
          cleanup();
          resolve(result);
        }

        function onUpdated(updatedTabId, changeInfo) {
          if (updatedTabId !== tabId || changeInfo.status !== 'complete') return;
          setTimeout(() => {
            chrome.tabs.sendMessage(tabId, { type: 'DRAFT_DM', text }, (response) => {
              if (chrome.runtime.lastError) {
                finishAndClose({ typed: false, reason: chrome.runtime.lastError.message });
              } else {
                finishLeaveOpen(response);
              }
            });
          }, 1500);
        }
        chrome.tabs.onUpdated.addListener(onUpdated);

        // Real bug found live (2026-09-01): this single deadline covers the
        // WHOLE round trip (page load, opening the composer, and the actual
        // typing, which happens at a human-like pace rather than instantly),
        // not just page load despite the old fixed 15s value and message
        // implying otherwise. Scaled to the actual message length, with a
        // generous per-character allowance (well above the real ~35-400ms/
        // char pace) plus a fixed buffer for page load and opening the
        // composer.
        const timeoutMs = 20000 + text.length * 200;
        timeoutHandle = setTimeout(
          () => finishAndClose({ typed: false, reason: 'timed out — no response from their profile page within the expected time' }),
          timeoutMs
        );
      });
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
      <button class="sendBtn">Open &amp; Type Message</button>
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

  // Records that Greg actually sent this himself (via the composer this
  // page opened for him, or entirely by hand through the fallback link) —
  // added 2026-09-16, per Greg: since sending is no longer automatic, there
  // was no way to clear a card off the queue after handling it manually.
  // Shown regardless of whether typing succeeded or failed partway, since
  // either way Greg is the one who knows whether the message actually went
  // out, not the extension.
  function addMarkSentButton() {
    const markSentBtn = document.createElement('button');
    markSentBtn.className = 'markSentBtn';
    markSentBtn.textContent = 'Mark as Sent';
    markSentBtn.addEventListener('click', async () => {
      markSentBtn.disabled = true;
      await markDmSent(person.id, message);
      await log('info', 'DM Queue: greeting DM marked sent (manual confirmation)', { name: person.name });
      card.remove();
      // Same fix applied to Send Queue (2026-09-01): disable every other
      // still-eligible card the moment the daily cap is actually hit, rather
      // than only reflecting it in the summary text — otherwise confirming
      // several cards in the same sitting could cross the cap before it was
      // ever visibly enforced.
      const remaining = await refreshSummary();
      if (remaining <= 0) {
        for (const otherCard of cardsEl.children) {
          const btn = otherCard.querySelector('.sendBtn');
          if (btn) btn.disabled = true;
        }
      }
    });
    statusEl.append(' ', markSentBtn);
  }

  sendBtn.addEventListener('click', async () => {
    sendBtn.disabled = true;
    statusEl.textContent = 'Opening their profile and typing…';

    const result = await sendGreetingDm(person, message);
    await log('info', 'DM Queue: greeting DM draft attempt', { name: person.name, result });

    statusEl.innerHTML = '';
    if (result.typed) {
      statusEl.append('Typed into the chat — review it, then press Enter yourself to send.');
    } else {
      statusEl.append(`Not typed: ${result.reason ?? 'unknown reason'}. `);
      const fallback = document.createElement('a');
      fallback.className = 'fallback-link';
      fallback.href = person.profileUrl ?? '#';
      fallback.target = '_blank';
      fallback.rel = 'noopener';
      fallback.textContent = 'Open their profile to message them manually';
      statusEl.append(fallback);
    }
    addMarkSentButton();
    sendBtn.disabled = false; // allow retrying the open/type step if needed
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
