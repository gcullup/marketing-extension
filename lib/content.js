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

import { toFacebookFormatted, displayLength } from './facebookFormat.js';

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

// Revised 2026-09-01, per Greg: originally a guess at Facebook's "See More"
// truncation cutoff, then a placeholder guess (~100) at the stricter,
// undocumented colored-background-option limit, then a real empirically
// tested number (128 — the boundary Greg found by pasting increasingly long
// text into a real post until the background option disappeared, counted by
// Unicode code point, matching facebookFormat.js's displayLength).
// Lowered again the same day: the very next real draft came back at 178
// characters despite the prompt explicitly saying "MUST be 128 characters or
// fewer" — Claude missed the target by 50 characters, so 128 wasn't leaving
// enough margin in practice. 115 is a tighter target to compensate, not a
// new measurement of Facebook's actual limit. If overshoots keep happening,
// the more reliable fix is enforcing the limit in code after generation
// (check the length, re-ask if over) rather than just trusting the prompt
// instruction — not built yet, flagging for later if this recurs.
const SHORT_FORM_MAX_CHARS = 115;

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

// Added 2026-09-03, per Greg: a real long-form draft came back with several
// em dashes, which he specifically flagged as reading as AI-generated to
// people who've gotten used to spotting that tell. Written out in full below
// ("em dash") rather than using the actual character, so this instruction
// isn't itself an example of the thing it's banning. Applied to every plan,
// not just the ones with FORMATTING_GUIDANCE above -- this is about word
// choice, not visual styling.
const HUMAN_VOICE_GUIDANCE =
  'Avoid em dashes entirely (the long dash character, not a hyphen) -- use a period, comma, or ' +
  'parentheses instead. Also avoid semicolons, the "it\'s not just X, it\'s Y" construction, and ' +
  'starting more than one paragraph with a rhetorical question. Vary sentence length naturally rather ' +
  'than a string of short, similarly-sized punchy sentences.';

// Added 2026-09-03, per Greg: the prompt instruction above did NOT reliably
// stop Claude from using em dashes -- a real draft came back with at least
// two. Same lesson already learned the hard way with character limits
// (lengthFeedback/MAX_LENGTH_RETRIES below): asking nicely in the prompt
// isn't enough, measure/enforce in code. Unlike the character-limit case,
// there's nothing to "retry" here -- a plain mechanical substitution is
// deterministic and always correct, so it's simpler to just fix it directly
// rather than asking Claude to try again. Replaces with a short hyphen
// surrounded by spaces (matches how many people actually punctuate the same
// clause-break by hand) rather than a comma or period, since those would
// require guessing at sentence structure and risk an awkward comma splice
// or a capitalization mismatch -- a straight character swap changes zero
// grammar/meaning, only the specific character Facebook readers were
// flagging. Handles both spaced ("word — word") and unspaced ("word—word")
// em dashes, and en dashes for the same reason, since either could read the
// same way to a reader looking for the tell.
function stripEmDashes(text) {
  return text.replace(/\s*[—–]\s*/g, ' - ');
}

const PLANS_BY_TYPE = {
  [SHORT_FORM_PLAN.type]: SHORT_FORM_PLAN,
  [LONG_FORM_PLAN.type]: LONG_FORM_PLAN,
  [ENGAGEMENT_PLAN.type]: ENGAGEMENT_PLAN,
};

