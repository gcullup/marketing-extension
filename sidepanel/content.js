import { resolveContentPlan, generateContent } from '../lib/content.js';
import { getContentForDate, saveDraft, approveContent, CONTENT_STATES } from '../lib/contentLedger.js';
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

generateBtn.addEventListener('click', async () => {
  generateBtn.disabled = true;
  statusEl.textContent = 'Drafting with Claude…';
  try {
    const settings = await getSettings();
    const modifier = modifierInputEl.value;
    const overrideType = contentTypeSelectEl.value || null;
    const result = await generateContent({
      apiKey: settings.claude.apiKey,
      model: settings.claude.model,
      targetPersona: settings.targetPersona,
      date: today,
      modifier,
      overrideType,
      dayTypeMap: settings.contentCalendar,
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
    statusEl.textContent = 'Drafted — review and edit as needed, then Approve.';
    await log('info', 'Content: draft generated', {
      dayKey: currentDayKey,
      contentType: currentPlan.type,
      modifier,
      overrideType,
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

init();
