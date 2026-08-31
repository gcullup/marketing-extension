# Workflow Map — Facebook Marketing Extension

**Purpose:** single source of truth for what is built, what is next, and what is still undecided.
Update this file at the end of every working session.

- **Last updated:** 2026-08-31
- **Repo location:** `C:\dev\marketing-extension` (moved off Google Drive)
- **GitHub:** https://github.com/gcullup/marketing-extension
- **Current phase:** Phase 0 — Architecture & Setup (no code written yet)
- **Active endpoint:** Endpoint 1 (Step 1 — Friend Discovery)

---

## Legend

| Mark | Meaning |
|---|---|
| `[ ]` | Not started |
| `[~]` | In progress |
| `[x]` | Built and verified working |
| `[!]` | Blocked or needs a decision from Greg |
| `[-]` | Deliberately out of scope / deferred |

---

## Phase 0 — Foundation & Setup

*Nothing in Phases 1+ can be debugged without this. Do not skip.*

- [x] 0.1 Confirm scope & architecture (this session)
- [x] 0.2 Write ARCHITECTURE.md
- [x] 0.3 Write WORKFLOW-MAP.md (this file)
- [x] 0.4 **Move repo out of Google Drive** → now at `C:\dev\marketing-extension`
- [x] 0.5 `git init`, `.gitignore`, first commit
- [x] 0.6 Create private GitHub repo, push → https://github.com/gcullup/marketing-extension
- [x] 0.7 Extension skeleton: `manifest.json` (MV3), folder layout — manifest, background service
      worker, content scripts (selectors/scrape/act placeholders, wired for messaging), side
      panel with a live storage + content-script ping test, settings placeholder
- [x] 0.8 Load unpacked in Chrome, confirm it appears and the side panel opens — verified: side
      panel loaded storage defaults, and the ping round-trip (panel → content script → panel)
      correctly returned the live facebook.com page's URL and title
- [x] 0.9 Storage layer (`lib/store.js`) — versioned schema, export/import backup (built alongside skeleton)
- [x] 0.10 Logger (`lib/log.js`) — ring buffer, recorded + exportable via storage dump; a viewer UI
      piggybacks on the settings page (step 0.12)
