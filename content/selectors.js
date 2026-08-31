// *** ALL Facebook DOM selectors live here, nowhere else. ***
//
// UNVERIFIED PLACEHOLDERS. Facebook ships obfuscated, rotating class names —
// these values have NOT been checked against the live site and must not be
// trusted. Phase 1, task 1.1 replaces them with selectors confirmed against
// the real DOM, preferring semantic anchors (aria-label, role, visible text)
// over class names, and the Diagnose self-test (task 0.16) verifies each one
// against the live page on demand.

(function () {
  const MKT = (self.MKT ||= {});
  MKT.selectors = {
    // TODO Phase 1: verify against facebook.com/friends/suggestions
    suggestionCard: '[data-testid="friend-suggestion-card"]',
    addFriendButton: '[aria-label="Add Friend"], [aria-label="Add friend"]',
    profileLink: 'a[role="link"][href*="/"]',
  };
})();
