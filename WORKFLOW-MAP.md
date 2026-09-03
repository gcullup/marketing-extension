# Workflow Map — Facebook Marketing Extension

**Purpose:** single source of truth for what is built, what is next, and what is still undecided.
Update this file at the end of every working session.

- **Last updated:** 2026-09-02
- **Repo location:** `C:\dev\marketing-extension` (moved off Google Drive)
- **GitHub:** https://github.com/gcullup/marketing-extension
- **Current phase:** Phase 1 core loop built and proven live (first real friend request sent
  2026-08-31). Remaining before formal sign-off: 1.11 golden-set eval, 1.12 a full real
  low-volume day (one real send so far, not yet a full day). **Discovery Batch rebuilt on
  `chrome.alarms` (2026-09-01)** after MV3 hazard #2 was actually confirmed live (a real batch
  silently died mid-run) — **confirmed live**: a full unattended run to natural list-exhaustion, and
  a manual Stop, both worked; still pending a run that actually hits the configured daily limit and a
  genuine forced service-worker kill specifically (see ARCHITECTURE.md hazard #2).
- **Active endpoint:** Endpoint 1 (Step 1 — Friend Discovery) — functionally complete, validation
  pending. Endpoint 2 (Step 9 — greeting DM) — **proven live end to end 2026-09-01**: acceptance
  detection, the (template-based, not AI-drafted) cohort query, and the actual composer-automated
  send are all built and confirmed against real data, including a fix for the daily message cap now
  being enforced live mid-session, not just at page load. Remaining before sign-off: 2.8 formal
  sign-off. Endpoint 3 (Step 3 — Content Creation) — **started 2026-09-01**: the day-of-week content
  generation pipeline (with content-recycling avoidance and a selectable/"Surprise me" angle
  rotation) is proven live, and 3A (post to personal page) is now proven live end to end too, after
  two real bugs found and fixed. **3B (business page) is blocked, not just unbuilt** — Greg's
  Facebook account configuration doesn't allow posting directly to his business page, confirmed
  2026-09-02; its button is disabled/"for future development," not pending a code fix. **3C (Story)
  is now proven live end to end too (2026-09-02)** — worked on the first try, no bugs found, reusing
  3A's proven tab-handling and Lexical-typing logic against real, verified Story-editor DOM. **3D
  (group) built 2026-09-02**, from real DOM off Greg's own group page — pending his live test.

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

**Testing gotcha, confirmed 2026-09-01: after reloading the extension, use a hard refresh (Ctrl+F5),
not a plain F5, on any already-open Facebook tab.** Reloading the extension orphans any content
script already injected into a tab that was open before the reload — a plain F5 on that tab wasn't
enough to fix it (still threw "Could not establish connection. Receiving end does not exist" on Run
Discovery Batch), but Ctrl+F5 did. Not a code bug — this is the same class of stale-reload issue
noted earlier in Phase 1 (the `skippedScrape` false alarm), just with a more precise fix now that
plain F5 alone isn't reliably enough.

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
      `caps.maxRequestsPerDayByDay` setting (per day of week — see below, made variable 2026-08-31),
      counted via the ledger's `requestedAt` timestamps rather than an independent counter (see
      ARCHITECTURE.md's "Scan volume vs. send volume" section).
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
**Confirmed live (2026-08-31):** re-tested on Aaron Bihl — the profile-page fallback correctly
triggered, navigated, found the real Add Friend button, and Test Mode correctly blocked the click
with the exact expected message. The entire sending path (list-based, profile-page fallback, and
the Test Mode safety gate on both) is now verified working end to end. **Step 1's core loop —
scan → screen → review → send — is fully built and mechanically proven.**

**First real send, live (2026-08-31):** Greg turned Test Mode off and sent a real friend request
to Aaron Bihl via the profile-page fallback path — it worked. This is the first real action this
extension has ever taken on Facebook; everything before this was Test Mode or read-only. The full
pipeline (scan → AI screen → ledger → review → send) has now been proven true end to end, not just
mechanically in Test Mode.

- [~] 1.12 One real low-volume day — **started**: one real send confirmed working (Aaron Bihl).
      Not yet a full day of sustained real usage — that's still worth doing deliberately before
      calling this fully proven at volume (Facebook's response to sustained real activity over
      time is still unobserved).
- [ ] 1.11 Golden-set eval: ~20 hand-labeled profiles **including known misspelling/variant cases**
      from the confirmed prior bug, re-run after any prompt change — still open, not urgent before
      real usage continues.
- [ ] 1.13 ENDPOINT 1 SIGNED OFF — held open until 1.11/1.12 are actually complete, not just started.

**Open question surfaced by Greg (2026-08-31), deliberately deferred — not a bug, a real design gap
worth closing properly next session:** Settings' "Min/max delay between actions" (currently
250s/1799s) and "Spread queue over N hours" **do nothing**. Verified directly — `grep` confirms
`minDelaySeconds`/`maxDelaySeconds`/`spreadHours` are referenced only in `lib/store.js` (schema
default) and `sidepanel/settings.js` (load/save/validate); no scan, batch, or send code ever reads
them. They were carried over from the old tool's settings screenshot early in this rebuild without
verifying how the old tool's code actually used them, and never wired into anything real.

What IS controlling pacing today is a completely different, much finer-grained thing: a hardcoded
~250–750ms delay between individual scroll gestures while reading one profile (`content.js`,
`scrapeCandidateProfile`), with a 15% chance of a longer 1.5–3s "reading pause." Greg's memory of
the old tool using sub-second delays almost certainly matches THIS concept, not the 250-1800
*second* settings values, which were likely mismapped from the screenshot without knowing their
real old-tool granularity.

Two genuinely different things "delay between actions" could mean, next session should pick one
deliberately rather than guess:
1. **Between candidates within a scan batch** (e.g., pause several minutes after fully reading one
   profile before starting the next) — the more valuable one for looking human at the batch level,
   but it collides with the MV3 service-worker risk already flagged: `runDiscoveryBatch` is one
   continuous background function, and Chrome can kill it after ~30s of no extension-API activity.
   A multi-minute in-process sleep would very likely get the whole batch killed mid-run. Doing this
   properly needs restructuring around `chrome.alarms` (schedule "process the next candidate" as a
   real future wake-up, not a sleep) — a genuine architecture change, not a quick fix.
2. **Between friend-request sends** — less architecturally fraught since sending is already
   assisted-click (Greg naturally paces himself), but the setting could still enforce a *minimum*
   gap even if he clicks faster than that.

Quick, low-risk alternative not yet chosen: just wire the existing settings fields to the
already-working scroll-tick delay instead of leaving them dead, and relabel them accurately. Greg
chose to defer this decision to next session rather than pick under time pressure — noted here so
it isn't reconstructed from memory later.

**Resolved (2026-09-01):** went with option 1 (between candidates within a batch) at a modest
scale, deliberately avoiding the `chrome.alarms` rewrite for now. Reasoning: even option 1's
"proper" multi-minute version wasn't chosen — instead, `minDelaySeconds`/`maxDelaySeconds` were
redefined to mean a **few-second** pause between candidates (new default 3–15s, not the inherited
250–1800s), which is short enough to stay a simple in-process `await` without meaningfully raising
the MV3 service-worker kill risk, while still closing the real gap that existed today (zero pause
between consecutive candidates). Applied only after real Facebook interaction (a fresh scrape),
never after an instant cache-skip, via a `didInteractWithFacebook` flag — verified this reasoning
holds by tracing every branch of the batch loop. `spreadHours` stays explicitly unused and its
Settings input is now disabled with an explanatory tooltip, rather than sitting there implying it
does something. Old inert values (250s/1799s if previously configured) reset once via a guarded
migration — verified live it only fires once and never re-clobbers a later deliberate edit.
**The `chrome.alarms` architecture for true multi-minute/hour-spread pacing remains a real,
legitimate future task** — revisit if scan volumes grow large enough that a batch's own natural
duration (not even counting added pacing) starts pushing into the MV3 kill-risk window, or if
Greg wants session-level pacing beyond what a few-second inter-candidate gap provides.

**Real gap found and fixed the same day (2026-09-01), per Greg:** rejected people weren't
disappearing from the suggestions list on later scans. Traced it directly from a real batch result:
5 of 6 rejected people that run showed `skipped: true` with no `removed` field at all — only the
one *freshly* rejected that run showed `removed: true`. Root cause: removal was a one-shot attempt
tied to the exact moment of a fresh reject; a cache hit skipped straight past that logic on every
later run, so anyone whose first attempt failed — or who was rejected before the Remove feature
existed earlier today — sat visible in the list forever with no retry, ever. **Fixed:** added
`removedFromSuggestions` to the ledger record (`lib/ledger.js`'s new `markRemovalAttempt`, only
ever sets it true, never resets a failed attempt back to false, so retries keep happening until one
actually succeeds), forwarded it through `CHECK_CACHED_SCREENING`'s response, and added a retry
in `runDiscoveryBatch`'s cache-hit branch — cheap, since the candidate's href is already in hand
from the currently-loaded list, so no re-scrape is needed, and (better than the Send Queue's later
find-them-in-the-list problem) they're confirmed present right now, since we just found them via
`listCandidates()` to process them at all. Also now correctly counts as real interaction for the
inter-candidate pacing delay above, since it's a genuine click even when the scrape itself was
skipped. Verified the retry/no-retry/never-touches-other-states logic in a live browser JS engine
before wiring in. **Pending: Greg runs another batch and confirms previously-stuck rejected people
(e.g. Steven Enns, Mike Perdue) now get `removed: true` and actually disappear from the list.**

