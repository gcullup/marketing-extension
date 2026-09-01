// Step 3 content generation — drafts one Facebook post per calendar day,
// based on the day-of-week content calendar Greg described (2026-09-01):
// Mon/Wed short-form (must fit in one post, no "See More"), Tue/Thu
// long-form (a photo gets attached separately, by Greg, not generated
// here), Fri a generic engagement post unrelated to the target persona (a
// video with a song overlay also attached separately by Greg). Saturday and
// Sunday have no plan yet — deliberately left undefined rather than guessed.
//
// The guidance text below is a first-pass placeholder, not yet engineered —
// Greg explicitly wants to refine the actual prompt wording later, once this
// basic day-of-week pipeline works end to end.

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

// Facebook's real "See More" cutoff varies by device/font/whether a link
// preview is attached, and hasn't been measured against a real post yet —
// this is a conservative starting guess to refine once Greg pastes a
// generated draft in and sees where it actually gets truncated.
const SHORT_FORM_MAX_CHARS = 400;

const SHORT_FORM_PLAN = {
  type: 'short-form',
  label: 'Short-form — must fit in one post, no "See More"',
  needsMedia: null,
  maxChars: SHORT_FORM_MAX_CHARS,
  guidance:
    `Write a short Facebook post about the target persona/audience below. It MUST read as complete ` +
    `and satisfying within roughly ${SHORT_FORM_MAX_CHARS} characters or fewer, since anything longer ` +
    `gets truncated behind Facebook's "See More" link — the whole point is that a reader never needs ` +
    `to click to see the rest.`,
};

const LONG_FORM_PLAN = {
  type: 'long-form',
  label: 'Long-form — a photo gets attached separately',
  needsMedia: 'photo',
  maxChars: null,
  guidance:
    `Write a longer, more in-depth Facebook post about the target persona/audience below. A photo ` +
    `will be attached separately by the poster, so it's fine to reference "the photo" naturally if it ` +
    `fits, but don't assume the reader has already seen it when they start reading.`,
};

const ENGAGEMENT_PLAN = {
  type: 'engagement',
  label: 'Engagement post — a video with a song overlay gets attached separately',
  needsMedia: 'video',
  maxChars: null,
  guidance:
    `Write a short, fun Facebook post designed purely to drive comments and engagement — it should ` +
    `have NOTHING to do with the target persona/audience or real estate. Think pop-culture questions ` +
    `("who do you like more, Michael Jackson or Prince?"), business-adjacent prompts ("what's the one ` +
    `tool in your business you can't live without?"), or similar. A video with a song overlay will be ` +
    `attached separately by the poster.`,
};

const CONTENT_PLAN = {
  mon: SHORT_FORM_PLAN,
  tue: LONG_FORM_PLAN,
  wed: SHORT_FORM_PLAN,
  thu: LONG_FORM_PLAN,
  fri: ENGAGEMENT_PLAN,
  sat: null,
  sun: null,
};

export function getContentPlanForDate(date = new Date()) {
  const dayKey = DAY_KEYS[date.getDay()];
  return { dayKey, plan: CONTENT_PLAN[dayKey] };
}

const API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

const DRAFT_POST_TOOL = {
  name: 'draft_post',
  description: 'Draft one Facebook post matching the given content-type guidance.',
  input_schema: {
    type: 'object',
    properties: {
      content: { type: 'string', description: 'The full post text, ready to paste into Facebook.' },
    },
    required: ['content'],
  },
};

function buildPrompt(plan, targetPersona) {
  return [
    plan.guidance,
    '',
    `Target persona/audience (only relevant for short-form/long-form, not engagement posts): ${targetPersona}`,
    '',
    'Return ONLY the post text via the draft_post tool — no preamble, no hashtags unless they genuinely fit naturally, no placeholder brackets.',
  ].join('\n');
}

async function callClaude({ apiKey, model, plan, targetPersona }) {
  const response = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model,
      max_tokens: 600,
      tools: [DRAFT_POST_TOOL],
      tool_choice: { type: 'tool', name: DRAFT_POST_TOOL.name },
      messages: [{ role: 'user', content: buildPrompt(plan, targetPersona) }],
    }),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`Claude API error ${response.status}: ${errText.slice(0, 300)}`);
  }

  const data = await response.json();
  const toolUse = data.content?.find((block) => block.type === 'tool_use');
  if (!toolUse) {
    throw new Error('Claude response did not include the expected structured output.');
  }

  const { content } = toolUse.input ?? {};
  if (typeof content !== 'string' || !content.trim()) {
    throw new Error('Claude response failed schema validation.');
  }
  return { content, model: data.model };
}

/**
 * Drafts today's (or a given date's) post. Returns { dayKey, plan: null }
 * without calling Claude at all if no plan is defined for that day (currently
 * Saturday/Sunday) — not an error, just "nothing planned yet." Retries once
 * on failure, same discipline as lib/claude.js's screenCandidate.
 */
export async function generateContent({ apiKey, model, targetPersona, date = new Date() }) {
  const { dayKey, plan } = getContentPlanForDate(date);
  if (!plan) return { dayKey, plan: null };

  if (!apiKey) throw new Error('No Claude API key configured in Settings.');
  if (!model) throw new Error('No Claude model ID configured in Settings.');

  const attempt = () => callClaude({ apiKey, model, plan, targetPersona });
  let result;
  try {
    result = await attempt();
  } catch (firstErr) {
    try {
      result = await attempt();
    } catch (secondErr) {
      throw new Error(`Claude call failed twice — first: ${firstErr.message} | retry: ${secondErr.message}`);
    }
  }
  return { dayKey, plan, ...result };
}
