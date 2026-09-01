# Architecture — Facebook Marketing Extension

Chrome extension (Manifest V3) that acts as a **cockpit over Facebook** for The Numbers Guy, LLC's
outbound social marketing. It is a human-in-the-loop daily driver, not an unattended bot.

---

## Governing principle: separate DECIDING from DOING

The single most important structural decision. Two independent halves:

| | **Decide** | **Do** |
|---|---|---|
| What it is | Scrape signals, ask Claude, score, queue | Click buttons, type into composers |
| Where it lives | Service worker + `lib/claude.js` | Content script + `selectors.js` |
| Failure mode | Bad AI judgment | Facebook changed its HTML |
| Cost of failure | Wasted API spend, bad targets | Silent no-ops, or wrong clicks |

**Why this matters:** the previous build "started returning bad results" with no way to tell which
half was at fault. When they are separate and both are logged, a failure becomes a two-minute
diagnosis instead of a rebuild.

---

## Component map

```
marketing-extension/
├── manifest.json              MV3 manifest, permissions, side panel registration
├── background/
│   └── service-worker.js      Orchestrator. Queue state machine, quotas, rate limits.
│                              Knows NOTHING about the DOM.
├── content/
│   ├── content.js             Injected into facebook.com. The ONLY DOM toucher.
│   ├── selectors.js           *** ALL Facebook selectors live here, nowhere else ***
│   ├── scrape.js              Read: suggestions, pending requests, birthdays
│   └── act.js                 Write: click Add Friend, drive the message composer
├── sidepanel/
│   ├── panel.html / panel.js        The cockpit: queue, approve/skip, counters, checklist
│   └── settings.html / settings.js  Industry targets, quotas, API key, model, caps
├── lib/
│   ├── store.js               chrome.storage.local wrapper, versioned schema, export/import
│   ├── claude.js              Claude API client: structured output, validation, retry, cache
│   ├── ledger.js              Person Ledger read/write and state transitions
│   ├── ratelimit.js           Randomized human-paced gaps, daily caps, abort conditions
│   └── log.js                 Ring-buffer log of every action and every AI call
├── ARCHITECTURE.md            (this file)
└── WORKFLOW-MAP.md            Living status tracker
```

### Why the Side Panel and not a popup

Chrome's Side Panel API stays open while you navigate Facebook. A popup closes the instant you
click the page, which makes an approve/skip workflow unusable.

---

## Central data model: the Person Ledger

One record per human, ever. Every feature in the system is a **query over this one table.**

```
discovered
  → rejected       (exclude match, or AI verdict ≤ reject floor — permanent, never resurfaced)
  → needs_review   (AI verdict in the middle band — surfaced for human approve/skip)
  → queued         (exact-include match, or AI verdict ≥ auto-approve threshold)
       → requested { date }
            → pending
            → accepted { date }
            → cancelled
            → expired
  → dm_queued
  → dm_sent        { date, message }
  → replied
```

Implemented in `lib/ledger.js`. Record shape (as actually built, not speculative):

```js
{
  id,              // stable: the profile URL's username slug, lowercased. NEVER the display name.
  name, profileUrl,
  state,           // from the machine above — STATES constant in lib/ledger.js
  discoveredAt,
  screening: {
    tier,          // 'exclude' | 'exact-include' | 'ai'
    verdict,       // 'reject' | 'review' | 'auto-add'
    confidence, reasoning, signals, model, screenedAt,
  },
  requestedAt, acceptedAt, dmSentAt,   // populated by later steps, not yet built
  history: []      // append-only state transitions with timestamps
}
```

**This is why Steps 2 and 9 are not heavy lifts.** They are different filters on the same table:

- Step 1 → writes new records
- Step 2 → `state = requested|pending`, sorted oldest-last
- Step 9 → `state = accepted AND dmSentAt = null AND acceptedAt < now - N days`

The ledger is also the **dedupe layer**. A permanent `rejected` record is what stops the same
unqualified people cycling back into the queue forever — a likely contributor to the old build's
decay.

---

## Step 1 pipeline: discovery and screening

