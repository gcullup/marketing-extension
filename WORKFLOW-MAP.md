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

**Gap closed (2026-08-31) — task 1.6 done:** added a second Settings slider, "Auto-deny at or
below" (`rejectFloor`, default 25, per Greg — auto-approve stays 90), plus save-time validation
that the reject floor must be lower than the auto-approve threshold. `lib/verdict.js` added
(`computeVerdict`, pure logic) and verified in a live browser JS engine across all boundary cases
(8→reject, 25→reject, 26→review, 89→review, 90→auto-add, 100→auto-add — inclusive on both
threshold edges). Wired into `SCREEN_CANDIDATE`: exclude/exact-include tiers get a deterministic
verdict (`reject`/`auto-add`) rather than running through the threshold comparison, so they stay
correct regardless of slider settings; the AI tier's confidence now runs through `computeVerdict`.
Also fixed a leftover copy bug in the existing slider's hint text (it described the exact opposite
of what auto-approve does). Re-running Jay Fayz's real result (confidence 8) through this now
correctly yields `verdict: "reject"`.

- [x] 1.1 Orchestration loop built (2026-08-31): `content/content.js` refactored so the click →
      wait-for-navigation → scroll → extract sequence (`scrapeCandidateProfile`) takes an explicit
      `{name, href}` instead of always assuming "whoever's first" — used by both the manual test
      button and the new loop. New content messages: `GET_CANDIDATE_LIST` (full, unsliced list),
      `SCROLL_LIST` (loads more of the virtualized list), `SCRAPE_CANDIDATE` (generalized
      single-candidate scrape). `runDiscoveryBatch` in `background/service-worker.js` drives it:
      walks the list in order, screens each new candidate through the same `screenAndRecord` path
      as the manual button (refactored out of the old inline `SCREEN_CANDIDATE` handler so both
      share one implementation), scrolls the list to load more when it runs out, and stops on
      today's day-of-week scan limit (`settings.scanLimitsByDay`), list exhaustion (2 consecutive
      no-growth reads after scrolling), or a defensive safety cap (300 candidates / 20 minutes).
      Already-known candidates are skipped almost for free (cache hit at the content-script level,
      per the earlier dedupe-timing fix) and don't count against the daily limit. Day-of-week
      mapping and the list-exhaustion detection logic verified in a live browser JS engine against
      scripted date/sequence cases before wiring in. **Open, real risk, not yet tested against a
      real multi-person batch:** MV3 can kill the background service worker after ~30s of no
      extension-API activity, and a full batch can run for several minutes — see
      ARCHITECTURE.md hazard #2. Designed to degrade safely if this happens (every candidate is
      written to the ledger immediately, not buffered), but whether it actually gets killed
      mid-batch in practice is unknown until Greg runs a real batch.

**Confirmed live (2026-08-31), first real batch run:** completed in one shot with a scan limit of
3 — no sign of the MV3 service-worker being killed mid-run, `stoppedReason: "daily_limit_reached"`
as expected. This run only needed the candidates already visible (no list scrolling required), so
it's not yet a real stress test of the MV3 risk above — that needs a larger batch or one that
exhausts the visible list.

