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
})();