Confirmed root cause of the prior build's decay: the AI screening step produced **false
negatives** on misspelled or variant phrasing — e.g. "real estatte investor" scored as no match
against "real estate investor" — rather than applying fuzzy tolerance.

**Revised 2026-08-31**, per Greg: the point of screening isn't literal keyword matching at all —
it's an AI forming a holistic judgment about a profile the way a person skimming it would ("oh,
Giuseppe Roberto links to giuseppebuyshouses.com — strong signal he's a real estate investor"),
using keyword matching only as a cheap free pass for the obvious cases. The pipeline, cheapest and
most reliable checks first:

1. **Exclude-keyword hard skip (fuzzy, no AI).** Checked first — e.g. "hard money lender",
   "mortgage broker" — fuzzy-matched (typo-tolerant), a hit is a permanent reject regardless of
   anything else. Pure cost-saving: runs before any AI call so an obvious non-match never costs
   anything. A false exclude just skips someone, a cheaper mistake than a wasted API call.
2. **Include-keyword shortlist — EXACT match only, no AI.** A verbatim (case/punctuation-insensitive)
   match against the user's include list is a free instant shortlist. Anything short of exact —
   typos, phrasing variants, zero literal overlap — always falls through to step 3. This is a
   cleaner fix for the original false-negative bug than trying to make fuzzy string matching smart
   enough to approximate human judgment: edit distance cannot understand that a squished domain
   name or an indirect clue is relevant, but the AI can.
3. **AI persona scoring — for everything else, always with links called out explicitly.** Profiles
   that weren't excluded or exactly matched go to Claude with the target-persona description, the
   full extracted profile text, AND a separate, explicit list of the profile's external links (a
   personal business website is a far stronger signal surfaced this way than left buried in a wall
   of text). The prompt instructs the model to judge holistically — not search for keywords — and
   must return structured `{confidence: 0-100, reasoning, signals}`, never a bare yes/no or free
   text. Every call and its response is logged, so a disputed rejection is always auditable instead
   of guessed at. Implemented in `lib/claude.js` (the API client) and
   `background/service-worker.js` (the tiering decision — DECIDE, not DO, per the split above).

Confidence bands, not a single threshold (both edges inclusive, per `lib/verdict.js`):

- `>= auto-approve threshold` (user-set slider, default 90%) → queued automatically for the
  assisted-click review list
- **middle band** (strictly between the two thresholds) → still surfaced for human review with the
  AI's reason attached, rather than silently discarded — this is what a pure high/low cutoff got
  wrong last time
- `<= reject floor` (user-set slider, default 25%) → permanent `rejected` in the ledger

Exclude-keyword and exact-include-keyword tiers get a deterministic verdict (`reject` /
`auto-add`) rather than running through this comparison at all, so they stay correct no matter
where the sliders are set.

The golden set (see below) must include known misspelling/variant cases from this exact bug class,
so a future prompt change can't reintroduce it silently.

**Test Mode** (carried over from the prior build, and promoted to a Phase 0 requirement, not an
extra): a global toggle that runs the entire pipeline — scan, fuzzy match, AI scoring, queueing —
but never clicks Add Friend or Send. This is how a prompt or selector change gets verified safe
before it touches a real profile.

**Provider decision:** Claude only for this rebuild (matches the stated stack), with the model ID
exposed as a setting, not a hardcoded multi-provider abstraction. Revisit only if a concrete need
for a second provider shows up.

---

## Scan volume vs. send volume vs. the queue (Greg's spec, 2026-08-31)

Three genuinely distinct numbers — all three now built:

1. **Scanned** — total profiles evaluated per day, regardless of verdict (`scanLimitsByDay`,
   default 80/day). This is `runDiscoveryBatch`'s `dailyLimit`.
2. **Queued** — the accumulating pool of people who've cleared screening and are waiting for a
   friend request: auto-added (AI verdict ≥ auto-approve threshold, or an exact-include match) PLUS
   whatever Greg manually approves out of the `needs_review` pile via the review queue
   (`sidepanel/review.html`). This pool has no daily cap of its own — it just accumulates.
