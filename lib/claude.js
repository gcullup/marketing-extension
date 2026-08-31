// Claude API client. Structured output only, via forced tool use — every
// response is validated against a fixed schema; a malformed or missing
// response is surfaced as an error rather than silently passed downstream.
// This discipline (see ARCHITECTURE.md "Claude API integration") is what
// keeps a bad response auditable instead of quietly degrading match quality
// the way the prior build's screening step did.

const API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

const SCREEN_TOOL = {
  name: 'screen_candidate',
  description:
    'Score how well a Facebook profile matches a target persona, based on the totality of the profile — not literal keyword matches.',
  input_schema: {
    type: 'object',
    properties: {
      confidence: {
        type: 'integer',
        minimum: 0,
        maximum: 100,
        description: '0-100 confidence this person matches the target persona',
      },
      reasoning: {
        type: 'string',
        description: 'One or two sentences citing specific evidence from the profile',
      },
      signals: {
        type: 'array',
        items: { type: 'string' },
        description: 'Short list of the specific clues that drove the judgment',
      },
    },
    required: ['confidence', 'reasoning', 'signals'],
  },
};

function buildPrompt(targetPersona, profileText, links) {
  const linksBlock = links.length ? links.join('\n') : '(none found)';
  return [
    `Target persona: ${targetPersona}`,
    '',
    'Profile text (scraped from the live page — may include minor unrelated noise):',
    profileText,
    '',
    'External links found on this profile:',
    linksBlock,
    '',
    'Based on the totality of this profile — not literal keyword matches — how well does this',
    'person fit the target persona? Consider indirect clues: a personal business website,',
    'industry-specific language, professional context implied by their connections, and so on.',
    'Judge holistically, the way a person skimming the profile would form an impression.',
  ].join('\n');
}

/**
 * One live call to Claude. Throws on any failure — network error, non-2xx
 * response, or a response that fails schema validation — rather than
 * returning a fallback value.
 */
async function callClaude({ apiKey, model, targetPersona, profileText, links }) {
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
      max_tokens: 400,
      tools: [SCREEN_TOOL],
      tool_choice: { type: 'tool', name: SCREEN_TOOL.name },
      messages: [{ role: 'user', content: buildPrompt(targetPersona, profileText, links) }],
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

  const { confidence, reasoning, signals } = toolUse.input ?? {};
  if (typeof confidence !== 'number' || typeof reasoning !== 'string' || !Array.isArray(signals)) {
    throw new Error('Claude response failed schema validation.');
  }

  return { confidence, reasoning, signals, model: data.model };
}

/**
 * Screens one candidate against a target persona. Retries exactly once on
 * any failure — confirmed live (2026-08-31) that a real Haiku call can
 * occasionally return a malformed structured response, which previously
 * aborted an entire discovery batch over one transient hiccup. This was
 * always the documented intent (ARCHITECTURE.md: "malformed responses
 * rejected and retried") but had never actually been implemented until now.
 * Throws only if both attempts fail, with both error messages included —
 * callers decide how to handle that, but this function never fabricates a
 * result.
 */
export async function screenCandidate({ apiKey, model, targetPersona, profileText, links = [] }) {
  if (!apiKey) throw new Error('No Claude API key configured in Settings.');
  if (!model) throw new Error('No Claude model ID configured in Settings.');

  const attempt = () => callClaude({ apiKey, model, targetPersona, profileText, links });
  try {
    return await attempt();
  } catch (firstErr) {
    try {
      return await attempt();
    } catch (secondErr) {
      throw new Error(`Claude call failed twice — first: ${firstErr.message} | retry: ${secondErr.message}`);
    }
  }
}