**Confirmed live (2026-09-01):** clean sweep — all 6 rejected people in the retest (including
previously-stuck Sam Perea, Anthony Pintaro, Andrew Lee, Harris Jones) show `removed: true`, while
`queued` cache hits (Neil Huck, Tracy Doise Hanks, Gabe Anderson) correctly show no removal attempt
at all. The retry-on-cache-hit fix works exactly as designed, no side effects on other states.

**Reset Queue built (2026-08-31), per Greg:** after a day of heavy testing, Review Queue (18
waiting) and Send Queue (9 queued) had accumulated a lot of test-run artifacts with no way to clear
them. Added `clearByState(state)` to `lib/ledger.js` — deletes matching records from the ledger
entirely (not a bulk-reject), verified against a fake mixed-state ledger that it only touches the
targeted state and leaves everything else (including real history like Aaron Bihl's `requested`
record) untouched. Deliberate semantics: delete rather than reject, so anyone who reappears in a
future scan gets freshly re-screened instead of being permanently blocked by today's testing. Wired
into both `review.html` and `send.html` as a "Reset Queue" button, each scoped to only its own
page's state, gated by a confirm dialog naming the exact count about to be deleted and reminding
that it's unrecoverable without a prior Settings export.
**Pending: Greg tries Reset Queue on both pages and confirms the count and post-reset state match
expectations.**

**Send limit made variable per day of week (2026-08-31), per Greg** — was a single flat
`caps.maxRequestsPerDay` applied every day; now `caps.maxRequestsPerDayByDay`, a 7-day grid matching
`scanLimitsByDay`'s pattern in both Settings UI and code. Real migration risk handled deliberately
this time (unlike an earlier session lesson learned the hard way): `deepMergeDefaults` only
backfills truly-missing keys, it doesn't know how to reshape an existing one, so a plain schema
change would have silently discarded Greg's already-configured value. Added `migrateSettings` in
`lib/store.js`, run before the generic backfill, spreading the old flat value across all seven days
— verified live against three cases (real old-shape data, already-migrated data left untouched,
fresh empty install) before wiring in. `send.js` now looks up today's specific value via the same
day-of-week key pattern already used in `runDiscoveryBatch`.

**Auto-approve behavior verified directly from code, per Greg's question:** confirmed
`deriveStateFromVerdict('auto-add')` only ever sets ledger state to `queued` — no DOM interaction
of any kind. Grepped every call site of the real click functions (`sendFriendRequest`,
`clickProfileAddFriend`) and confirmed both are invoked from exactly one place: the Send Queue's
own button click handler in `send.js`. No autonomous Add Friend path exists anywhere. Also
confirmed the `autoSend` Settings checkbox is completely inert — saved and loaded, but never read
by any actual logic, same as the timing settings turned out to be. Assisted click is the only real
path today, provably so, not just by design intent.

**Hazard #2 (MV3 service worker termination) actually hit for real, and fixed — built, NOT yet
live-verified (2026-09-01), per Greg's report.** The exact risk ARCHITECTURE.md flagged as
"currently untested" on 2026-08-31 happened for real: a batch with a daily scan limit of 50
screened steadily for ~27 minutes, then silently died — no "Discovery batch finished" log line,
and the side panel's `chrome.runtime.sendMessage` callback got
`chrome.runtime.lastError.message === "The message channel closed before a response was
received."` — the classic signature of the service worker being killed mid-call. Nothing
already-screened was lost (every candidate hits the ledger immediately), but the batch itself
never completed and nobody was told why.

**Rebuilt around `chrome.alarms` instead of one continuous function**, per the fix
ARCHITECTURE.md's hazard #2 always said was the "proper" answer once this stopped being
speculative. `runDiscoveryBatch` (background/service-worker.js) is now `startDiscoveryBatch` +
`processDiscoveryStep`:
- Every invocation processes at most a small bounded chunk (one real-interaction candidate, up to
  25 consecutive free cache-hit skips, or up to 15 list-scroll attempts) — never the whole batch —
  and persists full progress to `chrome.storage.local` (`mkt_discovery_batch_state`) after every
  single step, not just at the end.
- The next step is scheduled via `chrome.alarms.create` rather than an in-process
  `await`/`setTimeout`. A `chrome.alarms.onAlarm` listener resumes by reading the persisted state
  back out and continuing from exactly there — this is what survives a service-worker kill that a
  pending `setTimeout` cannot.
- **Real, deliberate tradeoff, confirmed from Chrome's own `chrome.alarms` docs (not assumed):**
  Chrome clamps alarms to fire no more often than ~30 seconds, even when asked for less. The old
  3-15s inter-candidate pacing can't be honored at that granularity anymore — every real-interaction
  step is now realistically `max(30s, the configured delay)` apart. Settings' Timing section hint
  text was updated to say this plainly rather than leaving the sliders implying a precision they no
  longer have. Judged worth it: surviving termination reliably matters more than exact sub-30s
  pacing, and the bigger anti-detection lever was always the daily caps and human approval gates,
  not the exact gap between two candidates.
- The batch's safety duration cap was widened from 20 minutes to 4 hours to match — a full 80/day
  batch can now legitimately take over an hour of real wall-clock time with nothing actually wrong,
  since every real-interaction step now costs at least ~30s of real time. The 300-candidate safety
  cap is unchanged.
- **Stale-tab edge case handled:** `validateBatchTab` checks `chrome.tabs.get` (tab closed?) and the
  tab's own URL (navigated off Facebook entirely?) before every step, and fails that batch cleanly
  with a stored, human-readable error rather than throwing into the void. Deliberately does NOT
  require the tab to still be on the literal suggestions-page URL — clicking into a candidate is a
  normal, already-documented split-view URL change (the list stays live underneath; see the
  "Layout confirmed" note earlier in this file), so requiring an exact URL match would misfire on
  every ordinary candidate visit, not just a genuine navigate-away.
- **Concurrent-batch edge case handled:** reopening the side panel mid-batch, opening a new tab, or
  clicking "Run Discovery Batch" again while one is already running all attach to the existing
  in-progress batch (`alreadyRunning: true`) rather than racing a second one against it. Also
  self-heals a real, specific gotcha: reloading the unpacked extension (already documented in this
  file as orphaning content scripts) clears any scheduled `chrome.alarms` but NOT the persisted
  batch state — left alone that would strand a "running" batch forever with nothing left to wake it.
  Re-armed automatically on `onInstalled`/`onStartup` and again if "Run Discovery Batch" is clicked
  while one is stranded.
- **Side panel interaction model changed to match**, since a single request/response can no longer
  span the whole batch: `RUN_DISCOVERY_BATCH` now starts (or attaches to) the batch and returns
  almost immediately; the existing `BATCH_PROGRESS` broadcast still updates the live progress bar,
  and a new `BATCH_COMPLETE` broadcast delivers the final summary the old response used to return
  directly. A new `GET_BATCH_STATUS` message lets the panel restore the correct running/idle UI if
  it's reopened mid-batch. A **Stop button** was added — unlike Send Queue's Process All Stop, which
  polls an in-process wait every 500ms and lands within ~0.5s, this one can take up to one
  inter-candidate pacing interval (at least ~30s) to fully land, since there's deliberately no
  long-running loop left here to poll.
- **Known related risk, deliberately NOT touched here:** `checkAcceptances` (same file) has a
  similar per-person background-tab loop shape and could in principle hit the same MV3 risk at
  large enough volume. Not fixed in this pass since it hasn't actually failed yet — flagged for
  whoever picks it up next if it does.

**Explicitly NOT yet live-tested — reasoned through by reading the code, no build step exists to
run it outside a real browser.** What Greg should verify next time he's at the machine:
1. Run a batch with a large daily scan limit (e.g. 50, matching the batch that actually failed) and
   confirm it completes end to end without the "message channel closed" error, all the way to a
   `BATCH_COMPLETE` broadcast.
2. Confirm the progress bar/spinner still update live during the run (via `BATCH_PROGRESS`), and
   that the very first update can take up to ~30s rather than appearing instantly.
3. Force a service-worker kill partway through (e.g. via `chrome://serviceworker-internals` or
   leaving the browser idle) and confirm the batch actually resumes and finishes rather than
   stalling — this is the entire point of the rebuild and the one thing that most needs real
   verification.
4. Click Stop mid-batch and confirm it actually halts (allow up to ~30s+ for it to land) and reports
   `stoppedReason: 'user_stopped'`.
5. Reopen the side panel (or open a new one) while a batch is running and confirm it correctly shows
   "already running" with live progress, not a fresh idle "Run Discovery Batch" button.
6. Close the batch's original Facebook tab mid-run (or navigate it to a non-Facebook site) and
   confirm the batch fails gracefully with a clear stored error instead of hanging silently.
7. Reload the unpacked extension while a batch is mid-run and confirm it self-heals (either
   automatically, or by clicking "Run Discovery Batch" again) rather than being stranded forever.

**Merged to `main` (2026-09-01)** after Greg reviewed the summary and gave the go-ahead — read
through the diff directly (braces/parens balance-checked; no Node on this machine for a real parse
check) before merging, same discipline as every other change this session.