3. **Sent** — friend requests actually released per day, capped by `caps.maxRequestsPerDayByDay`
   (per day of week, matching `scanLimitsByDay`'s pattern — made variable 2026-08-31, per Greg; was
   originally a single flat number for every day). This drains the queue at a steady daily rate,
   independent of how many got added to it that same day.
   Built as the **Send Queue** (`sidepanel/send.html`/`send.js`) — **assisted click by design**
   (Greg's explicit decision, D6): the extension never sends anything unattended, every request
   needs an explicit click there. The daily count is derived from the ledger's `requestedAt`
   timestamps (via `countRequestedToday`) rather than a separate counter, keeping the ledger the
   single source of truth — verified in a live browser JS engine against explicit dates spanning a
   day boundary. When a queued person is no longer rendered in Facebook's (virtualized) suggestions
   list — the same limitation already known from Remove — the Send Queue shows the real reason and
   a direct, clickable link to their profile (or to open a suggestions tab at all) so Greg can
   complete it manually rather than hitting a dead end.

   **"Process All" (2026-09-01), per Greg — a deliberate step beyond pure assisted click.** One
   button click now sends up to today's remaining limit automatically, one person after another,
   with a randomized 8-18s pause between sends and no per-person confirmation, until the cap is hit
   or the queue runs dry. Individual per-card sends are still pure assisted click; this is an
   explicitly-requested, opt-in automation layered on top, not a replacement for it — the daily cap
   is still the hard ceiling either way, and every send (assisted or Process All) still writes to
   the ledger identically. Reuses the exact same `sendThisOne()` logic as a manual click, so there
   is no separate, divergent send path to keep correct. Guarded by a `confirm()` dialog before
   starting (stating the exact behavior and count) and a Stop button that halts after the
   in-flight send finishes — the wait between sends is checked every 500ms so Stop takes effect
   within about half a second, not up to 18s late.

Concrete example from Greg: scan 80, 5 auto-queue, human approves 17 more from review → 22 added to
the queue that day. 10 friend requests release Monday (this day's send cap), 10 more Tuesday, and
so on — the queue keeps growing from ongoing scanning/reviewing even as it drains at the slower
send rate. This was the definitive spec for tasks 1.7/1.9/1.10, and all three are now built against
it exactly as specified.

**Fixed before it was ever wired to anything:** an earlier `MKT.act.clickAddFriend`, built in
Phase 0 before the per-candidate scoping pattern existed, grabbed the first Add Friend button
anywhere on the page — the identical bug already found and fixed for Remove. Replaced with
`MKT.act.sendFriendRequest(href, testMode)`, scoped to the specific candidate exactly like Remove,
verified against a synthetic two-person page that it can't cross-wire and click the wrong person's
button.

**Rejected candidates get dismissed from Facebook's own suggestions list** via its "Remove"
affordance, so they stop cluttering future scans instead of just sitting inert in the ledger. Built
2026-08-31: `MKT.act.removeCandidate` (verified against a synthetic two-person page that it can't
cross-wire and click the wrong person's Remove button), wired into `runDiscoveryBatch` immediately
after a *fresh* reject verdict (not a cached one — that would already have been attempted on an
earlier run), and gated by Test Mode like every other real click in the system.

---

## Step 9 — foundation started (2026-09-01)

Step 9 (queue an initial greeting DM to accepted friends who haven't been messaged) depends
entirely on knowing who has actually accepted a friend request — nothing in the pipeline tracked
this before today; `requested` was a dead end. That gap is now closed:

- **Detection signal, verified live against Aaron Bihl's real profile** (the first real friend
  request this extension ever sent, confirmed accepted the same day): once accepted, the Add
  Friend button is replaced by a `[aria-label="Friends"][role="button"]` element — plain, no
  dynamic name suffix (unlike Add Friend/Remove), confirmed it does not cross-match the "not yet
  accepted" selector. The Message button (`[aria-label="Message"][role="button"]`) was captured
  from the same real page at the same time, for the DM-sending step later.
- **`MKT.scrape.checkFriendStatus`** (`content/scrape.js`) — assumes the caller has already
  navigated to the target person's own profile page; reports only `{isFriend}`, since that's the
  one signal the orchestration actually needs.
- **`withProfileTab` / `checkAcceptances`** (`background/service-worker.js`) — walks everyone in
  `requested` state, opens each one's real profile in a background tab (mirroring `send.js`'s
  `sendViaProfilePage` pattern), checks status, cleans up the tab either way. Deliberately a
  separate on-demand step, not folded into the discovery batch — opening a background tab per
  person is meaningfully different work than screening a suggestions list. `withProfileTab` is a
  reusable "open a tab, let a callback send as many messages as it needs, always clean up" helper
  (generalized from an earlier single-purpose version — see stale-request cleanup below).
- **`markAccepted`** (`lib/ledger.js`) — `requested` → `accepted`, with `acceptedAt` set for the
  eventual "accepted more than N days ago" cohort filter from the original Step 9 spec.
- Side panel gained a **"Check Accepted Friends"** button, clearly labeled as new/foundational
  rather than blended into the polished Discover/Review/Send flow — doesn't need an active
  facebook.com tab the way scanning does, since it opens its own background tabs per person.
- **Stale-request cleanup, per Greg** — the time-based counterpart to the original Step 2 spec
  ("cancel outstanding requests"), which was volume-based (200/150) there. `settings
  .staleRequestDays` (default 14) controls it. Signal verified live against Obi Dike's real
  still-pending profile: `[aria-label^="Cancel Request "][role="button"]` — same dynamic-name-
  suffix pattern as Add Friend/Remove, confirmed mutually exclusive with the Friends/Add-Friend
  selectors. `MKT.act.cancelFriendRequest` (content) and `markCancelled` (ledger, `requested` →
  `cancelled`) check acceptance AND, if not accepted and stale, cancel — **in the same profile
  visit**, not two separate passes. The decision logic (accepted takes priority over staleness; the
  exact-14-days boundary stays within the window, only strictly past it cancels) was verified in a
  live browser JS engine before wiring in.

**Design simplified (2026-09-01), per Greg** — no AI drafting for the greeting DM. It's the existing
static `messageTemplates.intro` (Settings) with `{firstName}` substituted in, same mechanism as the
birthday template; once it's sent, Greg takes over the conversation directly, so there's no drafting,
review-of-drafts, or reply-detection step to build for Step 9 at all. This removes most of the
originally-scoped 2.2-2.4/2.7 work — Step 9 is now just: cohort query → render template → click
Message and send it.

- **`getDmCandidates(dmDelayDays)`** (`lib/ledger.js`) — the cohort query: `state === 'accepted'`,
  never DM'd (`!dmSentAt`), and accepted strictly more than `settings.dmDelayDays` days ago (exactly
  on the boundary still waits one more day), sorted oldest-accepted-first. Verified in a live browser
  JS engine across the boundary case, the already-messaged case, and the too-recent case.
- **`lib/template.js`** — `renderTemplate(template, person)`, a small shared helper (`{firstName}`
  substitution only, extracting the first whitespace-separated token of the scraped name). Verified
  against Aaron Bihl-style full names, a single-word name, a missing name, and a template using the
  token twice.
- **`markDmSent(id, message)`** (`lib/ledger.js`) — `accepted` → `dm_sent`, records the actual
  message text sent (not just that *a* message went out) so a disputed "what did we actually say" is
  auditable later, matching the discipline already used for AI screening calls.
- **New Settings field, `dmDelayDays`** (default 2, per Greg) — a deliberately separate setting from
  `staleRequestDays` even though both are day-count thresholds: one gates cancelling an unaccepted
  request, this one gates messaging an accepted one.
- **New side panel page, `sidepanel/dm.html`/`dm.js`** ("DM Queue") — lists the cohort, each card
  showing the person, days since acceptance, the exact rendered message they'd receive, and a "Send
  Message" button. Assisted click, matching D6's original reasoning (messaging is the more heavily
  policed surface) — no "Process All" equivalent built for this page.
