// *** ALL Facebook DOM selectors live here, nowhere else. ***
//
// Verified against live DOM from facebook.com/friends/suggestions on
// 2026-08-31 (Greg pasted real outerHTML). Confirmed mechanism: the left-pane
// list shows only name + mutual-friend count, no bio/work text — screening
// requires clicking into a candidate to load their detail into a right-hand
// pane (see WORKFLOW-MAP.md Phase 1 notes). Right-pane selectors are still
// pending a live DOM sample of that pane.
//
// Prefer semantic anchors (aria-label, role, visible text) over Facebook's
// obfuscated atomic CSS class names (the `x1i10hfl`-style classes) — those
// rotate and carry no meaning. The Diagnose self-test (task 0.15) verifies
// every selector below against the live page on demand.

(function () {
  const MKT = (self.MKT ||= {});

  MKT.selectors = {
    // Facebook renders a hidden decoy copy of this button (and of the
    // post-request "Remove" button) for animation purposes. The real,
    // clickable one has tabindex="0"; the decoy has aria-hidden="true" and
    // tabindex="-1". Without excluding aria-hidden, this would silently
    // match a phantom button that does nothing when clicked.
    addFriendButton: 'div[role="button"][aria-label="Add friend" i]:not([aria-hidden="true"])',

    // The name/photo link's aria-label is the bare person name — distinct
    // from mutual-friend avatar links, which are prefixed
    // "Profile picture of ... who is a mutual friend".
    candidateProfileLink:
      'a[role="link"][aria-label]:not([aria-label^="Profile picture of"])',

    // Same decoy pattern as Add Friend: a hidden aria-hidden/tabindex="-1"
    // copy exists alongside the real one. The aria-label is dynamic
    // ("Remove <person's name>"), so this matches by prefix rather than an
    // exact string — verified against a synthetic two-person page with
    // decoys present for both.
    removeButton: '[aria-label^="Remove "][role="button"]:not([aria-hidden="true"])',

    // Confirmed live (2026-08-31): on a person's OWN profile page, the Add
    // Friend button's aria-label is completely different from the
    // suggestions-list version above — "Add Friend <Name>" (capital F, name
    // appended) versus "Add friend" (lowercase, bare) in the list. These are
    // NOT interchangeable; verified they don't cross-match each other.
    // Exists as a fallback for when a queued person is no longer rendered
    // in the (virtualized) suggestions list — their profile URL still works
    // regardless of list state.
    profileAddFriendButton: '[aria-label^="Add Friend "][role="button"]:not([aria-hidden="true"])',

    // TODO Phase 1: no reliable container selector confirmed yet for "one
    // candidate row" as a whole (needed to associate a name link with its
    // Add Friend button, and to iterate the left-pane list in order).
    // Facebook's wrapping divs carry only obfuscated classes. Resolve this
    // once we're testing against the live page directly (Diagnose helps
    // here — it can report the actual ancestor chain).
    candidateRow: null,

    // TODO Phase 1: right-hand detail pane selectors — pending a live DOM
    // sample of that pane (bio/work/"Intro" section) after clicking a
    // candidate in the left list.
    detailPaneContainer: null,
    detailPaneBioText: null,
  };

  // Not a CSS selector — mutual-friend count is plain visible text with no
  // stable attribute hook, so it's matched by pattern instead.
  MKT.patterns = {
    mutualFriendsCount: /^\d[\d,]*\s+mutual friends?$/i,
  };
})();