**Real bug found on the very first live test, per Greg:** clicked "Run Discovery Batch" from
Facebook's main feed, not the suggestions page — the old check only required "any facebook.com tab,"
not specifically the suggestions page, so it silently ran a real batch against the wrong page, found
zero candidates, and correctly (if confusingly) reported `list_exhausted` almost instantly. **Fixed:**
the button now navigates the active tab to `facebook.com/friends/suggestions` itself if it isn't
already there (`ensureOnSuggestionsPage` in `panel.js`), waiting for the page to load and settle
before starting the batch — same "just handle it" instinct as the Send Queue's clickable "open a
suggestions tab" link and the DM/friend-request profile-page fallbacks, taken one step further since
here the fix could remove the manual step entirely rather than just making it one click. Verified the
skip-navigation-if-already-there and navigate-and-wait paths in a live browser JS sandbox before
wiring in. **Confirmed live (2026-09-01):** Greg's next run auto-navigated correctly.

**First real post-rebuild batch run, confirmed live (2026-09-01):** Greg ran a real batch (limit 50)
and stopped it partway through — 12 candidates tried, 8 newly screened, 4 free cache-hit skips
correctly excluded from that count. Real AI confidences (92/72/25/95/88/72/72) correctly mapped to
auto-add/review/reject, a fresh reject correctly showed `removed: true`. **The Stop button worked**,
returning a clean `BATCH_COMPLETE` with `stoppedReason: "user_stopped"` instead of hanging or
erroring. This is the first real evidence the alarms-driven rebuild works across multiple steps
without dying — the old code's confirmed failure mode was silently dying partway through a run
just like this one. **Second real run, confirmed live (2026-09-01):** a full unattended run this time — 29 candidates
tried, 26 newly screened, ran on its own across many alarm-driven steps until the suggestions list
naturally ran dry (`stoppedReason: "list_exhausted"`), not a manual Stop. Verdicts/rejects/removals
all correct again. This is stronger evidence than the first run: a longer, genuinely unattended
stretch surviving all the way to its own natural stopping point, which is exactly the scenario the
old code used to die in partway through.

**Still pending:** a run that actually hits the configured daily limit (`daily_limit_reached` —
both real runs so far ended a different way: one via manual Stop, one via list exhaustion), and
ideally a genuine forced service-worker kill mid-run to prove the actual resumption behavior the
rebuild exists for (a clean Stop and a natural list-exhaustion finish both prove the alarm loop keeps
working across many steps, but neither one has yet tested recovery from an abrupt kill specifically).

---

## Phase 2 — ENDPOINT 2: Step 9, Initial Greeting DM

- [x] 2.0 **Acceptance detection — the foundation everything else depends on, built 2026-09-01.**
      Nothing tracked whether a friend request was actually accepted before today; `requested` was
      a dead end. Detection signal verified live against Aaron Bihl's real profile (the first real
      friend request this extension ever sent, confirmed accepted the same day): once accepted, Add
      Friend is replaced by `[aria-label="Friends"][role="button"]` — confirmed it doesn't
      cross-match the not-yet-accepted state. Also captured the Message button selector from the
      same real page for the future send-the-DM step. Built: `MKT.scrape.checkFriendStatus`
      (content script), `checkProfileFriendStatus`/`checkAcceptances` (background — walks everyone
      in `requested`, opens each real profile in a background tab mirroring `send.js`'s proven
      `sendViaProfilePage` pattern, checks, cleans up), `markAccepted` (ledger — sets `acceptedAt`,
      needed for 2.1's cohort filter below). New "Check Accepted Friends" panel button, clearly
      labeled as foundational/new rather than blended into the polished Discover/Review/Send flow.
      See ARCHITECTURE.md's "Step 9 — foundation started" section for full detail.

**Confirmed live at real scale (2026-09-01):** checked 7 real people in `requested` state (6 more
than just Aaron Bihl — real accumulated activity from today's Send Queue testing), correctly split
3 accepted (Aaron Bihl, Alex Barshop, Hunter Hyde) / 4 not yet (Obi Dike, Patrick Falcone, Brian
Pitcher, Tyler Allen), zero errors or timeouts across the batch. Acceptance detection holds up
beyond the single-person case, not just the original test.

**Stale-request cleanup added (2026-09-01), per Greg** — maps to the original Step 2 spec
("cancel outstanding requests"), time-based here (default 14 days, configurable in Settings) rather
than the volume-based (200/150) trigger originally described there. New signal verified live
against Obi Dike's real still-pending profile: while outstanding, the button reads
"Cancel Request &lt;Name&gt;" — same dynamic-name-suffix pattern as Add Friend/Remove, confirmed it
doesn't cross-match the Friends or Add-Friend selectors. Built `MKT.act.cancelFriendRequest`
(content), `markCancelled` (ledger — `requested` → `cancelled`), and consolidated the whole check
into one profile visit per person: `checkProfileFriendStatus` was generalized into
`withProfileTab`, a reusable "open a background tab, let the callback send as many messages as it
needs, always clean up" helper, so checking acceptance AND (if stale) cancelling happens in a
single visit rather than opening the same profile twice. The three-way decision (accepted / stale
→ cancel / still waiting) and the day-boundary math were verified in a live browser JS engine
before wiring in — including the exact-14-days edge case (stays within the window; only strictly
past it triggers cancellation) and confirming acceptance always takes priority over staleness (a
very old but just-accepted request never gets wrongly cancelled).
**Confirmed live (2026-09-01):** all 4 still-pending people correctly report `stillWaiting: true,
daysWaiting: 0` (all requested earlier today) — nobody wrongly flagged as stale.

**Full real-world validation, same day:** Greg temporarily set `staleRequestDays` to 0 to force the
cancel path and re-ran the check. Both branches fired for real in the same pass — Patrick Falcone
and Brian Pitcher were correctly detected as newly accepted (`accepted: true`), while Obi Dike and
Tyler Allen were correctly identified as stale under the forced threshold and had their requests
genuinely cancelled on Facebook (`cancelled: true`). Reset to a real value (10 days) afterward. Both
of Step 9's foundational branches — acceptance detection and stale-request cleanup — are now proven
against real data, not just verified in isolation.

**Small Send Queue UX fix (2026-09-01), per Greg:** forgetting to have a suggestions tab open
before clicking Send just showed a plain error describing the problem. Now the "open one" part of
that message is a real clickable link straight to `facebook.com/friends/suggestions` (opens in a
new tab), so fixing it is one click instead of remembering the URL and switching tabs manually.

**"Process All" Send Queue automation built (2026-09-01), per Greg's explicit request** — a real,
deliberate step beyond assisted click (D6) toward the unattended-sequence behavior the (still
otherwise-unused) `autoSend` setting was conceptually meant to represent. One button click now
sends up to today's remaining limit automatically, one person after another, ~8-18 seconds apart,
with no per-person confirmation, until the daily cap is reached or the queue runs dry. Built in
`sidepanel/send.js`/`send.html`, reusing the exact same send logic as the manual button (the
individual card's click handler was pulled out into a named `sendThisOne()` function, stored on the
card as `card._sendThisOne` and keyed by `card.dataset.personId`, so Process All and a manual click
share one implementation with zero duplication — same testMode/profile-page-fallback/ledger-write
behavior either way). Skips past any card it already attempted this run (tracked via an
`attemptedIds` Set) rather than retrying a failure forever — a failed send stays in the queue for a
human to handle manually, exactly like it already did before this feature existed. The 8-18s
inter-send wait is interruptible: `interruptibleDelay()` polls every 500ms instead of one long
`setTimeout`, so clicking the new Stop button takes effect within about half a second rather than
waiting out however much of the wait was left (verified directly in a live JS engine: an
uninterrupted call ran the full requested duration, while one interrupted ~600ms in exited at
~1000ms, not the full 2000ms requested). Two safety pieces added beyond exactly what Greg described,
flagged to him before building: a `confirm()` dialog before starting, stating the exact behavior and
today's person count, and a Stop button that appears once running and halts the loop after the
current in-flight send finishes (an in-progress send is never aborted mid-click). The skip-past-a-
failure logic and the 8-18s randomization bounds were each verified in a browser JS sandbox before
being wired into the real code, followed by a full read-through of the assembled feature.
**Real bug found on the very first live run (2026-09-01):** Greg ran Process All with no
`facebook.com/friends/suggestions` tab open — it attempted all 4 queued people (Dave Snider, Tom
Causley, Travis Goodwin, Tracy Doise Hanks) and every single one failed with "No
facebook.com/friends/suggestions tab open — open one, then try again," since `sendThisOne` only
ever fell back to the profile-page send path when a suggestions tab existed but the candidate
specifically wasn't rendered in its list — "no tab open at all" was a different code branch that
just showed a clickable link and gave up. That's a reasonable dead end for one manual click (Greg
sees it, opens a tab, tries again) but it meant Process All couldn't recover mid-run and burned its
entire attempt budget on the same failure. **Fixed:** both "no suggestions tab open" and "tab open
but not in the list" now trigger the same, already-verified `sendViaProfilePage` fallback
automatically — since that fallback opens the person's own profile directly, it never actually
needed a suggestions tab to work at all. This also fixes the manual per-card Send button, not just
Process All.

**Confirmed live (2026-09-01):** Greg re-ran Process All — it worked, sending via the profile-page
fallback with no suggestions tab needed. The Stop button was also tested live and correctly halted
the run. "Process All" is now proven end to end, not just code-complete: send loop, pacing,
profile-page fallback, and interruptibility all confirmed against real Facebook data.

**Design simplified (2026-09-01), per Greg:** no AI drafting for the greeting DM — just the existing
static `messageTemplates.intro` (already configurable in Settings) with `{firstName}` filled in, same
mechanism as the birthday template. Once it's sent, Greg takes over the conversation directly. This
collapses the originally-scoped 2.2-2.4/2.7 items below into "render the existing template," so
they're crossed off as no-longer-applicable rather than left open.

- [x] 2.1 Cohort query — `getDmCandidates(dmDelayDays)` added to `lib/ledger.js`: accepted, never
      DM'd, accepted strictly more than `settings.dmDelayDays` days ago (new Settings field, default
      2 per Greg), sorted oldest-accepted-first. Verified in a live browser JS engine across the
      boundary/already-messaged/too-recent cases.
