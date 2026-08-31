// The only file allowed to click or type. Every action here checks Test
// Mode via the caller — this file itself stays dumb and mechanical so the
// "did we actually click something real" question always has one answer.

(function () {
  const MKT = (self.MKT ||= {});
  MKT.act = MKT.act || {};

  MKT.act.clickCandidate = function (href) {
    const link = [...document.querySelectorAll(MKT.selectors.candidateProfileLink)].find(
      (a) => a.href === href
    );
    if (!link) return { clicked: false, reason: 'candidate link not found' };
    link.click();
    return { clicked: true };
  };

  MKT.act.clickAddFriend = function (testMode) {
    const btn = document.querySelector(MKT.selectors.addFriendButton);
    if (!btn) return { clicked: false, reason: 'add friend button not found' };
    if (testMode) return { clicked: false, reason: 'test mode — no real click performed' };
    btn.click();
    return { clicked: true };
  };

  // Dismisses a rejected candidate from the suggestions list via Facebook's
  // own "Remove" affordance — per Greg's design (2026-08-31), so rejected
  // people stop cluttering future scans instead of just sitting inert in
  // the ledger. Scoped to the SPECIFIC candidate (walks up from their own
  // profile link to find their own Remove button), not just "the first
  // Remove button on the page" — verified against a synthetic two-person
  // page that this can't cross-wire and click the wrong person's button.
  MKT.act.removeCandidate = function (href, testMode) {
    const link = [...document.querySelectorAll(MKT.selectors.candidateProfileLink)].find(
      (a) => a.href === href
    );
    if (!link) return { removed: false, reason: 'candidate not found in list' };
    const found = MKT._findAncestorContaining(link, MKT.selectors.removeButton);
    if (!found) return { removed: false, reason: 'remove button not found' };
    if (testMode) return { removed: false, reason: 'test mode — no real click performed' };
    found.match.click();
    return { removed: true };
  };
})();