**Second real false-negative bug found and fixed, same session (2026-08-31):** `extractProfileId`
only read a profile's URL *path*. Anyone without a custom Facebook username uses the shape
`facebook.com/profile.php?id=NNNN` — the path is just `/profile.php` for every such person, so the
path segment alone collapsed **every numeric-ID profile onto the identical id `"profile.php"`**.
In this exact batch run, three genuinely different people (Andrew Lee, Angel Ramos, Zac Smith)
were silently reported as `skipped`/already-cached, when in fact none of them had ever been
screened — they were colliding with an unrelated earlier test subject (Dave Snider) who happened
to hit that same bogus shared id first. This is the same failure category as the original
fuzzy-matching bug from this morning: a real candidate silently dropped rather than making noise
about it. **Fixed:** `extractProfileId` now reads the real numeric id out of the `id` query
parameter for `profile.php` URLs specifically. Verified in a live browser JS engine: reproduced
the exact collision with the buggy version first, confirmed the fix resolves it, and confirmed
normal username-style URLs (Giuseppe, Jay Fayz) are unaffected. The stale `"profile.php"` ledger
entry (holding Dave Snider's data) is now orphaned dead data — harmless, never looked up again
under the new key scheme; Dave gets correctly re-screened under his real id next time he comes up.

**Third real bug, same retest (2026-08-31):** the retest batch reached Jay Carrillo, then the whole
batch aborted with "Claude response failed schema validation" — a single flaky Haiku response
(confirmed this can happen live, not hypothetical) propagated straight out of the loop and killed
the run, abandoning Andrew Lee and everyone after him without even trying them. Two real gaps,
both fixed:
- `lib/claude.js` never actually implemented the retry-on-malformed-response behavior that
  ARCHITECTURE.md had described as the design intent from the start — verified the retry control
  flow in a live browser JS engine (recovers after one transient failure; surfaces both error
  messages if it genuinely fails twice) before wiring it into `screenCandidate`.
- `runDiscoveryBatch`'s per-candidate work is now wrapped in its own try/catch — one candidate's
  persistent failure (even after the retry) is recorded as an error entry in `results` and the
  batch continues to the next candidate, rather than aborting everything after it. A failed
  candidate isn't written to the ledger, so it's naturally retried on the next batch run rather
  than being permanently skipped.

**Pending: Greg re-runs a batch and confirms (a) previously wrongly-skipped numeric-ID profiles
now get properly screened, and (b) a batch survives a single flaky AI response without aborting.**

**Confirmed: all fixes hold under a real, larger batch (2026-08-31).** Ran with a limit of 10 — 16
candidates walked, correctly stopped at exactly 10 newly-screened, Jay Carrillo's flaky response
this time errored and the batch continued past him instead of aborting, and the previously-mis-IDed
numeric-ID profiles (Andrew Lee, Angel Ramos) both got real screenings this time
(reject/25, review/72) instead of a false skip. All three of today's fixes hold.

**Scope clarification from this run, per Greg:** the batch's `dailyLimit` (from `scanLimitsByDay`)
was being read as if it meant "friend requests to send," when it's actually always meant "total
profiles scanned" — a real, much bigger number, deliberately decoupled from send volume. See
ARCHITECTURE.md's new "Scan volume vs. send volume vs. the queue" section for the full three-tier
spec (scanned → queued → sent) this defines for tasks 1.7/1.9/1.10. Fixed today: `scanLimitsByDay`'s
Settings label/hint rewritten to be unambiguous, and its **default** (new installs / Reset to
Defaults only — Greg's live configured values were never touched) raised from ~10-25/day to 80/day
to reflect the real intended scale.

**New feature built, per Greg: reject → Remove from suggestions.** `MKT.act.removeCandidate`
added to `content/act.js`, using the real "Remove" button markup verified all the way back from
Greg's very first paste this session — scoped to the specific candidate (walks up from their own
profile link, exactly like the Add Friend button pattern), verified against a synthetic two-person
page that it can't cross-wire and click the wrong person's Remove button, and correctly avoids the
same hidden-decoy trap as Add Friend. Wired into `runDiscoveryBatch`: fires immediately after a
*fresh* reject verdict (not a cached one), gated by Test Mode like every other real click.

**Retest result:** nothing disappeared, but both fresh rejects (Jay Carrillo, Anthony Pintaro)
explicitly showed `removed: false` rather than an error — meaning the code ran and deliberately
declined, most likely because Test Mode defaults to `true` and there's no record it was ever
turned off. **Diagnostic gap fixed:** the batch result now also surfaces `removedReason` (was being
silently dropped — `removed: false` alone isn't enough to tell "Test Mode blocked it" apart from
"button not found" apart from any other reason). **Pending: Greg checks Settings' Test Mode
checkbox and re-runs; if it's on and this is intentional, turning it off should make Remove
actually fire — the reason field will now say so either way.**

**Confirmed (2026-08-31):** it was Test Mode. With it off, both fresh rejects this run
(Mark-Becca Beal, David A Lisi) show `removed: true`. Remove-on-reject is working end to end. Also
a strong sign the whole pipeline is healthy: this run produced 4 auto-added and several
`needs_review` candidates from real, varied profiles — the first batch that looks like genuine
day-to-day output rather than a test fixture. Noted for later, not urgent: all 4 auto-adds landed
at exactly 92 confidence, worth watching whether that's a real pattern or coincidence once there's
more volume. **Confirmed visually (2026-08-31) — both removed people are genuinely gone from the
live suggestions list, not just a truthy return value.** Remove-on-reject fully verified end to end.

**Phase 1 core discovery pipeline: complete and proven against real data.** Scan → tiered screen
(exclude/exact-include/AI) → confidence-band verdict → Person Ledger with dedupe → auto-remove
rejects → orchestrated batch loop respecting daily scan limits. Every piece has been tested against
live Facebook data and real Claude API calls, with three real bugs found and fixed along the way
(fuzzy-match false negatives, ledger identity collision, batch-aborting AI errors).

- [x] 1.7 Side panel review queue — built (2026-08-31) as its own full-width page
      (`sidepanel/review.html`/`review.js`, opened via a link from the main panel, matching the
      Settings pattern) rather than crammed into the narrow side panel. Lists everyone in
      `needs_review` (highest confidence first, so the strongest candidates get triaged before the
      marginal ones), showing name (linked to their real profile), confidence, tier, the AI's full
      reasoning, and its signals list. Approve → `queued`, Skip → `rejected`, both using the
      `approvePerson`/`skipPerson` ledger functions built earlier but never wired to anything until
      now. Skip also best-effort attempts the same Remove-from-suggestions action as an AI reject —
      best-effort only, since it requires that person to currently be rendered on a live
      `facebook.com/friends/suggestions` tab, which won't always be true when reviewing later (they
      may have scrolled out of the virtualized list, or no such tab may be open) — a failure there
      is not treated as an error, since the ledger state change is what actually matters. Main panel
      now shows a live "Review Queue (N waiting)" count.
      **Real security issue caught and fixed before ever shipping:** the first draft interpolated
      scraped Facebook names and AI-generated reasoning/signals directly into `innerHTML` — both are
      effectively untrusted input, and this page has ledger, settings, and Claude-API-key access, so
      a maliciously-crafted profile name (or AI output echoing something injected) would have been a
      real stored-XSS vector, not a hypothetical one. Rewritten to set every dynamic value via
      `textContent`/property assignment instead. Verified live: fed the renderer a fake person with
      an `<img onerror>` name, a `<script>` in the reasoning, and an `<svg onload>` signal — none
      executed, all rendered as inert literal text, and the actual DOM contained zero injected
      `<img>`/`<script>`/`<svg>` elements.
