import { resolveContentPlan, generateContent } from '../lib/content.js';
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
const charCountEl = document.getElementById('charCount');
const generateBtn = document.getElementById('generateBtn');
const copyBtn = document.getElementById('copyBtn');
const approveBtn = document.getElementById('approveBtn');
const statusEl = document.getElementById('status');
const stateBadgeEl = document.getElementById('stateBadge');
const postPersonalBtn = document.getElementById('postPersonalBtn');
const postStatusEl = document.getElementById('postStatus');

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
    });
    renderBadge(record.state);
    // Per Greg's real observation (2026-09-01): Claude doesn't reliably hit
    // a character target just from being told to — generateContent already
    // retries with concrete feedback when it's over, but if it's STILL over
    // after those retries, say so plainly rather than showing the same
    // "Drafted" message as a clean success (the red character count already
    // flags it visually, but this makes it unmissable).
    statusEl.textContent = result.overLimit
      ? `Drafted, but still over the ${currentPlan.maxChars}-character limit after retrying — shorten it manually, or Regenerate.`
      : 'Drafted — review and edit as needed, then Approve.';
    await log('info', 'Content: draft generated', {
      dayKey: currentDayKey,
      contentType: currentPlan.type,
      modifier,
      overrideType,
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

// Mirrors panel.js's ensureOnSuggestionsPage pattern (built for Discovery
// Batch, 2026-09-01): makes sure the active tab is somewhere the "What's on
// your mind?" composer trigger actually exists before trying to click it.
// Real bug found on the very first live test (2026-09-01): this originally
// hardcoded https://www.facebook.com/me, which landed on Greg's actual
// profile page — a page whose composer DOM was never verified (only the
// main feed's was, from the console output Greg pasted). Now targets
// `settings.personalPageUrl` (a new Settings field, default the plain feed
// URL that was actually verified) instead of a hardcoded constant, per
// Greg's own request — sets up the same pattern for 3B (business page),
// where choosing which Page to post to will be a real, meaningful setting,
// not just this one's future-proofing gesture. Per Greg's design
// (2026-09-01), 3A is assisted — Greg needs to end up looking at the open
// composer to finish posting himself, so this operates on the ACTIVE tab
// directly rather than a background tab that would then need focus restored
// afterward (the lesson from the DM Queue focus bug).
function ensureOnFacebookHome(tab, targetUrl) {
  if (tab.url && tab.url.startsWith(targetUrl)) return Promise.resolve(tab);

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
      setTimeout(() => finish(updatedTab), 1500); // let the SPA content itself render
    }
    chrome.tabs.onUpdated.addListener(onUpdated);

    timeoutHandle = setTimeout(() => finish(null, new Error('timed out loading Facebook')), 15000);
    chrome.tabs.update(tab.id, { url: targetUrl });
  });
}

// 3A — post to personal page, per Greg's design (2026-09-01): assisted, not
// automatic. Requires the draft to actually be Approved first (D6's review
// gate) — re-checks the ledger directly rather than trusting whatever's
// currently in the box, so this can't post something that was never
// reviewed.
postPersonalBtn.addEventListener('click', async () => {
  const existing = await getContentForDate(today);
  if (!existing || existing.state !== CONTENT_STATES.APPROVED) {
    postStatusEl.textContent = 'Approve the draft first — this only works on approved content.';
    return;
  }

  postPersonalBtn.disabled = true;
  postStatusEl.textContent = 'Opening your profile…';
  try {
    const settings = await getSettings();
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) {
      postStatusEl.textContent = 'No active tab found.';
      return;
    }
    const readyTab = await ensureOnFacebookHome(tab, settings.personalPageUrl);

    postStatusEl.textContent = 'Opening the composer and typing…';
    const result = await new Promise((resolve) => {
      chrome.tabs.sendMessage(readyTab.id, { type: 'DRAFT_FEED_POST', text: existing.text }, (response) => {
        resolve(chrome.runtime.lastError ? { typed: false, reason: chrome.runtime.lastError.message } : response);
      });
    });

    postStatusEl.textContent = result.typed
      ? 'Typed into the composer — review it, then click Post yourself on Facebook.'
      : `Failed: ${result.reason ?? 'unknown reason'}`;
    await log('info', 'Content: 3A post-to-personal-page attempt', { dayKey: existing.dayKey, result });
  } catch (err) {
    postStatusEl.textContent = `Failed: ${err.message}`;
  } finally {
    postPersonalBtn.disabled = false;
  }
});

init();
