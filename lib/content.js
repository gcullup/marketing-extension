// Step 3 content generation — drafts one Facebook post per calendar day,
// based on the day-of-week content calendar Greg described (2026-09-01):
// Mon/Wed short-form (short enough for Facebook's colored-background text
// option, which also means no "See More"), Tue/Thu long-form (a photo gets
// attached separately, by Greg, not generated here), Fri a generic
// engagement post unrelated to the target persona (a video with a song
// overlay also attached separately by Greg). Saturday and Sunday have no
// plan yet — deliberately left undefined rather than guessed.
//
// The guidance text below is a first-pass placeholder, not yet engineered —
// Greg explicitly wants to refine the actual prompt wording later, once this
// basic day-of-week pipeline works end to end.

import { toFacebookFormatted } from './facebookFormat.js';

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

// Revised 2026-09-01, per Greg: originally a guess at Facebook's "See More"
// truncation cutoff, then a placeholder guess (~100) at the stricter,
// undocumented colored-background-option limit. Now a real, empirically
// tested number: Greg found the exact boundary by pasting increasingly long
// text into a real post until the background option disappeared. The
// winning string, counted the same way this app counts everywhere else (by
// Unicode code point, matching facebookFormat.js's displayLength — see
// sidepanel/content.js's character counter) came out to exactly 128. Being
// short enough for the background option automatically satisfies the old
// "See More" goal too, since it's the stricter of the two constraints.
const SHORT_FORM_MAX_CHARS = 128;

const SHORT_FORM_PLAN = {
  type: 'short-form',
  label: 'Short-form — short enough for Facebook\'s colored background option, no "See More"',
  needsMedia: null,
  maxChars: SHORT_FORM_MAX_CHARS,
  // Per Greg (2026-09-01): no bold-Unicode formatting for short-form. Those
  // characters are outside the Basic Multilingual Plane and Facebook's own
  // background-eligibility length check may well count them differently
  // than plain ASCII -- rather than guess how, just don't use them here,
  // so the character count this module computes is unambiguous.
  allowBoldFormatting: false,
  guidance:
    `Write a short Facebook post about the target persona/audience below. It MUST be ${SHORT_FORM_MAX_CHARS} ` +
    `plain characters or fewer (no exceptions), so it's short enough to qualify for Facebook's colored ` +
    `background option for short text posts and never gets truncated behind a "See More" link.`,
};

const LONG_FORM_PLAN = {
  type: 'long-form',
  label: 'Long-form — a photo gets attached separately',
  needsMedia: 'photo',
  maxChars: null,
  allowBoldFormatting: true,
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
  allowBoldFormatting: true,
  guidance:
    `Write a short, fun Facebook post designed purely to drive comments and engagement — it should ` +
    `have NOTHING to do with the target persona/audience or real estate. Think pop-culture questions ` +
    `("who do you like more, Michael Jackson or Prince?"), business-adjacent prompts ("what's the one ` +
    `tool in your business you can't live without?"), or similar. A video with a song overlay will be ` +
    `attached separately by the poster.`,
};

// Real gap found live (2026-09-01): the first generated drafts came back as
// plain, unstyled text -- no emoji, no visual emphasis -- which reads flat
// once actually posted. Facebook's post composer doesn't render real
// HTML/markdown formatting on paste, so asking Claude to bold with markdown
// only works if something downstream converts it -- see facebookFormat.js,
// applied in callClaude below. Only used for plans with allowBoldFormatting
// -- short-form deliberately skips both this and the conversion (see above).
const FORMATTING_GUIDANCE =
  'Formatting: wrap a few short phrases worth visually emphasizing (a strong opening line, a key phrase) ' +
  'in **double asterisks** -- not every sentence, just the handful that deserve it. Include relevant emoji ' +
  'naturally where they add visual interest, without overdoing it.';

const PLAIN_FORMATTING_GUIDANCE =
  'Formatting: plain text only -- no bold, no markdown, no special characters for styling. Include ' +
  'relevant emoji naturally where they add visual interest, without overdoing it.';

const PLANS_BY_TYPE = {
  [SHORT_FORM_PLAN.type]: SHORT_FORM_PLAN,
  [LONG_FORM_PLAN.type]: LONG_FORM_PLAN,
  [ENGAGEMENT_PLAN.type]: ENGAGEMENT_PLAN,
};

// Exposed so the UI can build its override dropdown (and Settings' day-grid
// selects) from the same data this module uses internally, rather than
// hardcoding a second copy of the type list/labels that could drift out of
// sync.
export const CONTENT_TYPE_OPTIONS = [SHORT_FORM_PLAN, LONG_FORM_PLAN, ENGAGEMENT_PLAN].map((p) => ({
  type: p.type,
  label: p.label,
}));

