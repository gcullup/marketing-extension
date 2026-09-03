import { resolveContentPlan, generateContent, CONTENT_ANGLES } from '../lib/content.js';
import {
  getContentForDate,
  saveDraft,
  approveContent,
  getApprovedContentSince,
  dateKey,
  CONTENT_STATES,
} from '../lib/contentLedger.js';
import { getSettings } from '../lib/store.js';
import { log } from '../lib/log.js';
import { displayLength } from '../lib/facebookFormat.js';

const dayInfoEl = document.getElementById('dayInfo');
const contentTypeSelectEl = document.getElementById('contentTypeSelect');
const mediaNoteEl = document.getElementById('mediaNote');
const noPlanEl = document.getElementById('noPlan');
const editorEl = document.getElementById('editor');
const draftTextEl = document.getElementById('draftText');
const modifierInputEl = document.getElementById('modifierInput');
const angleSelectEl = document.getElementById('angleSelect');
const charCountEl = document.getElementById('charCount');
const generateBtn = document.getElementById('generateBtn');
const copyBtn = document.getElementById('copyBtn');
const approveBtn = document.getElementById('approveBtn');
const statusEl = document.getElementById('status');
const stateBadgeEl = document.getElementById('stateBadge');
const postPersonalBtn = document.getElementById('postPersonalBtn');
const postStatusEl = document.getElementById('postStatus');
const postBusinessBtn = document.getElementById('postBusinessBtn');
const postBusinessStatusEl = document.getElementById('postBusinessStatus');

const today = new Date();
let currentPlan = null;
let currentDayKey = null;

const MEDIA_NOTES = {
  photo: 'Remember to attach a photo to this post — the extension only drafts the text.',
  video: 'Remember to attach a video with a song overlay to this post — the extension only drafts the text.',
};

function updateCharCount() {
  // Real gap found live (2026-09-01): once bold-Unicode formatting was
  // added, plain `.value.length` counts each bold character as 2 (they're
  // surrogate pairs, outside the Basic Multilingual Plane) -- roughly
  // doubling the apparent count for text with much bold in it. Counting by
  // code point instead matches how a person (and hopefully Facebook) would
  // actually count characters.
  const len = displayLength(draftTextEl.value);
  if (currentPlan?.maxChars) {
    charCountEl.textContent = `${len} / ${currentPlan.maxChars} characters`;
    charCountEl.classList.toggle('over', len > currentPlan.maxChars);
  } else {
    charCountEl.textContent = `${len} characters`;
    charCountEl.classList.remove('over');
  }
}

function renderBadge(state) {
  if (!state) {
    stateBadgeEl.textContent = '';
    stateBadgeEl.className = '';
    return;
  }
  stateBadgeEl.textContent = state === CONTENT_STATES.APPROVED ? 'Approved' : 'Draft';
  stateBadgeEl.className = state === CONTENT_STATES.APPROVED ? 'approved' : 'draft';
}

// Re-resolves and re-renders the plan display (day label, media note,
// editor visibility) from whatever's currently selected in the override
// dropdown plus Settings' Content Calendar -- shared by init() and the
// dropdown's own change handler so there's one place that decides "what
// applies right now," matching lib/content.js's resolveContentPlan being
// the one place that decides it for generation too.
async function refreshPlanDisplay() {
  const overrideType = contentTypeSelectEl.value || null;
  const settings = await getSettings();
  const { dayKey, plan, isOverride } = resolveContentPlan(today, overrideType, settings.contentCalendar);
  currentPlan = plan;
  currentDayKey = dayKey;

  mediaNoteEl.style.display = 'none';
  mediaNoteEl.textContent = '';

  if (!plan) {
    dayInfoEl.textContent = `${today.toDateString()} (${dayKey}) — no plan for this day. Pick a content type above to override.`;
    noPlanEl.style.display = 'block';
    editorEl.style.display = 'none';
    return;
  }

  dayInfoEl.textContent = `${today.toDateString()} — ${plan.label}${isOverride ? ' (overridden)' : ''}`;
  if (plan.needsMedia) {
    mediaNoteEl.textContent = MEDIA_NOTES[plan.needsMedia] ?? '';
    mediaNoteEl.style.display = 'block';
  }
  noPlanEl.style.display = 'none';
  editorEl.style.display = 'block';
  updateCharCount();
}

async function init() {
  const existing = await getContentForDate(today);
  if (existing) {
    contentTypeSelectEl.value = existing.overrideType ?? '';
    draftTextEl.value = existing.text;
    modifierInputEl.value = existing.modifier ?? '';
    angleSelectEl.value = existing.angleChoice ?? '';
    renderBadge(existing.state);
  }
  await refreshPlanDisplay();
}