// Added 2026-09-01, per Greg: three consecutive real drafts all landed on
// the same generic "build your real estate empire" phrasing -- an
// open-ended "write a post about this persona" prompt gives Claude nothing
// to differentiate one call from the next, so repeated calls gravitate
// toward the same safe, common phrasing. Rather than leave that to chance,
// Greg picks a specific angle from this list (or "Surprise me," which hands
// the whole list to Claude and lets IT choose — see buildPrompt/callClaude
// below). Exported so the Content page's dropdown and any other future
// caller share this one list rather than a second hardcoded copy.
export const CONTENT_ANGLES = [
  { id: 'mistake', shortLabel: 'Common mistake', text: 'A common mistake people in this space make, and how to avoid it.' },
  { id: 'myth', shortLabel: 'Myth-busting', text: 'A myth or misconception worth busting.' },
  { id: 'tip', shortLabel: 'Practical tip', text: 'A practical, actionable tip the reader can use today.' },
  { id: 'fact', shortLabel: 'Industry fact', text: 'A "did you know" industry fact or statistic-flavored insight.' },
  {
    id: 'story',
    shortLabel: 'Personal story',
    text: 'A behind-the-scenes or personal-story framing — a lesson learned, a real moment.',
  },
  {
    id: 'mindset',
    shortLabel: 'Mindset / motivation',
    text: 'A mindset/motivation angle about persistence, discipline, or long-term thinking.',
  },
  {
    id: 'contrarian',
    shortLabel: 'Contrarian take',
    text: 'A contrarian or comparison take — this vs. that, old way vs. better way.',
  },
  {
    id: 'question',
    shortLabel: 'Direct question',
    text: 'A direct question to the reader that invites them to reflect or reply.',
  },
];

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
      // Only meaningful in "Surprise me" angle mode (see buildPrompt) --
      // Claude picks one of the offered angles itself and reports which one
      // via this field, so the choice is auditable/loggable rather than a
      // black box. Omitted by Claude in every other mode.
      angleUsed: {
        type: 'string',
        description:
          'Only fill this in if you were asked to pick an angle yourself: the id of the angle you chose (e.g. "myth"). Omit otherwise.',
      },
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
// `lengthFeedback` -- added 2026-09-01, per Greg: real evidence across two
// consecutive short-form drafts that Claude does NOT reliably respect a
// character cap just from being told "MUST be N characters" in the prompt
// (one came back 50 over a 128 target, the next 14 over a 115 target) --
// this isn't a wording problem, it's models generating token-by-token
// without precisely tracking character counts. Rather than keep lowering
// the target number and hoping, generateContent below now actually checks
// the result's length and retries with this concrete, measured feedback
// ("you were previously N characters, M over the limit") when needed.
// `angleChoice` -- added 2026-09-01, per Greg's real observation that three
// consecutive drafts all landed on the same generic phrasing: an open-ended
// "write a post about this persona" prompt gives Claude nothing to
// differentiate one call from the next. `''`/falsy means no angle steering
// at all (original behavior); an id from CONTENT_ANGLES pins a specific
// angle; `'surprise'` hands Claude the WHOLE list and lets it choose (and
// report which one via the draft_post tool's angleUsed field, so the choice
// stays auditable). Independent of `modifier` -- Greg can combine a theme
// and an angle, or use either alone.
function buildPrompt(plan, targetPersona, modifier, recentContent = [], lengthFeedback = '', angleChoice = '') {
  const lines = [
    plan.guidance,
    '',
    `Target persona/audience (only relevant for short-form/long-form, not engagement posts): ${targetPersona}`,
  ];
  if (angleChoice === 'surprise') {
    const angleListText = CONTENT_ANGLES.map((a) => `- (${a.id}) ${a.text}`).join('\n');
    lines.push(
      '',
      `Pick ONE of the following angles for this specific post — whichever feels freshest, especially ` +
        `compared to anything in the "recently posted" list below — and report which one you used via ` +
        `the draft_post tool's angleUsed field (its id, e.g. "myth"):\n${angleListText}`
    );
  } else if (angleChoice) {
    const chosen = CONTENT_ANGLES.find((a) => a.id === angleChoice);
    if (chosen) lines.push('', `Angle for this specific post: ${chosen.text}`);
  }
  lines.push('', plan.allowBoldFormatting ? FORMATTING_GUIDANCE : PLAIN_FORMATTING_GUIDANCE);
  lines.push('', HUMAN_VOICE_GUIDANCE);
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
  // Placed last, right before the final instruction, so it's the most
  // recent/salient thing in the prompt when there's a concrete overage to
  // correct.
  if (lengthFeedback) {
    lines.push('', lengthFeedback);
  }
  lines.push(
    '',
    'Return ONLY the post text via the draft_post tool — no preamble, no hashtags unless they genuinely fit naturally, no placeholder brackets.'
  );
  return lines.join('\n');
}

