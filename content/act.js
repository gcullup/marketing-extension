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

  // Sends a friend request to a SPECIFIC candidate in the list — replaces an
  // earlier clickAddFriend that just grabbed the first Add Friend button
  // anywhere on the page (the same scoping bug already found and fixed for
  // Remove, caught here before it ever shipped since this one was never
  // wired to anything). Verified against a synthetic two-person page that
  // this can't cross-wire and click the wrong person's button.
  MKT.act.sendFriendRequest = function (href, testMode) {
    const link = [...document.querySelectorAll(MKT.selectors.candidateProfileLink)].find(
      (a) => a.href === href
    );
    if (!link) return { sent: false, reason: 'candidate not found in list' };
    const found = MKT._findAncestorContaining(link, MKT.selectors.addFriendButton);
    if (!found) return { sent: false, reason: 'add friend button not found' };
    if (testMode) return { sent: false, reason: 'test mode — no real click performed' };
    found.match.click();
    return { sent: true };
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