contentTypeSelectEl.addEventListener('change', refreshPlanDisplay);
draftTextEl.addEventListener('input', updateCharCount);

// Per Greg's request (2026-09-01): a one-click way to get the draft onto
// the clipboard instead of manually selecting all the text in the box.
copyBtn.addEventListener('click', async () => {
  if (!draftTextEl.value.trim()) {
    statusEl.textContent = 'Nothing to copy yet — generate a draft first.';
    return;
  }
  try {
    await navigator.clipboard.writeText(draftTextEl.value);
    statusEl.textContent = 'Copied to clipboard.';
  } catch (err) {
    statusEl.textContent = `Couldn't copy: ${err.message}`;
  }
});

generateBtn.addEventListener('click', async () => {
  generateBtn.disabled = true;
  statusEl.textContent = 'Drafting with Claude…';
  try {
    const settings = await getSettings();
    const modifier = modifierInputEl.value;
    const overrideType = contentTypeSelectEl.value || null;
    const angleChoice = angleSelectEl.value;
    // Per Greg's request (2026-09-01): feed Claude the last ~month of
    // approved posts so it doesn't recycle the same angle/opening too soon.
    // Excludes today's own date so re-generating an already-approved day
    // doesn't compare a fresh draft against itself.
    const recentContent = await getApprovedContentSince(settings.recentContentLookbackDays, dateKey(today), today);
    const result = await generateContent({
      apiKey: settings.claude.apiKey,
      model: settings.claude.model,
      targetPersona: settings.targetPersona,
      date: today,
      modifier,
      overrideType,
      dayTypeMap: settings.contentCalendar,
      recentContent,
      angleChoice,
    });
    draftTextEl.value = result.content;
    updateCharCount();
    const record = await saveDraft({
      date: today,
      dayKey: currentDayKey,
      contentType: currentPlan.type,
      text: result.content,
      modifier,
      overrideType,
      angleChoice,
      resolvedAngle: result.resolvedAngle,
    });
    renderBadge(record.state);
    // Per Greg's real observation (2026-09-01): Claude doesn't reliably hit
    // a character target just from being told to — generateContent already
    // retries with concrete feedback when it's over, but if it's STILL over
    // after those retries, say so plainly rather than showing the same
    // "Drafted" message as a clean success (the red character count already
    // flags it visually, but this makes it unmissable).
    const angleLabel = CONTENT_ANGLES.find((a) => a.id === result.resolvedAngle)?.shortLabel;
    const angleNote = angleLabel ? ` (angle: ${angleLabel})` : '';
    statusEl.textContent = result.overLimit
      ? `Drafted, but still over the ${currentPlan.maxChars}-character limit after retrying — shorten it manually, or Regenerate.`
      : `Drafted${angleNote} — review and edit as needed, then Approve.`;
    await log('info', 'Content: draft generated', {
      dayKey: currentDayKey,
      contentType: currentPlan.type,
      modifier,
      overrideType,
      angleChoice,
      resolvedAngle: result.resolvedAngle,
      overLimit: result.overLimit,
      recentContentCount: recentContent.length,
    });
  } catch (err) {
    statusEl.textContent = `Failed: ${err.message}`;
    await log('error', 'Content: draft generation failed', { error: err.message });
  } finally {
    generateBtn.disabled = false;
  }
});

approveBtn.addEventListener('click', async () => {
  if (!draftTextEl.value.trim()) {
    statusEl.textContent = 'Nothing to approve yet — generate a draft first.';
    return;
  }
  try {
    const record = await approveContent(today, draftTextEl.value);
    renderBadge(record.state);
    statusEl.textContent = 'Approved.';
    await log('info', 'Content: draft approved', { dayKey: record.dayKey });
  } catch (err) {
    statusEl.textContent = `Failed: ${err.message}`;
  }
});