- [x] 0.11 `lib/fuzzy.js` — fuzzy string matching for include/exclude keyword tiers, fixing the
      confirmed root cause of the prior build's false negatives. Verified in a live browser JS
      engine against the exact reported bug case ("real estatte investor" → matches "real estate
      investor" at ~95% similarity) plus 5 other include/exclude/no-match cases — 6/6 passed.
      Pure logic, no chrome.* dependency, so it's testable in isolation.
- [x] 0.12 Settings page — target persona, include/exclude keyword lists, confidence threshold
      slider, daily scan match limits per day of week, send caps, message templates (`{firstName}`
      token), timing, Claude API key + model ID, Test Mode / auto-send toggles, plus export/import
      backup and a log viewer. Storage schema in `lib/store.js` expanded to match.
      **Real-world test by Greg found a genuine bug**: this install already existed from the
      Phase 0 skeleton test, predating the expanded schema. `initSettingsIfMissing()` only wrote
      defaults when the storage key was *entirely* absent, so the new fields (scan limits, message
      templates, higher caps) came back `undefined`, the form's fallbacks silently substituted
      wrong values (blank templates, all-zero scan limits, old lower caps), and clicking Save wrote
      those wrong values back permanently. Confirmed by diffing Greg's exported backup JSON against
      the intended defaults. **Fixed:** `getSettings()` now deep-merges any genuinely missing field
      from `DEFAULT_SETTINGS` into what's stored (self-healing on every read, verified in a live
      browser JS engine against both the actual damaged data and a simulated "old install gets a
      brand-new field" case — real customizations survive, true gaps backfill). This does NOT
      un-damage fields that already hold an explicit wrong value (they're not "missing" anymore) —
      added a **Reset to Defaults** button (repopulates the form only; nothing saves until you
      click Save Settings) as the actual remedy for the already-damaged data.
      **Follow-up, confirmed not a bug:** Greg fixed the scan-limit grid by typing values in
      directly rather than using Reset to Defaults — that's expected behavior (already-present
      values, even wrong ones, are left alone by design; only Reset or manual entry overwrites
      them). Message templates remain blank pending Greg using Reset or entering his own wording.
- [ ] 0.13 Claude API client (`lib/claude.js`) — structured output, validation, retry, response cache
- [ ] 0.14 `selectors.js` — ALL Facebook DOM selectors isolated in one file (currently placeholders,
      see content/selectors.js — unverified against the live DOM)
- [ ] 0.15 **"Diagnose" self-test button** — checks every selector against the live page, reports which broke
- [ ] 0.16 **Test Mode** — full pipeline runs (scan → fuzzy match → AI score → queue) without ever clicking Add Friend or Send

**Note on Node.js:** this machine has no Node.js installed. Not a blocker — this extension
deliberately uses plain browser-native ES modules with no build step or bundler, so nothing here
requires it. `lib/fuzzy.js` was verified by running its real source in a live browser JS engine
instead. Flagging only so it doesn't surprise anyone reaching for `npm` later.

---

## Phase 1 — ENDPOINT 1: Step 1, Friend Discovery & Queueing

**Confirmed mechanism (2026-08-31, from Greg, from the old tool):** `facebook.com/friends/suggestions`
is a two-pane layout. The left-pane cards (verified against live DOM — see below) carry only a
name, photo, and mutual-friend count; there is no bio/occupation text to keyword-match against at
that level. The old tool clicked into each candidate, which loads their profile detail into a
**right-hand pane**, then scrolled that right pane a **randomized number of times (5, 15, or 25 in
the old tool)** to load enough content and to mimic human behavior — there's no reliable "end" to
detect, hence the randomization rather than a fixed count. Bio/work/about text is read from that
right pane, not the left list. This is a click-into-detail-then-scroll pattern, not a
scroll-the-feed pattern — task 1.1 below is revised accordingly.

**Verified against live DOM (2026-08-31, from Greg's pasted outerHTML) — left-pane list item:**
- Add Friend button: `div[role="button"][aria-label="Add friend" i]` — **must exclude
  `[aria-hidden="true"]`**. Facebook renders a hidden decoy copy of this button (and of the
  post-request "Remove" button) for animation purposes; the real interactive one has `tabindex="0"`,
  the decoy has `aria-hidden="true" tabindex="-1"`. Selecting the decoy would silently click nothing.
- Candidate name + profile link: `a[role="link"][aria-label]` whose `aria-label` is the bare person
  name — distinguishable from mutual-friend avatar links, which are prefixed
  `"Profile picture of ... who is a mutual friend"`. `href` includes a `?__tn__=...` tracking
  param on the photo link; a second, cleaner `href` (no query string) exists on the name-text link.
- Mutual friend count: plain visible text matching `/^\d[\d,]* mutual friends?$/` — no selector
  needed, just a text-pattern match.
- All three selectors above were tested by injecting Greg's actual pasted markup into a sandbox DOM
  and running the real `querySelectorAll` calls (not just eyeballed): the Add Friend selector
  matched exactly the one real button and correctly excluded both hidden decoys, the profile-link
  selector matched exactly Michele's own link and excluded both mutual-friend avatar links, and the
  mutual-friends pattern correctly caught "150 mutual friends". Written into `content/selectors.js`.
**Extraction approach revised (2026-08-31, from Greg):** the old tool did NOT dissect individual
Intro-box fields (confirmed fragile — Greg pasted one Intro line and it was just "Female", with no
selector able to distinguish it from a work/location line; Facebook doesn't label these). Instead
it scraped **all visible text off the scrolled profile page** and let keyword/AI matching find
industry signal wherever it appeared — often posts, sometimes Intro-box snippets bleeding into the
main view without visiting the separate `/about` tab. This sidesteps the fragile-field problem
entirely and matches what already worked before (the confirmed bug was in the *matching* logic,
not the *extraction* — see [[fb-marketing-extension-rebuild]]'s fuzzy-matching finding). Adopting
the same raw-text approach here rather than building brittle per-field selectors.

**Layout confirmed (2026-08-31):** clicking a candidate's name is a true split view — the
suggestions list stays visible and clickable the whole time; the URL updates (e.g. to
`facebook.com/michele.s.bastone`) but nothing is a full navigation away from the list. So there are
two independent scrollable regions (the candidate list, and the detail pane), not one page scroll.

**Scroll containers confirmed live (2026-08-31), via a DevTools console snippet using Chrome's
`$0` shorthand rather than another large HTML paste:**
- List: a bare `<div>` with an obfuscated class, no `role`/`aria-label` — no stable selector
  exists. Resolved by discovering it **algorithmically at runtime** instead: walk up
  `parentElement` from a known-good anchor (`candidateProfileLink`) until `overflowY` is
  `auto`/`scroll` and `scrollHeight > clientHeight`. Verified against a synthetic DOM in a live
  browser JS engine — correctly found the real scrollable ancestor, not an intermediate wrapper.
- Detail pane: the scrollable ancestor is `<html>` itself (`document.scrollingElement`) — it's a
  normal whole-page/window scroll, not a nested container. Much simpler than the list.

**Built into real code (not placeholders) in `content/scrape.js` and `content/act.js`:**
`findScrollableAncestor` (the algorithm above), `isProfileUrl` (bare-profile-path detection,
verified against 6 real/realistic URLs including the actual `?__tn__=...`-suffixed one Facebook
sends), `listCandidates`, `getListScrollContainer`, `scrollList`, `scrollDetailPane`,
`extractVisibleText` (whole-page text, matching the old validated approach — no per-field
parsing), `clickCandidate`, `clickAddFriend` (Test-Mode-aware).

**Read-only "Test Scrape" button added to the side panel** (`panel.html`/`panel.js` +
`TEST_SCRAPE` message in `content.js`) so Greg can verify the list-detection and scroll-container
logic against the live page **without clicking Add Friend or navigating anything** — reports
candidate count, first 5 names/hrefs found, and whether a list scroll container was located.
**Real bug found by Test Scrape on the live page (2026-08-31):** `candidateProfileLink`
(`a[role="link"][aria-label]`) is too broad — it also matches Facebook's own top nav bar (Home,
Reels, Groups, Gaming, ...), which uses the identical pattern. Live test returned those 4 nav
links as "candidates" instead of real ones. **Fixed:** `listCandidates` and
`getListScrollContainer` now anchor on the **Add Friend button** instead (nav bar has no such
button — no false positives possible there) and walk up from each button to find its associated
profile link via `findAncestorContaining`, rather than scanning the whole page for a link pattern
that turns out not to be unique. Verified against a synthetic page containing both a 4-item fake
nav bar and one real candidate card — correctly found only the real one.
**Confirmed fixed on the live page (2026-08-31):** re-ran Test Scrape — 10 real candidates found
(Vincent Fitapelli, Peter Hlampeas, Edward Rush Coleman, Mike Perdue, Trevor Pontillo, ...), real
profile URLs, zero nav-bar false positives, scroll container located. Candidate detection is solid.

**Next unknown to test:** whether a programmatic `link.click()` actually triggers Facebook's SPA
navigation the same way a real user click does — not safe to assume (some sites gate interactive
elements on `event.isTrusted`). Added a **"Test Click First Candidate"** button — this one is NOT
read-only, it actually clicks and navigates to a real profile (harmless, equivalent to Greg
clicking it himself; does not touch Add Friend). Polls `isProfileUrl` for up to 6s after the click
and reports elapsed time / success.
**Confirmed live (2026-08-31):** programmatic click worked — navigated to Steven Enns's profile in
251ms. No `event.isTrusted` gating issue on this element.

**Next: full single-candidate read path.** Added **"Test Full Candidate Scrape"** — click first
candidate → wait for navigation → scroll the detail pane a randomized 5/15/25 times (matching the
old tool, with small randomized delays between scrolls) → extract all visible text → report length
+ a 500-char preview. This is task 1.1's entire read side for one candidate, chained end to end.
Still no Add Friend click.

**Real bug found live (2026-08-31):** `textPreview` came back as entirely left-hand-list noise
("50 mutual friends / Add friend / Remove", repeated per visible candidate) with none of Mike
Perdue's own content — `document.body.innerText` grabs the whole page, and the persistent list
(confirmed split-view, still fully attached) sits earlier in the DOM, drowning out the signal.
**Fixed:** `extractVisibleText` now accepts the list's scroll container and temporarily sets its
`visibility: hidden` before reading `innerText` (excluded from the rendered-text computation),
then immediately restores it. Verified in a live browser JS engine against a synthetic page
mirroring the real shape: correctly dropped the list noise, kept the real content, and confirmed
visibility was restored afterward, not left stuck hidden.

**Scrolling realism improved, per Greg's concern about looking bot-like:** the original version
scrolled a fixed, identical 900px via an instant (non-animated) jump every single time — about as
uniform a signature as a detector could ask for. Now: randomized distance per step (150–950px),
`behavior: 'smooth'` animated scrolling instead of an instant jump, a `scrollend`-based wait
(adapts to actual animation time rather than a guessed delay), and a 15% chance per step of a
longer "reading pause" (1.5–3s) instead of uniform short gaps. **Being direct about the limits of
this:** this narrows the gap versus real scrolling at the DOM-event level, but it is not a claim of
undetectability — the bigger, higher-leverage protection is session-level pacing (daily caps,
spread-over-hours, human-paced gaps between actions), which the architecture already covers. Volume
and rate matter more than the physics of one scroll gesture.

**Confirmed fixed and validated end-to-end on the live page (2026-08-31):** re-ran against Giuseppe
Roberto's profile — real content came through this time: a "Real Estate" category tag, a personal
website (`giuseppebuyshouses.com`), relationship/family details, mutual friends. List noise
correctly excluded.

**Full pipeline validated with real captured data, not synthetic:** ran this exact text through
`lib/fuzzy.js` in a live browser JS engine. "real estate" matched correctly (the category tag).
"real estate investor" alone did not — a 3-word keyword only compares against 3-word windows, and
the profile just says the 2-word "Real Estate", so window-length mismatch, not a bug; this is
exactly why the settings design already has Greg list multiple keyword lengths/variants
("real estate investor", "REI", "property investor") as separate lines rather than relying on one
phrase. "buys houses" did not match the domain `giuseppebuyshouses.com` (one unbroken token, no
spaces to split on) — an acceptable, known limit of the cheap fuzzy tier, which is exactly why the
AI screening tier exists as the catch-all second pass. Exclude keywords correctly did not
false-positive. **This is the first fully-real, end-to-end proof of the Step 1 read path.**

- [x] 1.1 (read path) Content script: click candidate, detect navigation via `isProfileUrl`,
      human-like randomized scroll, extract visible text excluding list noise — **built, verified
      live against multiple real profiles, and validated end-to-end through the fuzzy matcher**.
      Remaining for 1.1: the orchestration loop that walks the FULL candidate list (not just the
      first one) and loads more via `scrollList` as it goes (virtualized-list handling).

**Screening tier design corrected (2026-08-31), per Greg:** "fuzzy match" as originally built
missed the point — what Greg actually wants is the AI reading the *totality* of a profile
holistically ("oh, Giuseppe Roberto links to giuseppebuyshouses.com — strong signal he's a real
estate investor"), not string-distance tricks trying to approximate that. Revised design:
- **Exclude keywords:** stay fuzzy-matched (typo-tolerant) — pure cost-saving hard-skip before any
  AI call. Unchanged; this side wasn't part of the correction.
- **Include keywords:** now EXACT match only — a free instant shortlist, no AI call. Anything short
  of exact (typos, phrasing variants, zero literal overlap) always falls through to the AI. This is
  a cleaner fix for the original false-negative bug than leaning on fuzzy matching for includes:
  edit distance can't understand a squished domain name or an indirect clue, but the AI can.
  `matchesAnyExact`/`exactIncludes` added to `lib/fuzzy.js`.
- **AI call always receives extracted external links as an explicit, separate field**, not just
  buried in the text blob — a personal business website is a much stronger, more legible signal
  surfaced this way. `MKT.scrape.extractExternalLinks` added to `content/scrape.js` (filters out
  Facebook's own domains and the persistent list's own links), verified in a live browser JS engine
  against a synthetic page containing list noise, Facebook-internal links, and one real external
  link — correctly kept only the real one.
- **`lib/claude.js` built**: real Anthropic Messages API client, forced tool-use for structured
  output (`{confidence, reasoning, signals}`), throws rather than fabricating a result on any
  failure (missing key, network error, schema mismatch) — same discipline as the rest of the
  Claude integration (see ARCHITECTURE.md).
- **Tiering logic now lives in `background/service-worker.js`** (`SCREEN_CANDIDATE` message
  handler) — exclude → exact-include → AI, in that order — matching the DECIDE/DO split: content
  script only scrapes raw text/links, background owns the decision.
- **Verified against real Giuseppe Roberto data**: his real captured text does NOT exactly match
  Greg's actual include list (`real estate investor`, `REI`, `property investor`) — confirmed it
  correctly falls through to the AI tier rather than either false-approving or staying silent.
  Giuseppe is exactly the case this redesign targets.
- **Added "Test AI Screening" button** to the side panel — chains the existing full-candidate
  scrape into the new `SCREEN_CANDIDATE` background logic and displays the tier + result.
  **Pending: Greg adds a real Claude API key + model to Settings, then tests live** — this is the
  first piece that needs a real API key; nothing so far has required one.

**Confirmed live with a real Claude API call (2026-08-31):** tested against Jay Fayz
(`facebook.com/JayFayzMD`) — correctly fell through to the AI tier, which returned confidence 8/100
with reasoning that specifically distinguished him as real-estate-*adjacent* (Managing Director of
a fix-and-flip/DSCR lending firm) from the actual target persona (independent inspectors/
appraisers) — a nuanced judgment no string-matching tier could make. Model used: Greg's configured
`claude-haiku-4-5-20251001` (a sensible cheap/fast choice for high-volume screening). **This is the
first fully-real, end-to-end proof of the complete screening pipeline**, not just the read path.

**Gap identified, not yet built:** the `SCREEN_CANDIDATE` handler returns the raw AI result but
does not yet apply the three-band verdict logic (auto-add / middle-band review / reject) from
ARCHITECTURE.md — Settings currently only has one threshold (the 90% auto-add slider), not a
separate reject floor needed for the middle band. This is task 1.6, still open.

- [ ] 1.1 Content script: click each left-pane candidate in turn, wait for the right pane to load
      (detected via `isProfileUrl`), scroll it a randomized number of times (mirroring the old
      tool's 5/15/25 pattern), then grab all visible text from that pane as one blob — primitives
      built above; **still needed: the orchestration loop that sequences click → wait-for-load →
      scroll → extract → move to next candidate**, which belongs in the background service worker
      per the DECIDE/DO split, plus a real answer for "how do we know the profile finished loading"
      (candidate: poll until extracted text stops growing, or a fixed delay — untested either way)
- [ ] 1.2 Normalize each candidate into a Person record (stable ID = profile URL/ID, never name)
- [ ] 1.3 Person Ledger written to storage with dedupe (never re-surface a decided person)
- [ ] 1.4 Fuzzy include-keyword shortlist + fuzzy exclude-keyword hard skip (no AI cost either way)
- [ ] 1.5 Claude screening call for the remainder — batched, structured `{confidence, reason}`,
      prompt explicitly instructs typo/variant tolerance
- [ ] 1.6 Confidence-band logic: auto-add threshold / middle-band human review / reject floor
      (no bare yes/no cutoff — this is what produced last time's false negatives)
- [ ] 1.7 Daily scan match limits (per day of week) + daily send caps, independent counters,
      reset at local midnight
- [ ] 1.8 Side panel review queue — see candidate, AI reason, Approve / Skip
- [ ] 1.9 Execution: send the friend request (assisted click — you click, extension queues/paces)
- [ ] 1.10 Timing: randomized min/max delay, spread queue over N hours, abort on checkpoint
- [ ] 1.11 Golden-set eval: ~20 hand-labeled profiles **including known misspelling/variant cases**
      from the confirmed prior bug, re-run after any prompt change
- [ ] 1.12 End-to-end dry run in Test Mode, then one real low-volume day
- [ ] 1.13 **ENDPOINT 1 SIGNED OFF**

---

## Phase 2 — ENDPOINT 2: Step 9, Initial Greeting DM

- [ ] 2.1 Cohort query: accepted >= N days ago, never DM'd, not recently requested by us
- [ ] 2.2 Tone guide + message template captured in settings
- [ ] 2.3 Claude drafts opener referencing a real profile detail; hard length/tone constraints
- [ ] 2.4 Draft review queue — read, edit, approve, or reject each message
- [ ] 2.5 Messenger composer automation (highest-fragility surface in the system)
- [ ] 2.6 Per-message approval gate + low daily cap
- [ ] 2.7 Ledger state updates: `dm_sent`, reply detection if feasible
- [ ] 2.8 **ENDPOINT 2 SIGNED OFF**

---

## Phase 3 — Remaining Steps (deferred; mostly filters over existing plumbing)

- [ ] 3.1 Step 2 — Cancel outstanding requests down to 150 when over 200, oldest-last first
- [ ] 3.2 Step 3 — Content generation for personal page / business page / story / group
- [ ] 3.3 Step 4 — Group invitations
- [-] 3.4 Step 5 — Group invite reminders *(likely not reliably automatable; plan as checklist)*
- [ ] 3.5 Step 6 — Reminder to authentically interact with content (checklist only, by design)
- [ ] 3.6 Step 7 — Birthday messages via Facebook's birthday interface
- [ ] 3.7 Step 8 — Reminder to review incoming friend requests (manual by design)
- [ ] 3.8 Daily dashboard tying all steps into one run-through

---

## Resolved Decisions

- [x] D1 Target industry is **user-defined in Settings** (not hardcoded), since Greg may adapt it
      over time. Default persona for initial build/testing: *"Real estate inspectors and/or
      appraisers — US-based, owning their own company."*
- [x] D2 Day-of-week quotas are **user-definable in Settings** — both the daily *scan match limit*
      (candidates found) and the daily *send cap* (requests actually sent) are separate per-day
      numbers, not one fixed constant.
- [x] D3 Root cause of prior "bad results": the AI screening step returned **false negatives** on
      misspellings/variants (e.g. "real estatte investor" not matching "real estate investor")
      instead of applying fuzzy logic. Directly informs the Step 1 pipeline redesign above.
- [x] D4 Prior build successfully automated prospect identification/scraping itself — the failure
      was in the matching/scoring logic, not the scraping mechanics.
- [x] D5 **Personal profile only** — no business Page automation.
- [x] D6 **Assisted click** for friend requests — extension screens, scores, and queues; Greg clicks.

## Open Decisions — need Greg's input

- [!] D7 Risk tolerance / actual cap numbers — defaults recommended in Settings (5–15/day for both
      requests and messages, matching the prior build's own recommended range), but Greg sets the
      real numbers before the first live run.

---

## Session Log

| Date | Phase | What happened |
|---|---|---|
| 2026-08-31 | 0 | Scope confirmed, architecture drafted, workflow map created. No code yet. Flagged Google Drive repo-location risk. |
| 2026-08-31 | 0 | Moved repo to `C:\dev\marketing-extension`. Reviewed prior build's settings pages (screenshots). Confirmed root cause of old bug: fuzzy-matching false negatives. Resolved D1–D6; redesigned Step 1 into a three-tier fuzzy-keyword + AI pipeline with confidence bands. Added Test Mode as a Phase 0 requirement. Switched session to Sonnet for implementation work. |