- [-] 2.2 Tone guide — not needed; the message is a fixed template, not AI-drafted.
- [-] 2.3 AI-drafted opener — not needed per the simplified design above.
- [-] 2.4 Draft review queue — not needed; nothing is drafted, so there's nothing to review before
      sending beyond seeing the (fixed) rendered preview, which the new DM Queue page already shows.
- [~] 2.5 Messenger composer automation (highest-fragility surface in the system) — **built,
      pending live verification.** Greg tested clicking Message on Aaron Bihl's real accepted-friend
      profile: it opens an **in-page popup** (not a new tab, not an iframe), and the composer is a
      Lexical rich-text editor, not a plain input — real markup captured:
      `<div aria-label="Write to Aaron Bihl" contenteditable="true" role="textbox" data-lexical-editor="true">...`.
      Confirmed no separate Send button exists — pressing Enter is the only way to send. Built:
      `messageComposerInput` selector (verified against a synthetic page that it doesn't cross-match
      the on-profile post composer, whose label starts "Write something to..." not "Write to...");
      `MKT.act.clickProfileMessage()` (opens the popup, not Test-Mode-gated — same reasoning as
      clicking into a candidate's profile); `MKT.act.sendComposedMessage(text, testMode)`, which uses
      `document.execCommand('insertText', ...)` rather than a raw DOM mutation since Lexical
      maintains its own state synced off real input events; `SEND_DM` content message (clicks
      Message, polls for the popup to actually render, then sends); `sidepanel/dm.js`'s
      `sendGreetingDm`, mirroring `send.js`'s `sendViaProfilePage` exactly. Verified the *mechanics*
      (insertText populating a generic contenteditable; a dispatched Enter KeyboardEvent being
      observed) in a live browser JS sandbox — **not yet verified against Facebook's actual Lexical
      instance**, which is the one real unknown. Test Mode deliberately stops one step short of every
      other action here: it types the real rendered text (safe) but skips the Enter dispatch, so the
      hard part (does insertText work against the real editor) can be checked with zero risk of an
      accidental send.

**Confirmed live (2026-09-01):** Greg tested the DM Queue after temporarily setting `dmDelayDays` to
0 (same forcing technique used earlier for `staleRequestDays`) — 8 accepted friends immediately
showed up as eligible. Ran a real send and confirmed it worked: `execCommand('insertText', ...)`
correctly reconciles against Facebook's real Lexical editor, and the simulated Enter keypress
actually submits the message. **Step 9's greeting DM is now proven end to end, not just built** —
cohort query, template rendering, composer automation, and the actual send all confirmed against
real data. `dmDelayDays` should be set back to a real value (2, or whatever Greg prefers) after
testing.

**Real-world wrinkle found and fixed the same day, per Greg:** the whole message appeared instantly
(one `execCommand` call for the entire string) and the background tab closed immediately after
sending — both read as an obvious script, not a person typing. Fixed: `sendComposedMessage` now
types character-by-character with a randomized human-typing cadence (occasional longer pause,
matching the existing scroll-pacing pattern), pauses briefly before dispatching Enter, and pauses a
few more seconds after sending before returning (the tab closes as soon as the response comes back,
so the pause lives in the content script, not the caller). Considered and rejected a type-then-paste
hybrid (type up to where `{firstName}` was substituted, then paste the rest) — the content script
only receives the already-rendered plain text, so recovering that boundary would need extra
plumbing that typing the whole message character-by-character makes unnecessary. Verified the
character-by-character insertion mechanics (cursor advances correctly across awaited iterations,
final text is correct) in a live browser JS sandbox before wiring in.

**Two more real bugs found on the very next live test (2026-09-01):** the first character of the
message was silently dropped, and typing stopped about halfway through before the tab closed. Both
are consistent with focus-related quirks that only show up against Facebook's real Lexical instance
— not reproducible in a sandbox, since there's no way to fully imitate Lexical's own internal
focus/selection management outside a real session. Best-guess fixes applied: a short settle delay
(with one retry) after focusing the composer before typing starts, addressing the dropped first
character; and re-asserting focus before every single character (a no-op if focus never actually
left, so it shouldn't disturb typing that's working correctly) as insurance against whatever caused
typing to stop partway. **Being direct that this is a best-effort fix, not a confirmed root-cause
fix** — the exact mechanism Lexical uses that caused the original drop/stop isn't fully known.
Because of that, the failure path now also returns much more diagnostic detail (how many characters
were typed before failing, the composer's actual text at that point, whether it was still focused)
so a repeat failure gives real data to diagnose instead of a third guess — the full result, including
those extra fields, is captured in the log (`DM Queue: greeting DM attempt`, viewable in Settings'
log viewer) even though the DM Queue's own status text only shows the short reason.

**Real root cause found from that diagnostic data (2026-09-01):** the log showed
`"reason":"timed out loading their profile page"` — a DIFFERENT failure than the focus theory above.
`sidepanel/dm.js`'s `sendGreetingDm` (mirroring `send.js`'s `sendViaProfilePage`) has a single
timeout that spans the WHOLE round trip — page load, opening the composer, AND the actual typing —
not just page load despite its old name and fixed 15s value. That 15s was sized for the original
instant-paste flow; the moment real human-like pacing was added (character-by-character typing plus
several seconds of pauses), any message longer than a few words legitimately took more than 15s
total, so this leftover timeout fired mid-typing and force-closed the tab, misreported as a page-load
failure when the page had loaded fine. **Fixed:** the timeout now scales with the actual message
length (`20000 + text.length * 200`ms — generous headroom above the real ~35-400ms/char pace), and
its message no longer specifically blames page load. The earlier focus-settle-delay fix is left in
place too, since the missing-first-character symptom (reported in the same test) isn't explained by
this timeout at all — a genuinely separate issue, most plausibly still the original focus-timing
theory. **Confirmed live (2026-09-01):** Greg re-tested — types all the way through with the human-like
pacing, no cutoff, no dropped first character, message sends correctly. Step 9's greeting DM is now
genuinely live and proven end to end, pacing included.

**Real bug found during a full live-usage day, per Greg (2026-09-01):** DM sends silently failed
unless Greg manually switched his browser's focus to the opened profile tab — worked every time he
happened to look at it, failed every time he didn't. **Root cause:** the tab was opened in the
background (`active: false`, same as every other profile-tab action in this project — Add Friend,
Cancel Request, checking friend status). Those other actions only ever call a plain `element.click()`,
which doesn't care whether its tab is actually focused. The DM composer is different: it types via
`document.execCommand('insertText', ...)` and sends via a dispatched keyboard Enter — both apparently
only take real effect when the tab genuinely has focus, not just "is active within its own
background window." **Fixed:** `sidepanel/dm.js`'s `sendGreetingDm` now opens the profile tab
`active: true` (bringing it to the foreground for the duration of the send) and switches focus back
to whatever tab was active beforehand once it's done — so Greg's browsing view snaps back
automatically rather than being left on the now-closing DM tab. This is a real, visible UX cost (the
browser will jump to the DM tab for the several seconds a send takes) but was necessary for the send
to actually work reliably. Send Queue's and Check Accepted Friends' background-tab flows are
unaffected — they only ever use plain clicks, which this investigation confirmed don't need focus.
**Confirmed live (2026-09-01):** DM sends now work without Greg needing to manually focus the tab.
- [x] 2.6 Per-message approval gate + low daily cap — the approval gate is Greg reviewing the DM
      Queue's rendered previews before clicking Send (assisted click, matching D6). The daily cap
      (`caps.maxMessagesPerDay`, default 15, already existed in settings from Phase 0) is enforced
      via `countDmSentToday`.
      **Real gap found and fixed (2026-09-01), per Greg:** the cap only ever updated the summary
      text/banner — it disabled every card's Send button up front only if the cap was ALREADY hit
      before the page loaded, but nothing stopped Greg from clicking several different cards' Send
      buttons in one sitting and sailing past the cap before the banner ever caught up. **Fixed in
      both Send Queue and DM Queue** (the same latent gap existed in Send Queue's manual per-card
      click too — only "Process All" was ever re-checking the cap live, since it re-reads `remaining`
      every loop iteration): the shared `sendThisOne`/per-card send logic now disables every other
      still-eligible card's Send button the instant a send crosses the cap, not just at page load.
      Verified the disable-all-remaining-cards logic in a live browser JS sandbox before wiring in.
- [-] 2.7 Reply detection — not needed; Greg takes over the conversation manually once the greeting
      DM is sent, per the simplified design above.
- [ ] 2.8 **ENDPOINT 2 SIGNED OFF**

**Built today (2026-09-01):** new side panel page `sidepanel/dm.html`/`dm.js` ("DM Queue," linked from
the main panel's Step 9 section, with a live eligible-count like Review/Send Queue) — lists the
cohort from `getDmCandidates`, each card showing the person, days since acceptance, the exact
rendered message they'd receive (`lib/template.js`'s `renderTemplate`, verified against full names, a
single-word name, a missing name, and a template using `{firstName}` twice), a daily-limit banner
(`caps.maxMessagesPerDay`, via new `countDmSentToday`), and — now that the composer DOM is captured —
a real "Send Message" button (assisted click, per D6's original reasoning: messaging is the more
heavily policed surface). See 2.5 below for the composer automation itself and what's still pending
live verification.

---

## Phase 3 — ENDPOINT 3: Step 3, Content Creation

**Scope confirmed 2026-09-01, per Greg.** 3A/3B/3C/3D are four *destinations* for the same day's
content, not four pipeline stages: 3A personal page, 3B business page, 3C Story, 3D a group Greg
runs. One shared content plan drives all four to start (same generated draft posted everywhere),
rather than each destination having its own independent calendar — simpler to build, revisit later
if a destination genuinely needs different content. Confirmed this revises D5 for content only (see
Resolved Decisions) — friend-request/DM automation stays personal-profile-only.

**Day-of-week content calendar, per Greg:**
- Mon/Wed — **short-form**: must read as complete within Facebook's post preview, no "See More"
  click needed.
- Tue/Thu — **long-form**: a photo attached separately, by Greg, not generated by the extension.
- Fri — **engagement**: unrelated to the target persona/real estate on purpose — fun, generic
  questions (pop culture, "what tool can't you live without," etc.) designed purely to drive
  comments; a video with a song overlay attached separately, by Greg.
- Sat/Sun — no plan yet, deliberately left undefined rather than guessed.

Human review before posting was explicitly confirmed as wanted (matching D6's assisted-click
philosophy) — a public post is far more visible/permanent than a DM.

- [x] 3.1 Content generation pipeline — built (2026-09-01): `lib/content.js` (day-of-week → content
      type mapping, a Claude call via its own `draft_post` tool schema — separate from
      `lib/claude.js`'s screening-specific schema/prompt, since these are different concerns despite
      both calling Claude — with the same retry-once discipline as `screenCandidate`), `lib/
      contentLedger.js` (one record per calendar date: draft/approved state, the text, and a
      `postedTo` field pre-declared for 3A-3D's not-yet-built posting actions, same reasoning as
      `lib/ledger.js`'s early `STATES` placeholders), and a new **Content** side panel page
      (`sidepanel/content.html`/`content.js`) showing today's content type, a media reminder
      (photo/video note) when relevant, an editable draft textarea with live character count
      (flagging over-limit for short-form's ~400-char guess at Facebook's "See More" cutoff — not
      yet verified against a real post), Generate/Regenerate, and Approve. Verified the day-of-week
      mapping and date-key formatting in a live browser JS sandbox before wiring in.
      **Explicitly a first pass, not final** — the actual prompt wording is a placeholder Greg wants
      to engineer properly later; today's goal was just proving the day-aware pipeline end to end.

      **Real gap found on the first real test, per Greg:** the generated draft came back as plain,
      unstyled text — no emoji, no visual emphasis — which reads flat once actually posted. Root
      cause: Facebook's post composer doesn't render real HTML/markdown formatting on paste, so even
      asking Claude to bold text with markdown wouldn't survive a copy/paste into a real post.
      **Fixed:** added `lib/facebookFormat.js` — converts `**bold**` markdown into actual Unicode
      "Mathematical Bold" lookalike characters (the same trick used across social media for exactly
      this reason: it's real Unicode codepoints, not markup, so a normal copy/paste carries it
      through perfectly). Applied automatically in `lib/content.js`'s `callClaude`, so the draft
      textarea always holds the final, paste-ready text — no separate "convert" step for Greg to
      remember. Also updated the prompt to ask for a few emphasized phrases (not every sentence) and
      natural emoji use. Verified the conversion in a live browser JS sandbox (produces real bold
      glyphs, strips the asterisks cleanly) before wiring in.
      **Second, related gap found and fixed the same pass:** the bold Unicode characters are outside
      the Basic Multilingual Plane (surrogate pairs in a JS string), so the character-count display
      was silently counting each bold letter as 2 instead of 1 once a draft had much bold text —
      inflating the short-form 400-char guidance for no real reason. `lib/facebookFormat.js`'s new
      `displayLength()` counts by Unicode code point instead of raw `.length`, matching how a person
      would actually count characters; `sidepanel/content.js` now uses it.
      **Confirmed live (2026-09-01):** bold/emoji formatting survived a real copy/paste into
      Facebook.

      **Theme/modifier field added (2026-09-01), per Greg:** an optional free-text field (e.g.
      "Labor Day") that travels with the generation call, letting Greg nudge a specific day's content
      toward a timely angle without touching the underlying day-type guidance — purely additive, the
      day's format rules (length, persona-relevance) still apply on top of it. Saved alongside the
      draft in the content ledger (`saveDraft`'s new `modifier` field) so reopening the page later
      still shows what theme produced a given draft, and Regenerate defaults to the same theme
      instead of silently dropping it. **Confirmed working live.**

      **Content-type override added (2026-09-01), per Greg:** a dropdown (Auto / Short-form /
      Long-form / Engagement) lets Greg force a specific content type instead of always taking the
      day-of-week default — including picking a type on Saturday/Sunday, which otherwise have no
      plan at all. `lib/content.js`'s new `resolveContentPlan(date, overrideType)` is the one place
      that decides "what plan actually applies" — used by both the page's live display (day label,
      media reminder, character-count limit) and `generateContent` itself, so the two can't drift out
      of sync. Verified the resolution logic (day default, explicit override, and overriding an
      otherwise-unplanned weekend day) in a live browser JS sandbox before wiring in. The choice is
      saved alongside the draft (`overrideType` in the content ledger) so reopening the page restores
      it and Regenerate keeps using the same override.

      **Day-of-week defaults moved into Settings (2026-09-01), per Greg:** the Mon/Tue/Wed/Thu/Fri →
      content-type mapping used to be a hardcoded table in `lib/content.js`. Moved to a new
      `contentCalendar` Settings field (a 7-day grid of dropdowns, matching the existing
      `scanLimitsByDay`/`maxRequestsPerDayByDay` day-grid pattern) so Greg can change, say, which days
      are short-form without a code change — the same "everything user-configurable" philosophy as
      D1/D2. `getContentPlanForDate` now takes this map as a parameter instead of reading a baked-in
      table; `resolveContentPlan` and `generateContent` both thread it through. Settings' new dropdown
      options are populated from `lib/content.js`'s own `CONTENT_TYPE_OPTIONS` rather than a second
      hardcoded copy in the Settings page, so the two can't drift apart.

      **Short-form length target revised, per Greg (2026-09-01):** the goal was never really just
      "no See More" — Greg wants short-form posts short enough to use Facebook's colored-background
      text option, a stricter (and undocumented, unverified) limit. `SHORT_FORM_MAX_CHARS` changed
      from the old 400 (a "See More" guess) to 100 (the figure most commonly cited for the
      background option) — still an unconfirmed placeholder, same as the old value was, just a
      better-targeted one; satisfying the smaller limit automatically satisfies "no See More" too.
      **Also fixed a real ambiguity Greg flagged directly:** the bold-Unicode conversion
      (`facebookFormat.js`) inflates the character count in ways that may not match however Facebook
      itself counts characters for its background-eligibility check — rather than guess at that,
      short-form now skips bold formatting entirely (`allowBoldFormatting: false` on the plan,
      threaded through both the prompt — a new `PLAIN_FORMATTING_GUIDANCE` — and `callClaude`, which
      only runs `toFacebookFormatted` for plans that allow it). Long-form and engagement keep bold
      formatting as before. Verified the conditional prompt-building logic in a live browser JS
      sandbox before wiring in. **Pending: Greg tests whether a 100-char short-form draft actually
      shows the background option, and adjusts the number if not.**

      **Copy button added, per Greg:** one click copies the current draft text to the clipboard
      (`navigator.clipboard.writeText`) instead of manually selecting all the text in the box.

      **Panel ordering fixed, per Greg:** the Content section was appearing after Step 9 in the side
      panel despite being numbered Step 3 — pure markup reorder in `panel.html` (Content now sits
      above Step 9), no script changes needed since `panel.js` looks everything up by element ID.

      **Short-form length target confirmed with real data, per Greg (2026-09-01):** Greg empirically
      found Facebook's actual colored-background-option boundary by pasting increasingly long text
      into a real post until the option disappeared. The winning string, counted the same way this
      app counts everywhere else (Unicode code point, matching `displayLength`) — **128 characters**.
      `SHORT_FORM_MAX_CHARS` updated from the 100 placeholder to this real, tested number.

      **Lowered again the same day, per Greg:** the very next real draft came back at 178
      characters — 50 over the 128 target — despite the prompt explicitly saying "MUST be 128
      characters or fewer." Claude didn't reliably respect the cap just from being told in the
      prompt. `SHORT_FORM_MAX_CHARS` lowered to 115 to add margin — not a new measurement of
      Facebook's actual limit, just a tighter target to compensate for the model overshooting. If
      overshoots keep happening at 115 too, the more reliable fix is enforcing the limit in code
      after generation (check the length, re-ask if over) rather than trusting the prompt alone —
      flagged for later, not built yet.

      **That "later" arrived the same day** — the very next real draft came back at 129 characters,
      14 over the 115 target, confirming this wasn't a one-off: Claude doesn't reliably self-track
      character counts while generating, no matter the wording. **Built real enforcement:**
      `generateContent` now measures the actual result length (`displayLength`) and, for any plan
      with `maxChars` set, retries up to `MAX_LENGTH_RETRIES` (2) times with concrete feedback —
      "your previous attempt was N characters, M over the limit, rewrite it to fit" — keeping
      whichever attempt ends up shortest, in case a retry overshoots even worse. Returns
      `overLimit: true` if it's still over after every retry, rather than silently returning a
      non-compliant draft. `sidepanel/content.js` shows a plain, unmissable status message when that
      happens ("Drafted, but still over the limit after retrying — shorten it manually, or
      Regenerate") instead of the normal success message. Verified the retry loop (already-compliant
      first try, fixed by one retry, never fixed after the max retries, and long-form/engagement's
      `maxChars: null` never triggering retries at all) in a live browser JS sandbox before wiring in.
      **Confirmed live (2026-09-01):** next real draft came back at 118 characters (still 3 over
      the 115 target, but Greg confirmed it fit fine on real Facebook — the background option
      showed). Combined with the original 128-char test also confirmed working and the 178-char one
      confirmed failing, the real evidence points to Facebook's actual boundary sitting up near 128,
      not down at 115 — 115 was a defensive overcorrection made before real enforcement existed.
      **Deliberately left at 115 rather than raised, per Greg's own reasoning:** since the retry loop
      still doesn't hit the target with perfect precision (115 → 118, not 115 exactly), that natural
      slop is doing useful work as a built-in safety margin under the true ~128 boundary — raising
      the target to 128 would remove that margin and risk landing right on the edge. No further
      change needed; this is a considered decision, not an open question.

      **Content-recycling avoidance built, per Greg:** Claude is now shown the last ~month of
      *approved* posts (a new Settings field, `recentContentLookbackDays`, default 30 — "the last
      month or so," per Greg's own words) and told not to repeat the same angle/opening/phrasing.
      `lib/contentLedger.js`'s new `getApprovedContentSince(days, excludeDateKey, date)` filters to
      `state === 'approved'` (the closest proxy this app has for "content that actually got posted,"
      since the real posting actions aren't built yet), excludes today's own date so a Regenerate on
      an already-approved day doesn't compare a draft against itself, and sorts oldest-first.
      `lib/content.js`'s `buildPrompt`/`callClaude`/`generateContent` all thread `recentContent`
      through as an explicit parameter — this module stays storage-agnostic, same convention as
      `targetPersona`/`dayTypeMap` already being passed in rather than read internally.
      `sidepanel/content.js` fetches it right before each Generate call. Verified the ledger query
      (window filtering, approved-only, today-exclusion) and the resulting prompt shape in a live
      browser JS sandbox before wiring in. **Pending: Greg confirms drafts actually avoid repeating
      recent content once there's enough approved history to test against.**
- [x] 3.2 3A — Post to personal page (assisted, per Greg's explicit choice, 2026-09-01) — **proven
      live end to end**, after two real bugs found and fixed along the way. Real DOM verified
      against Greg's own personal-page composer:
      clicking the "What's on your mind, &lt;Name&gt;?" prompt opens a real modal popup (not an
      inline expand, not a corner popup like the Messenger composer). The trigger has no aria-label
      of its own — matched by visible text (`MKT.patterns.postComposerTriggerText`,
      `/^What's on your mind, .+\?$/`) rather than a CSS selector, verified against the exact real
      markup in a live browser JS sandbox. The composer itself is Lexical (confirmed by the same
      `data-lexical-editor="true"` marker as the DM composer) but identified by `aria-placeholder`,
      not `aria-label` like the DM composer — `postComposerInput` selector, also verified against
      the real markup.

      **Design, confirmed with Greg:** fully assisted, deliberately — the extension opens the
      composer and types the approved draft in, then stops there. Greg attaches a photo (long-form)
      or picks a background (short-form) and clicks Facebook's own Post button himself; nothing here
      ever clicks Post. This also sidesteps the DM Queue's background-tab focus lesson entirely —
      since Greg needs to end up looking at the open composer anyway, this operates on his own
      ACTIVE tab (navigating it to `facebook.com/me` first if needed, mirroring the Discovery Batch
      auto-navigate fix) rather than a background tab that would need focus restored afterward.

      **Real refactor along the way:** the char-by-char Lexical-typing logic (settle delay, refocus
      retry, human-cadence pacing) used to live only inside the DM composer's `sendComposedMessage`.
      Extracted into a shared `typeIntoLexicalEditor(composer, text)` in `content/act.js`, used by
      both the DM send and this new `typePostDraft` — one implementation instead of two
      near-identical copies, and any future focus/timing fix benefits both callers automatically.
      `content/content.js`'s composer-wait polling was generalized the same way (`waitForComposer` →
      `waitForElement(selector, description)`).

      New content-script message `DRAFT_FEED_POST` (clicks the trigger, waits for the composer,
      types); `sidepanel/content.js` gained a "3A — Personal Page" section with a "Post to Personal
      Page" button, gated on the draft actually being Approved first (re-checks the ledger directly,
      doesn't trust whatever's currently in the textarea).

      **Real bug found on the very first live test, per Greg:** the target URL was hardcoded to
      `https://www.facebook.com/me`, which lands on Greg's actual profile page — a page whose
      composer DOM was never verified (only the main feed's was, from the console output Greg
      pasted). **Fixed, and made configurable at the same time per Greg's own request:** a new
      `personalPageUrl` Settings field (default the plain feed URL that was actually verified)
      replaces the hardcoded constant. There's only one meaningful value for a personal profile
      today, so the real value here is avoiding a future code edit rather than offering a genuine
      choice — but it sets up the same pattern for 3B (business page), where choosing which Page to
      post to will be a real, meaningful setting.
      **Confirmed live (2026-09-01):** navigation now lands on the right page — but a second, more
      serious bug surfaced right behind it, per Greg: clicking the button just made the Content page
      itself vanish, replaced by facebook.com, with "nothing" happening after — no error, no status
      update, and (tellingly) no log entry at all.

      **Root cause found from that missing log entry:** the code reused whatever tab was currently
      *active* (via `chrome.tabs.update`), on the assumption Greg would naturally end up looking at
      it. But Greg clicks "Post to Personal Page" *from the Content page*, making the Content page's
      own tab the active one — so the code navigated the Content page itself to Facebook, destroying
      the very script that was supposed to keep running afterward (send the message, update the
      status, log the result) the instant its own document unloaded. Silent by construction: the JS
      context that would have logged the failure no longer existed once its tab navigated away.

      **Fixed by never touching an existing tab at all:** `openFacebookHomeTab` always opens a
      brand-new tab (made active/foreground, so Greg still ends up looking at it) instead of
      navigating/reusing whatever happens to be active. Slightly less efficient if Facebook's
      already open somewhere, but the only way to guarantee this action can't destroy the page it
      was launched from, or any other tab Greg cares about. Verified in a live browser JS sandbox
      that creating a new tab never touches/navigates an existing one, before wiring in.

      **Second, related gap found and fixed in the same pass:** the click handler's `catch` block
      only ever set the status text, never logged anything — exactly why the first failure left zero
      trace. Moved the log call into a `finally` block so every outcome (success, a normal
      business-logic failure, or a thrown exception) now gets logged, closing this diagnostic gap
      for good regardless of what fails next time.

      **Confirmed live (2026-09-01):** Greg re-tested from the Content page — a new tab opens, the
      Content page stays put, and the composer opens with the draft typed in. 3A (post to personal
      page) is now proven end to end for the first time.
- [!] 3.3 3B — Post to business page — **blocked, not a build task.** Started 2026-09-02 with the
      same scaffolding as 3A (a `businessPageUrl` Settings field, a "3B — Business Page" section on
      the Content page reusing 3A's open-new-tab/type/stop flow), but before any live test of the
      composer selectors, Greg confirmed his Facebook account's own configuration doesn't allow
      posting directly to his business page at all — no selector fix or code change can work around
      an account-level restriction. **Reverted the same day:** the "Post to Business Page" button is
      now permanently `disabled` in `sidepanel/content.html`, labeled "for future development," and
      its click handler was removed from `sidepanel/content.js` entirely (rather than left wired to
      a button nothing can ever click). The `businessPageUrl` Settings field was deliberately left in
      place, with its hint text explaining why the button is disabled — this is a genuine "not right
      now" rather than "never," so the setting stays ready if Greg's account configuration changes.
- [x] 3.4 3C — Post to Story (started 2026-09-02, per Greg) — **proven live on the first try.**
      Scope confirmed with Greg: 3C posts whatever content is approved that day (same rule as
      3A/3B), personal Story only (no business-Page Story support, matching 3B being blocked).

      Real DOM gathered live from `https://www.facebook.com/stories/create` — that URL lands
      directly on a picker with two cards, "Create a photo story" and "Create a text story."
      Clicking the text-story card opens an editor (background/font/music pickers, a preview
      canvas) whose actual text box turned out to be the **same Lexical framework** as the DM and
      post composers (`data-lexical-editor="true"`) — good news, meant the existing
      `typeIntoLexicalEditor` helper in `content/act.js` needed zero changes, just a new caller.

      Added to `content/selectors.js`: `createTextStoryTrigger`
      (`div[role="button"][aria-label="Create a text story"]`, exact match, no dynamic-name suffix
      needed) and `storyTextInput` (`div[aria-label="Story text"][contenteditable="true"]
      [role="textbox"]`) — a third distinct identifying attribute pattern, alongside
      `aria-placeholder` for the post composer and a dynamic-suffix `aria-label` for the DM
      composer. The real "Share to story" button's `aria-label="Share to story"` was also
      confirmed but deliberately NOT stored as a selector — 3C never clicks it, same assisted
      design as 3A/3B (type the text and stop, Greg picks a background/font/music and shares it
      himself).

      `content/act.js` gained `clickCreateTextStoryTrigger()` and `typeStoryText(text)`, mirroring
      3A's `clickPostComposerTrigger`/`typePostDraft`. `content/content.js` gained a
      `DRAFT_STORY_POST` message handler, same shape as `DRAFT_FEED_POST`: click trigger, wait for
      the text box via the existing `waitForElement`, type, stop.

      `sidepanel/content.js`'s 3A click handler was extracted into a shared
      `postApprovedDraft({url, messageType, button, statusEl, logLabel, openingMessage})` helper —
      this time genuinely justified (two real callers, 3A and 3C, not the single-caller case that
      got reverted for 3B) — used by both the "Post to Personal Page" and new "Post to Story"
      buttons. `STORY_CREATE_URL` is a plain constant (not a Settings field, unlike
      `personalPageUrl`/`businessPageUrl`) since it's Facebook's own fixed entry point, the same
      for every install — matches the existing `SUGGESTIONS_URL` pattern in `sidepanel/panel.js`.

      **Confirmed live (2026-09-02):** Greg approved a draft, clicked "Post to Story," and it
      worked on the first try — "worked like a charm." No bugs found this time, unlike 3A — reusing
      3A's already-proven `openFacebookHomeTab` and `typeIntoLexicalEditor` against real, verified
      selectors (never guessed) paid off. 3C (post to Story) is now proven live end to end.
- [~] 3.5 3D — Post to a group Greg runs (started 2026-09-02, per Greg) — **built, pending live
      verification.** Posts whatever content is approved that day (same rule as 3A/3C).

      Real DOM gathered live from Greg's actual "Bookkeeping for Real Estate Investors" group page
      (private, 141 members, Greg is admin). Unlike 3A/3C, clicking the "Write something..." prompt
      expands the composer **inline on the same page**, not a modal popup or a separate screen —
      but it's still the same Lexical framework as everywhere else. The trigger's text is static
      ("Write something...", identical on presumably every group) rather than the personal
      profile's dynamic "What's on your mind, {name}?", so an exact-match pattern is enough — no
      wildcard needed.

      Added to `content/selectors.js`: `groupPostComposerInput`
      (`div[contenteditable="true"][role="textbox"][aria-placeholder="Write something..."]`) and a
      new pattern `groupComposerTriggerText` (`/^Write something\.\.\.$/`), matched the same way as
      `postComposerTriggerText` — searched across all `[role="button"]` elements by trimmed
      textContent, since this trigger has no aria-label of its own either. The real Post button
      (`aria-label="Post"`) was identified but not stored/wired, same reasoning as 3A/3C.

      `content/act.js` gained `clickGroupComposerTrigger()`/`typeGroupPostDraft(text)`.
      `content/content.js` gained a `DRAFT_GROUP_POST` handler, same shape as `DRAFT_FEED_POST`/
      `DRAFT_STORY_POST`. Added `groupUrl` to the Settings schema — blank by default, genuinely
      per-install (and per-group) like `businessPageUrl`, unlike `STORY_CREATE_URL`'s fixed
      constant. `sidepanel/content.js`'s shared `postApprovedDraft` helper (built for 3A/3C) got a
      reintroduced `if (!url)` guard — dropped when it was last rewritten for 3C (whose URL is
      always a non-empty constant), needed again now that 3D's `groupUrl` can genuinely be blank.

      **Next: Greg sets `groupUrl` in Settings, approves a draft, and clicks "Post to Group" live.**
- [ ] 3.6 **ENDPOINT 3 SIGNED OFF**

---

## Phase 4 — Remaining Steps (deferred; mostly filters over existing plumbing)

- [ ] 4.1 Step 2 — Cancel outstanding requests down to 150 when over 200, oldest-last first
- [ ] 4.2 Step 4 — Group invitations
- [-] 4.3 Step 5 — Group invite reminders *(likely not reliably automatable; plan as checklist)*
- [ ] 4.4 Step 6 — Reminder to authentically interact with content (checklist only, by design)
- [ ] 4.5 Step 7 — Birthday messages via Facebook's birthday interface
- [ ] 4.6 Step 8 — Reminder to review incoming friend requests (manual by design)
- [ ] 4.7 Daily dashboard tying all steps into one run-through

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
- [x] D5 **Personal profile only for friend-request/DM automation (Steps 1 and 9)** — no business
      Page automation there. **Revised 2026-09-01, per Greg:** Step 3 (content posting) explicitly
      includes the business Page as one of its four destinations (3B) — this revision is scoped to
      content only; D5's original restriction still holds for Steps 1/9.
- [x] D6 **Assisted click** for friend requests — extension screens, scores, and queues; Greg clicks.

## Open Decisions — need Greg's input

- [!] D7 Risk tolerance / actual cap numbers — defaults recommended in Settings (5–15/day for both
      requests and messages, matching the prior build's own recommended range), but Greg sets the
      real numbers before the first live run.

**Live progress UI added to the side panel (2026-09-01), per Greg:** "Run Discovery Batch" could
run for several minutes showing nothing but a static, unchanging status line the whole time. Added
a CSS spinner (shown while the batch runs, hidden on completion) and a real progress bar/text —
"real" meaning it updates live during the run, not just once at the end. This needed actual new
plumbing: `background/service-worker.js`'s `runDiscoveryBatch` now calls a fire-and-forget
`broadcastProgress()` after every candidate, placed in a `finally` block so it fires exactly once
per iteration regardless of which branch (skip, fresh screen, or error) ran, without duplicating
the call at each exit point. `panel.js` listens for these `BATCH_PROGRESS` messages and updates the
bar/text live; the original request/response call is untouched and still returns the final summary
when the whole batch completes. A `chrome.runtime.sendMessage` with no listener (panel closed)
rejects harmlessly — swallowed since this is a UI nicety the batch doesn't depend on.
**Pending: Greg runs a batch and confirms the spinner/progress bar actually animate and update
live, and disappear correctly when the batch finishes.**

**Panel decluttered (2026-09-01), per Greg's question about whether the old test buttons still
earn their place.** Answer: keep them, but they're no longer daily-use tools — they map directly
to the "selector rot" risk in ARCHITECTURE.md, letting a future breakage be isolated to a specific
layer (list detection / click+nav / scroll+extract / the AI call) without running a whole batch.
Reorganized rather than removed: Review Queue, Send Queue, Run Discovery Batch, and Settings now
sit at the top as the actual daily-use flow; Ping/Test Scrape/Test Click/Test Full Scrape/Test AI
Screening/View Ledger moved into a `<details>` "Diagnostics" section, collapsed by default. Pure
markup reorganization — `panel.js` looks everything up by element ID, not DOM position or
visibility, so no script changes were needed.

**Panel reordered into the real workflow sequence (2026-09-01), per Greg:** Discover → Review →
Send, with numbered step labels above each. Review Queue and Send Queue restyled from plain text
links into button-look-alikes (`.button-link` class) matching Run Discovery Batch's visual weight —
kept as real `<a>` elements rather than converted to `<button>` + `window.open()`, preserving normal
link semantics (right-click "open in new tab," keyboard accessibility). `panel.js` needed zero
changes — both elements are still looked up by the same IDs, just moved and reclassed.

**Live queue counts fixed (2026-09-01), per Greg:** approving people in Review Queue (a separate
tab) never updated the panel's "Send Queue (N queued)" count, since it was only ever computed once
when the panel first opened — confirmed directly from the code before fixing. Refactored the count
logic into `refreshQueueCounts()` and wired a `chrome.storage.onChanged` listener watching the
`mkt_ledger` key specifically (confirmed the exact key name against `lib/ledger.js` rather than
assume it), which fires for a ledger write from *any* extension page/tab — so the panel now stays
live regardless of where the change actually happened. No new permission needed (already covered
by the existing `storage` permission). Same technique could extend to live-updating Review/Send
Queue's own lists if a Discovery Batch runs while one is open — not built, just noted as an
available option if it comes up.

**Panel section labels renumbered (2026-09-01), per Greg, ahead of starting Step 3 (content
creation):** the panel had informally labeled its Discover/Review/Send sections "Step 1," "Step 2,"
and "Step 3" — a real naming collision waiting to happen, since the ORIGINAL 9-step plan's actual
Step 2 is "cancel outstanding requests" and actual Step 3 is "content generation" (Phase 3 below),
which is exactly the work about to start. Relabeled to **Step 1A (Discover), 1B (Review), 1C
(Send)** — all three sub-parts of the plan's real Step 1 (Friend Discovery & Queueing), which is
what they always were. Confirmed with Greg: Step 9 (Check Accepted Friends / DM Queue) keeps its
number as-is rather than becoming "Step 2," since Steps 2 and 3-8 remain deferred/unbuilt and
renumbering it would just trade one inconsistency for another. Pure markup label changes in
`panel.html` — no script changes needed.

**Ledger manager built (2026-09-01), per Greg:** "View Ledger" was a plain read-only JSON dump in
the panel's collapsed Diagnostics section — no way to remove specific unwanted entries, only the
existing blunt `clearByState` ("Reset Queue," which only ever deletes *everyone* in `needs_review`
or `queued`). Greg pictured "an interface where I can tick checkboxes and then choose to delete."
Built as its own page, `sidepanel/ledger.html`/`ledger.js` ("Ledger," linked from the main panel next
to Settings, not tucked in Diagnostics since this is a real management tool, not a debugging aid):
a table of every person in the ledger with a checkbox per row, name/state/tier/confidence/discovered
columns, a name search box and a state filter (populated from `lib/ledger.js`'s own `STATES` enum
rather than a second hardcoded list), a "select all" checkbox scoped to only the currently *visible*
(filtered) rows — switching filters never silently selects something Greg didn't actually see — and
a "Delete Selected (N)" button gated by a confirm dialog naming the exact count, same discipline as
Reset Queue. New `lib/ledger.js` function, `deletePeople(ids)`, deletes specific people by id
entirely (not just a state change), mirroring `clearByState`'s existing irreversibility discipline.
Verified the filter/select-all interaction (selecting within a filtered view doesn't falsely mark
"select all" checked once the filter changes to show unselected people) in a live browser JS sandbox
before wiring in. **Pending: Greg tries it live and confirms selecting and deleting specific records
works as expected.**

**Content Ledger manager built (2026-09-01), per Greg:** same checkbox-based delete interface,
now for Step 3's content ledger, which had no delete capability at all before this. Built as
`sidepanel/contentLedger.html`/`contentLedger.js` ("Manage Content Ledger," linked from the main
panel next to Manage Ledger) — a table of every date's content record (date, day, content type,
state, a truncated text preview) with a checkbox per row, a text search over the post content, state
and content-type filters, a filter-scoped "select all," and a "Delete Selected (N)" button gated by
a confirm dialog — same shape as the Person Ledger manager, including the same "select all only acts
on visible rows" reasoning. New `lib/contentLedger.js` functions: `getAllContent()` (every record,
newest-first) and `deleteContent(dateKeys)` (deletes specific dates entirely). **Pending: Greg tries
it live.**

**Content angle rotation built (2026-09-01), per Greg:** three consecutive real short-form drafts
all landed on nearly identical generic phrasing ("build your real estate empire," etc.). Root
cause: an open-ended "write a post about this persona" prompt gives Claude nothing to differentiate
one call from the next — the existing "avoid recycling" mechanism only helps once there's *approved*
history to compare against, so it didn't explain (or fix) same-session repeats where nothing had
been approved yet. Built a selectable **Angle** dropdown on the Content page: "None" (original
behavior), 8 specific angles (common mistake, myth-busting, practical tip, industry fact, personal
story, mindset/motivation, contrarian take, direct question — `CONTENT_ANGLES` in `lib/content.js`,
exported as the single source of truth), or **"Surprise me"** — which hands Claude the whole angle
list and lets it choose, reporting which one via a new `angleUsed` field on the `draft_post` tool
schema so the choice stays auditable rather than a black box. Independent of the existing
theme/modifier field — Greg can combine both, or use either alone. The resolved angle (whatever Greg
picked, or whatever Claude reported in Surprise-me mode) is saved alongside the draft
(`angleChoice`/`resolvedAngle` in the content ledger) and shown in the Content page's status message
after Generate. Verified the three prompt-assembly branches (none/specific/surprise, including an
invalid id falling back to "none" rather than crashing) in a live browser JS sandbox before wiring
in. Also flagged, not a code change: the current "Target persona" Settings text was written for
Step 1's friend-screening, not content/brand direction, and is fairly thin material for Claude to
riff on — enriching it is a lever Greg can pull himself, no code change needed. **Pending: Greg
tests whether picking specific angles (or Surprise me) actually produces more varied drafts.**

---

## Session Log

| Date | Phase | What happened |
|---|---|---|
| 2026-08-31 | 0 | Scope confirmed, architecture drafted, workflow map created. No code yet. Flagged Google Drive repo-location risk. |
| 2026-08-31 | 0 | Moved repo to `C:\dev\marketing-extension`. Reviewed prior build's settings pages (screenshots). Confirmed root cause of old bug: fuzzy-matching false negatives. Resolved D1–D6; redesigned Step 1 into a three-tier fuzzy-keyword + AI pipeline with confidence bands. Added Test Mode as a Phase 0 requirement. Switched session to Sonnet for implementation work. |
| 2026-08-31 | 1 | Full Step 1 core loop built and proven live end to end: extension skeleton, git/GitHub, `lib/fuzzy.js` (verified against the real bug case), real selectors verified against live Facebook DOM (Add Friend, profile link, mutual-friends pattern, Remove button, list scroll-container discovery), scrape/click/scroll/extract pipeline, `lib/claude.js` (real Anthropic API client with retry), exact-match/fuzzy-exclude/AI tiering, `lib/verdict.js` confidence bands, `lib/ledger.js` (Person Ledger with dedupe), `runDiscoveryBatch` orchestration loop, side panel Review Queue and Send Queue (assisted-click sending with a verified profile-page fallback), and Reset Queue. **First real friend request sent live** (Aaron Bihl). Eight-plus real bugs found and fixed along the way (see inline notes above for detail on each): fuzzy false negatives, candidate-detection false positives from Facebook's own nav bar, extraction picking up list noise instead of profile content, a ledger identity collision on numeric-ID profile URLs, a missing AI-call retry that let one flaky response abort an entire batch, an XSS risk from unsafe `innerHTML` interpolation in the Review Queue, a dedupe check that ran after the expensive scrape instead of before it, and a scoping bug in Add Friend clicking caught before it ever shipped. |
| 2026-09-01 | 1 | Clarified two settings were completely inert (min/max delay, `autoSend`) by grepping the codebase rather than guessing — deferred a real fix pending an architecture decision (in-process delay vs. `chrome.alarms`). Verified auto-approve only ever changes ledger state, never touches the DOM, and confirmed no autonomous Add Friend path exists anywhere. Made the daily send limit variable per day of week (was flat), with a verified migration so Greg's already-configured value wasn't silently discarded. Added Reset Queue to Review/Send pages. Added a live spinner + progress bar to the side panel's batch runner, fed by a new fire-and-forget progress broadcast from the background loop. |
| 2026-09-01 | 1/2 | Closed the inter-candidate pacing gap (3-15s between candidates in a scan batch). Built and verified stale-friend-request cleanup (cancel outstanding requests past `staleRequestDays`, both branches confirmed live). Made the Send Queue's "no suggestions tab" error message clickable. Built the "Process All" Send Queue automation (sends up to today's limit automatically, ~8-18s apart, with a confirm dialog and an interruptible Stop button). Found and fixed a real bug on its first live run (no automatic profile-page fallback when no suggestions tab was open at all — every attempt failed the same way). Re-confirmed live: Process All and Stop both work correctly against real Facebook data. |
| 2026-09-01 | 2 | Built Step 9's greeting DM foundation and full send pipeline: cohort query, template rendering (no AI drafting, per Greg), the real Messenger composer automation (Lexical contenteditable, execCommand insertText, simulated Enter — no Send button exists), and a DM Queue review page. Found and fixed three real bugs found live in sequence: a 15s round-trip timeout left over from before human-like pacing was added (cutting sends off mid-message), a dropped first character, and the daily message/send caps only blocking at page load instead of live mid-session (fixed in both Send Queue and DM Queue). Confirmed live end to end, pacing included. Renumbered the panel's Discover/Review/Send labels to 1A/1B/1C to free up "Step 3" for content creation, per Greg. |
| 2026-09-01 | 3 | Started Endpoint 3 (Step 3, Content Creation), per Greg's day-of-week content calendar (short-form Mon/Wed, long-form Tue/Thu with a manually-attached photo, generic engagement Fri with a manually-attached video). Confirmed 3A-3D are four destinations (personal/business/story/group) sharing one content plan, not four pipeline stages — revises D5 to allow business Page automation for content specifically. Built the day-of-week → Claude generation pipeline, a content ledger (draft/approved state per date), and a new Content review page (editable draft, live char count, Generate/Approve) — a first pass, with the actual prompt wording explicitly deferred for later refinement. |
| 2026-09-01 | 1 | MV3 hazard #2 (service worker termination) confirmed live for the first time: a real 50-candidate Discovery Batch silently died ~27 minutes in with the classic "message channel closed" signature. Rebuilt `runDiscoveryBatch` around `chrome.alarms` (`startDiscoveryBatch`/`processDiscoveryStep`) so no single invocation spans more than a small bounded chunk of work, with full progress persisted to storage after every step and the next step scheduled via an alarm rather than an in-process wait. Confirmed from Chrome's own docs that alarms won't fire sooner than ~30s, so the old 3-15s pacing is now a floor of ~30s — flagged plainly in Settings and both docs rather than changed silently. Handled the resumed-batch edge cases: a closed/navigated-away original tab fails gracefully, a stranded alarm from a dev reload self-heals, and a second concurrent batch attaches to the existing one instead of racing it. Changed the side panel's `RUN_DISCOVERY_BATCH` contract to start-and-return-immediately, added a `BATCH_COMPLETE` broadcast and `GET_BATCH_STATUS` message, and added a Stop button. Built, explicitly **not yet live-verified** — see the test checklist earlier in this file and ARCHITECTURE.md hazard #2. Left `checkAcceptances`'s similar-shaped risk untouched and noted for later, since it hasn't failed in practice. |