- **Messenger composer automation, verified DOM (2026-09-01), from Aaron Bihl's real chat popup:**
  clicking Message opens an **in-page popup** (confirmed not a new tab, not an iframe). The composer
  is a Lexical rich-text editor (`div[contenteditable="true"][role="textbox"][aria-label^="Write to
  "]`), not a plain input — verified this doesn't cross-match the separate on-profile post composer
  (a different real element, whose label starts "Write something to..."). There is **no visible Send
  button in this UI** — confirmed live that pressing Enter is the only way to send.
  - `MKT.act.clickProfileMessage()` (content/act.js) — opens the popup. Not gated by Test Mode, same
    reasoning as clicking into a candidate's profile: opening a UI isn't the policed action.
  - `MKT.act.sendComposedMessage(text, testMode)` — uses `document.execCommand('insertText', ...)`
    rather than a raw DOM mutation, since Lexical (like most rich-text editors) keeps its own internal
    state synced off real browser input events; a raw mutation wouldn't update that state and Enter
    would likely send nothing or something stale. Verified the *mechanics* (insertText populating a
    generic contenteditable, a dispatched Enter KeyboardEvent being observed by a keydown listener) in
    a live browser JS sandbox — **not yet verified against Facebook's actual Lexical instance**, which
    is the one genuinely unverified piece and exactly the "highest-fragility surface" this doc already
    flagged. Test Mode here deliberately stops one step short of every other action's Test Mode: it
    still types the real rendered text (safe — nothing sends), just skips the Enter dispatch, so the
    hard-to-predict half can be checked with zero risk of an accidental real send before ever trying
    the full send live.
  - `SEND_DM` content-script message (content/content.js) — clicks Message, polls for the composer to
    actually render (`waitForComposer`, same reasoning as `waitForProfileUrl`), then calls
    `sendComposedMessage`. `sidepanel/dm.js`'s `sendGreetingDm` mirrors `send.js`'s
    `sendViaProfilePage` exactly (open the person's profile in a background tab, wait for load+settle,
    message the tab, clean up) — same shape of on-demand per-person action, so it follows the same
    pattern rather than introducing a new one.
  - `markDmSent(id, message)` / `countDmSentToday()` (lib/ledger.js) — records the actual message
    text sent (auditable later) and feeds a daily-limit banner reading `caps.maxMessagesPerDay`
    (already existed as a setting from Phase 0, unused until now).
  **Confirmed live (2026-09-01):** Greg tested this end to end (temporarily forcing `dmDelayDays` to
  0 to get immediate cohort matches) — `execCommand('insertText', ...)` correctly reconciles against
  Facebook's real Lexical editor, and the simulated Enter keypress actually sends. Step 9's greeting
  DM is proven, not just built.

  **Pacing added (2026-09-01), per Greg's observation from that test:** the whole message appearing
  instantly, then the tab closing immediately after, read as an obvious script rather than a person —
  the same "don't look bot-like" concern already addressed elsewhere (scroll pacing, 8-18s between
  Process All sends). `sendComposedMessage` now types one character at a time via repeated
  `execCommand('insertText', ...)` calls with a randomized human-typing cadence (occasional longer
  pause mixed in), pauses briefly before dispatching Enter, and pauses again for a few seconds after
  sending before returning — the caller closes the background tab as soon as the response comes back,
  so the pause has to live here, not in the caller. A type-then-paste hybrid (type up to where
  `{firstName}` was substituted, then paste the rest) was considered and rejected: the content script
  only ever receives the already-rendered plain text, so recovering the placeholder's boundary would
  mean threading extra information through the pipeline just to reintroduce a split that typing the
  whole message character-by-character avoids needing at all.

  **Two more real bugs found on the very next live test, same day:** the first character was
  silently dropped, and typing stopped about halfway through before the tab closed. Applied a
  best-effort (not confirmed root-cause) fix for the first: a settle delay after focusing before
  typing starts, plus re-asserting focus before every character, since this only reproduces against
  Facebook's real Lexical instance and can't be tested in a sandbox.

  The second turned out to have a confirmed root cause, found from the returned diagnostic detail:
  `sidepanel/dm.js`'s `sendGreetingDm` (mirroring `send.js`'s `sendViaProfilePage`) has a single
  timeout spanning the ENTIRE round trip — page load, opening the composer, and the actual typing —
  left at a fixed 15s from when the whole flow was near-instant. The moment human-like pacing was
  added, any non-trivial message legitimately took longer than that, so the leftover timeout fired
  mid-typing and force-closed the tab, misreported as a page-load failure. Fixed: the timeout now
  scales with message length (`20000 + text.length * 200`ms).

  **Confirmed live (2026-09-01):** Greg re-tested — types all the way through with no cutoff and no
  dropped character, message sends correctly. Step 9's greeting DM, pacing included, is genuinely
  live and proven end to end.

  **Daily cap enforcement fixed the same day, per Greg — applied to both Send Queue and DM Queue.**
  The cap was only ever reflected in the summary text/banner and in an all-or-nothing check at page
  load; nothing stopped several different cards' Send buttons being clicked in one sitting and
  crossing the cap before the banner caught up. Both pages' shared per-card send logic
  (`sendThisOne` in `send.js`; the equivalent in `dm.js`) now disables every other still-eligible
  card's button the instant a send crosses the cap. This also closes the gap for Send Queue's
  "Process All," which already re-checked the cap every loop iteration but relied on the same
  underlying fix to actually stop a manual click from working around it.