// Real, serious bug found live (2026-09-01), per Greg: this used to reuse
// "whatever tab is currently active" via chrome.tabs.update — but Greg
// naturally clicks "Post to Personal Page" FROM the Content page itself,
// which means the Content page's OWN tab was "the active tab." Navigating
// it to facebook.com destroyed the very script that was supposed to keep
// running afterward (send the DRAFT_FEED_POST message, update the status,
// log the result) — the whole click handler died mid-flight the instant its
// own document unloaded, with no error, no status update, no log entry.
// That's exactly the silent "nothing happens" Greg saw.
//
// Fixed by never touching an existing tab at all — always opens a brand
// NEW tab for this action instead of navigating/reusing whatever happens to
// be active. Slightly less efficient if Greg already has Facebook open
// somewhere, but this is the only way to guarantee the action can't ever
// destroy the very page it was launched from (or any other tab Greg cares
// about). Still made active/foreground per Greg's design (2026-09-01) —
// he needs to end up looking at the open composer to finish posting
// himself.
function openFacebookHomeTab(targetUrl) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timeoutHandle;
    let newTabId;

    function finish(result, err) {
      if (settled) return;
      settled = true;
      chrome.tabs.onUpdated.removeListener(onUpdated);
      clearTimeout(timeoutHandle);
      if (err) reject(err);
      else resolve(result);
    }

    function onUpdated(updatedTabId, changeInfo, updatedTab) {
      if (updatedTabId !== newTabId || changeInfo.status !== 'complete') return;
      setTimeout(() => finish(updatedTab), 1500); // let the SPA content itself render
    }
    chrome.tabs.onUpdated.addListener(onUpdated);

    chrome.tabs.create({ url: targetUrl, active: true }, (tab) => {
      newTabId = tab.id;
      timeoutHandle = setTimeout(() => finish(null, new Error('timed out loading Facebook')), 15000);
    });
  });
}

// Shared by 3A (personal page) and 3B (business page) — per Greg's design
// (2026-09-01), both are assisted, not automatic: open the composer, type
// the approved draft, and stop, so Greg attaches media/picks a background
// and clicks Facebook's own Post button himself. Both re-check the ledger
// directly (not whatever's currently in the box) so this can't post
// something that was never reviewed (D6's review gate).
//
// 3B (added 2026-09-02) reuses the exact same DRAFT_FEED_POST message and
// composer selectors as 3A, UNVERIFIED against a real Business Page's DOM —
// a Page's own timeline composer may not match the same aria-placeholder
// text ("What's on your mind, {name}?") that was verified for the personal
// profile. This is a safe first attempt, not a guess wired in blind: if the
// selector doesn't match, waitForElement's existing timeout surfaces a
// clean "Failed: ..." rather than crashing or silently doing nothing. If
// Greg hits that failure live, the fix is to paste the real Business Page
// composer DOM so a Page-specific selector can be added.
async function postApprovedDraft({ url, button, statusEl, logLabel, openingMessage }) {
  const existing = await getContentForDate(today);
  if (!existing || existing.state !== CONTENT_STATES.APPROVED) {
    statusEl.textContent = 'Approve the draft first — this only works on approved content.';
    return;
  }
  if (!url) {
    statusEl.textContent = 'Set the URL for this in Settings first.';
    return;
  }

  button.disabled = true;
  statusEl.textContent = openingMessage;
  let result;
  try {
    const readyTab = await openFacebookHomeTab(url);

    statusEl.textContent = 'Opening the composer and typing…';
    result = await new Promise((resolve) => {
      chrome.tabs.sendMessage(readyTab.id, { type: 'DRAFT_FEED_POST', text: existing.text }, (response) => {
        resolve(chrome.runtime.lastError ? { typed: false, reason: chrome.runtime.lastError.message } : response);
      });
    });

    statusEl.textContent = result.typed
      ? 'Typed into the composer — review it, then click Post yourself on Facebook.'
      : `Failed: ${result.reason ?? 'unknown reason'}`;
  } catch (err) {
    // Real gap found live (2026-09-01): this branch only ever set the status
    // text, never logged anything — so a failure here (like the tab-
    // clobbering bug that motivated this fix) left literally no trace in
    // the log, making it much harder to diagnose. Now logged the same way
    // the success path already was.
    result = { typed: false, reason: err.message };
    statusEl.textContent = `Failed: ${err.message}`;
  } finally {
    await log('info', logLabel, { dayKey: existing.dayKey, result });
    button.disabled = false;
  }
}

postPersonalBtn.addEventListener('click', async () => {
  const settings = await getSettings();
  await postApprovedDraft({
    url: settings.personalPageUrl,
    button: postPersonalBtn,
    statusEl: postStatusEl,
    logLabel: 'Content: 3A post-to-personal-page attempt',
    openingMessage: 'Opening your profile…',
  });
});

postBusinessBtn.addEventListener('click', async () => {
  const settings = await getSettings();
  await postApprovedDraft({
    url: settings.businessPageUrl,
    button: postBusinessBtn,
    statusEl: postBusinessStatusEl,
    logLabel: 'Content: 3B post-to-business-page attempt',
    openingMessage: 'Opening your business page…',
  });
});

init();
