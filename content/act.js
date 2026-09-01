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

  // Fallback for when a queued person is no longer rendered in the
  // suggestions list (confirmed live, 2026-08-31 — the very first real Send
  // Queue test hit this immediately): assumes the caller has already
  // navigated this tab/page to the person's own profile URL. No scoping
  // needed here, unlike the list-based functions above — there's only one
  // relevant Add Friend button on a whole profile page.
  MKT.act.clickProfileAddFriend = function (testMode) {
    const btn = document.querySelector(MKT.selectors.profileAddFriendButton);
    if (!btn) return { sent: false, reason: 'profile add friend button not found' };
    if (testMode) return { sent: false, reason: 'test mode — no real click performed' };
    btn.click();
    return { sent: true };
  };

  // Withdraws a still-outstanding friend request via Facebook's own "Cancel
  // Request" affordance — per Greg's design (2026-09-01), for anyone who
  // hasn't accepted after settings.staleRequestDays. Same assumption as
  // clickProfileAddFriend: caller has already navigated here.
  MKT.act.cancelFriendRequest = function (testMode) {
    const btn = document.querySelector(MKT.selectors.profileCancelRequestButton);
    if (!btn) return { cancelled: false, reason: 'cancel request button not found' };
    if (testMode) return { cancelled: false, reason: 'test mode — no real click performed' };
    btn.click();
    return { cancelled: true };
  };

  // Opens the chat popup for Step 9's greeting DM — not gated by Test Mode,
  // same reasoning as clicking into a candidate's profile: opening the UI
  // isn't the policed action, sending a message is. Same assumption as
  // clickProfileAddFriend: caller has already navigated to the person's
  // profile page.
  MKT.act.clickProfileMessage = function () {
    const btn = document.querySelector(MKT.selectors.profileMessageButton);
    if (!btn) return { opened: false, reason: 'message button not found' };
    btn.click();
    return { opened: true };
  };

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // Types the greeting DM into the (Lexical-based, contenteditable) chat
  // composer and sends it. Confirmed live (2026-09-01), from Aaron Bihl's
  // real chat popup: there is no separate Send button in this UI — pressing
  // Enter is the only way to send, so that's simulated here rather than
  // clicked. `execCommand('insertText', ...)` is used instead of directly
  // setting textContent because Lexical (like most rich-text editors)
  // maintains its own internal state synced off real browser input events —
  // a raw DOM mutation wouldn't update that state and Enter would likely
  // send nothing or something stale. Confirmed live (2026-09-01) this
  // reconciles correctly against the real editor and the simulated Enter
  // actually sends.
  //
  // Typed one character at a time with a randomized human-typing cadence
  // (occasional longer pause thrown in), per Greg's observation (2026-09-01)
  // that the whole message appearing at once read as an obvious script, not
  // a person typing — same "don't look bot-like" reasoning already applied
  // to profile scrolling in content.js. A brief pause before Enter, and
  // another few seconds after it's sent before returning, replace what was
  // previously an instant type-send-close sequence — the caller
  // (sidepanel/dm.js's sendGreetingDm) closes the background tab as soon as
  // this response comes back, so the pause belongs here, not in the caller.
  MKT.act.sendComposedMessage = async function (text, testMode) {
    const composer = document.querySelector(MKT.selectors.messageComposerInput);
    if (!composer) return { sent: false, reason: 'message composer not found' };

    // Real bug found live (2026-09-01): the first character was silently
    // dropped, most likely because Lexical's own focus-time setup (it
    // manages its own selection state on top of the native DOM) hadn't
    // finished in the same tick as our .focus() call. Give it a moment to
    // actually settle before typing starts, with one retry if it somehow
    // still isn't the focused element.
    composer.focus();
    await delay(300);
    if (document.activeElement !== composer) {
      composer.focus();
      await delay(300);
    }

    let typedCount = 0;
    for (const char of text) {
      // Re-assert focus before every character as cheap insurance against
      // losing it mid-typing — a second real bug found the same test run:
      // typing stopped partway through and the tab closed, consistent with
      // execCommand silently failing once the composer stopped being the
      // focused/selected element. Focusing an element that's already
      // focused is a no-op, so this doesn't disturb the caret when nothing
      // actually went wrong.
      if (document.activeElement !== composer) composer.focus();
      const inserted = document.execCommand('insertText', false, char);
      if (!inserted) {
        // Substantially more diagnostic detail than a bare failure — this
        // exact failure mode wasn't reproducible outside a real Facebook
        // session, so if it happens again this is what tells us why instead
        // of guessing a third time.
        return {
          sent: false,
          reason: 'insertText command failed partway through typing',
          typedCount,
          totalLength: text.length,
          currentText: composer.textContent,
          wasFocused: document.activeElement === composer,
        };
      }
      typedCount++;
      const isPause = Math.random() < 0.12;
      await delay(isPause ? 150 + Math.random() * 250 : 35 + Math.random() * 90);
    }

    if (testMode) {
      await delay(3000 + Math.random() * 2000);
      return { sent: false, reason: 'test mode — typed but not sent (check the popup, then send or clear it yourself)' };
    }

    await delay(400 + Math.random() * 500); // a beat before hitting Enter, like reviewing what was just typed
    const enterOpts = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true };
    composer.dispatchEvent(new KeyboardEvent('keydown', enterOpts));
    composer.dispatchEvent(new KeyboardEvent('keyup', enterOpts));
    await delay(3000 + Math.random() * 2000); // stay on the message a few seconds rather than closing instantly
    return { sent: true };
  };
})();