// Revised 2026-09-01, per Greg: the day-of-week -> content-type mapping used
// to be a hardcoded table here. Moved to settings.contentCalendar (see
// lib/store.js's DEFAULT_SETTINGS) so it's user-configurable like every
// other day-of-week setting, instead of requiring a code change to move,
// say, the short-form days. `dayTypeMap` is that settings object (or `{}`
// for a day with nothing configured, which just means no plan).
export function getContentPlanForDate(date = new Date(), dayTypeMap = {}) {
  const dayKey = DAY_KEYS[date.getDay()];
  const type = dayTypeMap[dayKey];
  return { dayKey, plan: type ? PLANS_BY_TYPE[type] ?? null : null };
}

/**
 * Resolves the plan that actually applies for a date, per Greg's request
 * (2026-09-01) to be able to override the day-of-week default (e.g. force
 * short-form on a Tuesday, or pick a type at all on a currently-unplanned
 * Sat/Sun) rather than always taking whatever the day implies. Passing a
 * falsy `overrideType` (the "Auto" choice in the UI) falls back to the
 * day's own default, which may itself be null (Sat/Sun today).
 */
export function resolveContentPlan(date, overrideType, dayTypeMap = {}) {
  const { dayKey, plan: dayPlan } = getContentPlanForDate(date, dayTypeMap);
  if (overrideType) {
    return { dayKey, plan: PLANS_BY_TYPE[overrideType] ?? null, isOverride: true };
  }
  return { dayKey, plan: dayPlan, isOverride: false };
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

// Per Greg's request (2026-09-01): an optional free-text theme that travels
// with the generation call (e.g. "Labor Day") -- lets him nudge a specific
// day's content toward a timely angle without touching the underlying
// day-type guidance above. Purely additive; the day's format rules
// (length, persona-relevance, etc.) still apply on top of it.
//
// `recentContent` -- also per Greg (2026-09-01): the last month or so of
// approved posts (from lib/contentLedger.js's getApprovedContentSince,
// fetched by the caller -- this module stays storage-agnostic, same
// convention as targetPersona/dayTypeMap being passed in rather than read
// internally) -- so Claude can avoid recycling the same angle, opening
// line, or phrasing too soon.
function buildPrompt(plan, targetPersona, modifier, recentContent = []) {
  const lines = [
    plan.guidance,
    '',
    `Target persona/audience (only relevant for short-form/long-form, not engagement posts): ${targetPersona}`,
    '',
    plan.allowBoldFormatting ? FORMATTING_GUIDANCE : PLAIN_FORMATTING_GUIDANCE,
  ];
  if (modifier && modifier.trim()) {
    lines.push('', `Theme/angle to incorporate naturally into this post: ${modifier.trim()}`);
  }
  if (recentContent.length) {
    lines.push(
      '',
      `Recently posted (last ~month) — do NOT repeat the same angle, opening line, or phrasing as any of these:`,
      ...recentContent.map((r) => `- (${r.date}, ${r.contentType}): ${r.text}`)
    );
  }
  lines.push(
    '',
    'Return ONLY the post text via the draft_post tool — no preamble, no hashtags unless they genuinely fit naturally, no placeholder brackets.'
  );
  return lines.join('\n');
}

async function callClaude({ apiKey, model, plan, targetPersona, modifier, recentContent }) {
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
      messages: [{ role: 'user', content: buildPrompt(plan, targetPersona, modifier, recentContent) }],
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
  const finalContent = plan.allowBoldFormatting ? toFacebookFormatted(content) : content;
  return { content: finalContent, model: data.model };
}

/**
 * Drafts today's (or a given date's) post. Returns { dayKey, plan: null }
 * without calling Claude at all if no plan applies (the day's default is
 * undefined — currently Saturday/Sunday — AND no override was given) — not
 * an error, just "nothing to draft yet." `overrideType` (one of
 * CONTENT_TYPE_OPTIONS' `type` values) forces a specific content type
 * regardless of the day, per Greg's request (2026-09-01). Retries once on
 * failure, same discipline as lib/claude.js's screenCandidate.
 */
export async function generateContent({
  apiKey,
  model,
  targetPersona,
  date = new Date(),
  modifier = '',
  overrideType = null,
  dayTypeMap = {},
  recentContent = [],
}) {
  const { dayKey, plan } = resolveContentPlan(date, overrideType, dayTypeMap);
  if (!plan) return { dayKey, plan: null };

  if (!apiKey) throw new Error('No Claude API key configured in Settings.');
  if (!model) throw new Error('No Claude model ID configured in Settings.');

  const attempt = () => callClaude({ apiKey, model, plan, targetPersona, modifier, recentContent });
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