---

## Settings schema

Reconstructed from the prior build's settings pages, since it already reflects real usage:

**Discovery**
- Target persona description (free text; can be generated from the keyword lists below)
- Include keywords (one per line) — fuzzy-matched, auto-shortlist, no AI needed
- Exclude keywords (one per line) — fuzzy-matched, hard skip, checked before any AI call
- AI auto-add confidence threshold (slider, default 90%)
- Daily scan match limits — **per day of week**, independent of the send caps below (this is "how
  many candidates to find," separate from "how many requests to actually send")

**Sending**
- Max friend requests per day (recommended range 5–15; Facebook's own soft pending-request ceiling
  is ~200, which is also why Step 2 exists)
- Max messages per day (recommended range 5–15 — messaging is the more heavily policed surface)
- Message templates: introductory DM, birthday message — `{firstName}` token substitution, AI may
  draft around these but the template is the user-approved skeleton

**Timing**
- Minimum / maximum delay between actions (seconds) — randomized within this band, never a fixed
  interval
- Spread queue over N hours — the day's approved queue is distributed across a window rather than
  fired back-to-back, so activity looks like a person working through a session, not a script

**Safety**
- Test Mode toggle — see above
- Auto-send toggle, off by default — when off, matches are queued for the assisted-click review
  list rather than sent unattended

---

## Repo location — RESOLVED

This project now lives at `C:\dev\marketing-extension`, moved out of Google Drive for Desktop on
2026-08-31 before `git init`. Google Drive continuously syncs files mid-write; Git's `.git`
directory does many small rapid writes, and a sync grabbing a half-written object is a known
cause of a corrupted repo. GitHub is the sync/backup mechanism going forward, not Drive.

---

## Claude API integration

- **Direct browser calls** require the header `anthropic-dangerous-direct-browser-access: true`.
- **Key storage:** entered once in Settings, held in `chrome.storage.local`. **Never** in the repo.
  `.gitignore` plus a pre-commit check so a key can never get committed.
- **If the extension is ever shared with staff:** move the key behind a small proxy (Cloudflare
  Worker) so it is never distributed. Single-user v1 does not need this.
- **Model ID is a setting, not a constant** — model IDs get retired; a hardcoded one is a time bomb.
- **Structured output only** — tool use / JSON schema, every field validated, malformed responses
  rejected and retried rather than passed downstream.
- **Response cache** keyed on a profile signature so the same person is never screened twice.
- **Every request and response logged**, so "bad results" is always auditable after the fact.
- **Golden set:** roughly 20 hand-labeled profiles, re-run after any prompt change to prove the
  change did not make screening worse. This is the discipline that prevents silent quality decay.

Client financial data and client PII never touch this system. It handles only publicly-rendered
Facebook profile information about prospects.

---

## Known technical hazards

1. **Selector rot.** Facebook ships obfuscated, rotating class names. Mitigation: one selectors
   file; prefer semantic anchors (`[aria-label*="Add friend"]`, ARIA roles, visible text) over
   class names; the "Diagnose" button self-tests every selector against the live page and names
   exactly what broke.
2. **MV3 service worker termination.** The background script is killed after roughly 30s idle and
   any in-memory variable vanishes. All state persists to storage; use `chrome.alarms`, never
   `setTimeout`, for anything longer than a few seconds.
   **Live, real, currently untested risk (2026-08-31):** the discovery batch loop (`lib/ledger.js`
   + `runDiscoveryBatch` in `background/service-worker.js`) can run for several minutes across
   many candidates, entirely inside one message handler. It's not confirmed whether Chrome kills
   the service worker mid-batch under real conditions. Designed around the risk rather than
   assuming it away: every candidate is written to the ledger the moment they're screened, not
   buffered until the end, so a mid-batch kill loses nothing already-completed — re-running the
   batch just resumes via dedupe. If real testing shows this is a frequent problem, the proper fix
   is `chrome.alarms`-driven incremental resumption rather than one long-running call; not built
   yet since it's speculative complexity until proven necessary.
3. **Virtualized lists.** The suggestions feed renders only what is on screen. Naive scraping
   returns about 8 results and stops. Needs incremental scroll-and-collect with a stable dedupe key.
4. **Resumability.** Extension reloads kill in-flight work. Every action is idempotent and marked
   in the ledger before *and* after execution, so a half-finished run can resume safely.
5. **Storage is not backup.** Uninstalling the extension wipes `chrome.storage.local`.
   Export/import of the ledger is a Phase 0 requirement, not a nice-to-have.
6. **Fuzzy-match false negatives — confirmed root cause of the prior build's decay.** Exact
   substring matching rejects real matches over trivial typos or phrasing variants. See "Step 1
   pipeline" above; the fix is fuzzy comparison at the keyword tier and explicit typo-tolerance
   instructions plus a golden set at the AI tier.

---

## Platform and account risk (read once, decide deliberately)

Automating friend requests and direct messages is **against Facebook's Terms of Service.** This is
not a theoretical concern. Realistic consequences, in escalating order:

- Friend-request ability suspended for days to weeks
- Messaging restricted (Facebook polices messaging far more aggressively than friend requests)
- Checkpoint / ID verification demanded
- Worst case: loss of the personal account, and with it admin access to the business Page

Because the firm's Page and professional reputation live on that account, this is a **business
risk**, not only a technical one. The design mitigates it by choice:

- Conservative, user-set daily caps
- Human approval gates on anything outbound — always on DMs; friend requests get a per-batch
  confirmation (and a Stop button) via "Process All" rather than a per-person click, since Greg
  explicitly chose to move that surface toward automation on 2026-09-01 (see "Sent" above) — worth
  being honest that this is less conservative than pure assisted click, even though the requests
  going out and the daily cap enforcing them are unchanged
- Randomized, human-paced timing; never faster than a person could plausibly click
- Only runs while Greg is at the machine, never unattended overnight
- Immediate hard stop on any checkpoint, error, or unexpected page state

This build does **not** include anti-detection or evasion tooling. The volume dial is Greg's to set,
with the downside understood.

---

## Build order

| Phase | Deliverable | Why in this order |
|---|---|---|
| **0** | Skeleton, storage, logger, settings, Claude client, Diagnose | Nothing above is debuggable without it |
| **1** | Step 1 — friend discovery, end to end | First endpoint. Proves scrape + AI + queue + act. |
| **2** | Step 9 — greeting DM, end to end | Second endpoint. Reuses the entire Phase 1 spine. |
| **3** | Steps 2, 3, 4, 6, 7, 8 | Mostly new filters over plumbing that already exists |