**Retest, per Greg (2026-08-31):** Approve worked (no Add Friend click expected — that's correctly
task 1.9's job, not built yet; Approve only ever moves someone to `queued`). Skip's best-effort
Remove did NOT visibly remove the person from the list. Investigated via the log rather than
guessing — and found a **real, separate gap**: the log viewer in Settings only ever displayed the
bare message text, never the `meta` object attached to it. The actual `removeResult` (the real
reason Remove declined — stale tab, candidate not currently in the DOM, etc.) was being recorded
correctly the whole time; the viewer just never surfaced it, so this diagnostic path Greg was asked
to check was silently broken. **Fixed:** `renderLogs` in `settings.js` now appends `meta` as a
second indented line when present, using `textContent` (not `innerHTML`) so this stays safe
regardless of what ends up in a log's meta (which can include scraped names/AI text).
**Pending: Greg reopens Settings (no need to re-run the skip — the data was already recorded) and
reports what the log actually says was the real reason Remove declined.**

**Confirmed (2026-08-31):** `{"attempted":true,"reason":"candidate not found in list","removed":false}`
— exactly the anticipated limitation, not a new bug. A suggestions tab was found, but Deryck Pham's
row was no longer loaded in the virtualized list by the time he was reviewed (likely well after the
batch run that screened him). The ledger state change (the part that actually matters) succeeded
regardless. **UX fix:** Greg had to dig through Settings' log viewer to find this out — the Review
Queue itself now shows the real outcome directly on Skip ("also removed from the suggestions list"
vs. the specific reason it couldn't) before the card disappears, instead of requiring a trip
elsewhere to see what happened.

- [x] 1.2 Normalize each candidate into a Person record (stable ID = profile URL/ID, never name) —
      `lib/ledger.js` built: `extractProfileId` (the username slug, lowercased) verified in a live
      browser JS engine against real URLs, including one with Facebook's `?__tn__=...` tracking
      param and one reserved (non-profile) path correctly returning `null`.
- [x] 1.3 Person Ledger written to storage with dedupe (never re-surface a decided person) —
      `recordScreening` derives ledger state from the verdict (deterministic `reject`/`auto-add`
      for exclude/exact-include, `computeVerdict` for the AI tier), verified against all three
      verdict values. Wired into `SCREEN_CANDIDATE`: a person already in the ledger is now returned
      from cache (`fromCache: true`) instead of re-running keyword tiers or spending another AI
      call — the actual dedupe payoff. Added a "View Ledger" button to the side panel to inspect
      what's recorded.

**Real gap found live (2026-08-31):** Greg re-tested and the cache hit was correct
(`fromCache: true`, right ledger state, right confidence) — but the full click + wait + 25-scroll
sequence still ran first. The dedupe check lived in `SCREEN_CANDIDATE`, which only runs *after*
the content script has already done the entire expensive scrape — the caching saved the AI call
and keyword checks, but not the actual point of dedupe: never touching Facebook for someone
already decided. **Fixed:** added a `CHECK_CACHED_SCREENING` message so the content script can ask
the background "do we already know this person?" using just their list-page href — available
before ever clicking — and skip the click/wait/scroll entirely on a hit. `TEST_FULL_CANDIDATE_SCRAPE`
now checks this immediately after picking a candidate, before `clickCandidate` is ever called.
**Confirmed fixed live (2026-08-31)** — after a full extension + tab reload (the first retest was
a stale-reload false alarm, same class of issue as the earlier `chrome-extension://invalid`
episode), a repeat "Test AI Screening" on an already-known candidate came back with
`skippedScrape: true` and no visible click/scroll at all.

**Person Ledger and dedupe: done and verified end-to-end, both the write path and the actual
performance payoff.**
- [ ] 1.4 Fuzzy include-keyword shortlist + fuzzy exclude-keyword hard skip (no AI cost either way)
- [ ] 1.5 Claude screening call for the remainder — batched, structured `{confidence, reason}`,
      prompt explicitly instructs typo/variant tolerance
*(Note: this checklist's original 1.6–1.13 numbering had gone stale — several items were built
and documented in detail earlier in this file under their own headings without this list being
updated to match, leaving duplicate/conflicting entries. Reconciled below, 2026-08-31.)*

- [x] 1.6 Confidence-band logic — see the dedicated section above (`lib/verdict.js`,
      auto-approve/review/auto-deny sliders, both boundary-inclusive, verified against all cases).
- [x] 1.7 Daily scan limits (per day of week, `scanLimitsByDay`) — built into `runDiscoveryBatch`.
      Daily *send* caps are covered under 1.9 below, not a separate item — they're the same
      `caps.maxRequestsPerDay` setting, counted via the ledger's `requestedAt` timestamps rather
      than an independent counter (see ARCHITECTURE.md's "Scan volume vs. send volume" section).
- [x] 1.8 Side panel review queue — see the dedicated section above (`sidepanel/review.html`).
- [x] 1.9 Execution: send the friend request — **Send Queue** built
      (`sidepanel/send.html`/`send.js`), assisted click as decided (D6): every request needs an
      explicit click there, the extension never sends unattended. `MKT.act.sendFriendRequest`
      replaces an earlier, never-wired `clickAddFriend` that had the same page-wide-button-grab bug
      already found and fixed for Remove — caught and fixed before it ever shipped. Daily count
      derived from `countRequestedToday` (ledger `requestedAt` timestamps), verified in a live
      browser JS engine against explicit dates spanning a day boundary. When a queued person is no
      longer rendered in the (virtualized) suggestions list, the page shows the real reason and a
      direct profile link instead of a dead end. Both the card renderer and the failure-message
      path were verified injection-safe the same way as the review queue (`textContent`/`.append()`
      only, real injection payloads tested and confirmed inert).

**Confirmed live (2026-08-31): the "not in list" fallback link was needed on the very first real
test**, not a rare edge case — Aaron Bihl (queued during much earlier testing) was no longer
rendered in the current suggestions list. Investigated with Greg via the same `$0`-console
technique used throughout this session, which revealed the profile page's Add Friend button uses a
**completely different aria-label** than the list version — `"Add Friend Aaron Bihl"` (capital F,
name appended) versus `"Add friend"` (lowercase, bare). These do not cross-match; verified live.
Given this hits immediately rather than rarely, built a real automatic fallback rather than leaving
the manual link as the permanent answer: `profileAddFriendButton` selector added, `MKT.act.
clickProfileAddFriend` added (no per-candidate scoping needed here — only one relevant button on a
whole profile page), and the Send Queue now automatically opens the person's profile in a
background tab, waits for it to finish loading, clicks there, and cleans up the tab — only when the
list attempt specifically failed with "candidate not found in list" (not for other failure reasons
like Test Mode). The manual link still exists as the final fallback if this also fails (e.g. their
profile page structure differs, or the button truly isn't there).
**Pending: Greg retests Send Queue with Test Mode on, confirms the profile-page fallback triggers
and correctly reports "test mode — no real click performed" without ever clicking anything real.**
- [x] 1.10 Timing — **assisted-click sending doesn't need simulated inter-action delays**: a human
      clicking one send at a time from the Send Queue already paces at human speed, so the
      randomized-delay pattern used in the automated discovery batch doesn't apply here. The daily
      cap is the real safety control for this surface. Documented as a deliberate scope decision,
      not an oversight — revisit only if `autoSend` (unattended sending) is ever built.
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
