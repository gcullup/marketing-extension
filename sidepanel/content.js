import { getContentPlanForDate, generateContent } from '../lib/content.js';
import { getContentForDate, saveDraft, approveContent, CONTENT_STATES } from '../lib/contentLedger.js';
import { getSettings } from '../lib/store.js';
import { log } from '../lib/log.js';
import { displayLength } from '../lib/facebookFormat.js';

const dayInfoEl = document.getElementById('dayInfo');
const mediaNoteEl = document.getElementById('mediaNote');
const noPlanEl = document.getElementById('noPlan');
const editorEl = document.getElementById('editor');
const draftTextEl = document.getElementById('draftText');
const charCountEl = document.getElementById('charCount');
const generateBtn = document.getElementById('generateBtn');
const approveBtn = document.getElementById('approveBtn');
const statusEl = document.getElementById('status');
const stateBadgeEl = document.getElementById('stateBadge');

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

async function init() {
  const { dayKey, plan } = getContentPlanForDate(today);
  currentPlan = plan;
  currentDayKey = dayKey;

  if (!plan) {
    dayInfoEl.textContent = `${today.toDateString()} (${dayKey}) — no plan defined for this day yet.`;
    noPlanEl.style.display = 'block';
    editorEl.style.display = 'none';
    return;
  }

  dayInfoEl.textContent = `${today.toDateString()} — ${plan.label}`;
  if (plan.needsMedia) {
    mediaNoteEl.textContent = MEDIA_NOTES[plan.needsMedia] ?? '';
    mediaNoteEl.style.display = 'block';
  }
  editorEl.style.display = 'block';

  const existing = await getContentForDate(today);
  if (existing) {
    draftTextEl.value = existing.text;
    renderBadge(existing.state);
  }
  updateCharCount();
}

draftTextEl.addEventListener('input', updateCharCount);

generateBtn.addEventListener('click', async () => {
  generateBtn.disabled = true;
  statusEl.textContent = 'Drafting with Claude…';
  try {
    const settings = await getSettings();
    const result = await generateContent({
      apiKey: settings.claude.apiKey,
      model: settings.claude.model,
      targetPersona: settings.targetPersona,
      date: today,
    });
    draftTextEl.value = result.content;
    updateCharCount();
    const record = await saveDraft({
      date: today,
      dayKey: currentDayKey,
      contentType: currentPlan.type,
      text: result.content,
    });
    renderBadge(record.state);
    statusEl.textContent = 'Drafted — review and edit as needed, then Approve.';
    await log('info', 'Content: draft generated', { dayKey: currentDayKey, contentType: currentPlan.type });
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

init();
