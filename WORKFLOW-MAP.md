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
- [ ] 0.7 Extension skeleton: `manifest.json` (MV3), folder layout
- [ ] 0.8 Load unpacked in Chrome, confirm it appears and the side panel opens
- [ ] 0.9 Storage layer (`lib/store.js`) — versioned schema, export/import backup
- [ ] 0.10 Logger (`lib/log.js`) — every action + every AI call recorded, viewable & exportable
- [ ] 0.11 Settings page — target persona description, include/exclude keyword lists, daily scan
      match limits per day of week, send caps (requests/day, messages/day), timing (min/max delay,
      spread-over-hours), message templates (`{firstName}` token), API key, model ID, confidence
      threshold slider, Test Mode toggle, auto-send toggle
- [ ] 0.12 Claude API client (`lib/claude.js`) — structured output, validation, retry, response cache
- [ ] 0.13 `lib/fuzzy.js` — fuzzy string matching for include/exclude keyword tiers (fixes the
      confirmed root cause of the prior build's false negatives on typos/variants)
- [ ] 0.14 `selectors.js` — ALL Facebook DOM selectors isolated in one file
- [ ] 0.15 **"Diagnose" self-test button** — checks every selector against the live page, reports which broke
- [ ] 0.16 **Test Mode** — full pipeline runs (scan → fuzzy match → AI score → queue) without ever clicking Add Friend or Send

---

## Phase 1 — ENDPOINT 1: Step 1, Friend Discovery & Queueing

- [ ] 1.1 Content script scrapes the friend-suggestions feed (handle virtual scrolling)
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