async function callClaude({ apiKey, model, plan, targetPersona, modifier, recentContent, lengthFeedback, angleChoice }) {
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
      messages: [
        { role: 'user', content: buildPrompt(plan, targetPersona, modifier, recentContent, lengthFeedback, angleChoice) },
      ],
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

  const { content, angleUsed } = toolUse.input ?? {};
  if (typeof content !== 'string' || !content.trim()) {
    throw new Error('Claude response failed schema validation.');
  }
  const plainContent = stripEmDashes(content);
  const finalContent = plan.allowBoldFormatting ? toFacebookFormatted(plainContent) : plainContent;
  return { content: finalContent, model: data.model, angleUsed };
}

/**
 * Drafts today's (or a given date's) post. Returns { dayKey, plan: null }
 * without calling Claude at all if no plan applies (the day's default is
 * undefined — currently Saturday/Sunday — AND no override was given) — not
 * an error, just "nothing to draft yet." `overrideType` (one of
 * CONTENT_TYPE_OPTIONS' `type` values) forces a specific content type
 * regardless of the day, per Greg's request (2026-09-01). Retries once on
 * failure, same discipline as lib/claude.js's screenCandidate — and, for
 * plans with a character limit, retries again (up to MAX_LENGTH_RETRIES)
 * with concrete feedback if the result comes back too long. The returned
 * object includes `overLimit: true` if it's still over after every retry,
 * so the caller can warn instead of silently accepting a non-compliant draft.
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
  angleChoice = '',
}) {
  const { dayKey, plan } = resolveContentPlan(date, overrideType, dayTypeMap);
  if (!plan) return { dayKey, plan: null };

  if (!apiKey) throw new Error('No Claude API key configured in Settings.');
  if (!model) throw new Error('No Claude model ID configured in Settings.');

  const attempt = (lengthFeedback) =>
    callClaude({ apiKey, model, plan, targetPersona, modifier, recentContent, lengthFeedback, angleChoice });
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

  // Length-compliance retries — a separate concern from the failure-retry
  // above (that's for a broken/errored call; this is a successful,
  // well-formed response that's simply too long). Real evidence (2026-09-01):
  // two consecutive short-form drafts both overshot their character target
  // despite an explicit "MUST be N characters" instruction — asking nicely
  // isn't reliable, so this actually measures the result and asks again
  // with the concrete overage when it's wrong. Keeps whichever attempt ends
  // up shortest, in case a retry overshoots even worse than the original.
  const MAX_LENGTH_RETRIES = 2;
  let best = result;
  for (let i = 0; plan.maxChars && displayLength(best.content) > plan.maxChars && i < MAX_LENGTH_RETRIES; i++) {
    const overBy = displayLength(best.content) - plan.maxChars;
    try {
      const retry = await attempt(
        `Your previous attempt was ${displayLength(best.content)} characters — ${overBy} over the ` +
          `${plan.maxChars}-character limit. Rewrite it to fit within ${plan.maxChars} characters, ` +
          `keeping the same core message.`
      );
      if (displayLength(retry.content) < displayLength(best.content)) best = retry;
    } catch {
      break; // a failed retry just means keeping the best attempt found so far
    }
  }
  const overLimit = plan.maxChars ? displayLength(best.content) > plan.maxChars : false;

  // Resolves to whatever's actually auditable: the specific angle Greg
  // picked (already known, no need for Claude to echo it back), or whatever
  // Claude reported choosing in "surprise" mode, or null if no angle
  // steering was used at all.
  const resolvedAngle = angleChoice === 'surprise' ? (best.angleUsed ?? null) : angleChoice || null;

  return { dayKey, plan, ...best, overLimit, resolvedAngle };
}
