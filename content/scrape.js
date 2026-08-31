// Read-only DOM access. Never clicks or types anything — see act.js for that.

(function () {
  const MKT = (self.MKT ||= {});
  MKT.scrape = MKT.scrape || {};

  MKT.scrape.pageInfo = function () {
    return { url: location.href, title: document.title };
  };

  // Facebook's wrapper divs carry no stable selector for "the thing that
  // scrolls" (verified live: the list's scroll container is a bare <div>
  // with an obfuscated class and no role/aria-label). Rather than hardcode
  // a class name that breaks on the next Facebook CSS rebuild, discover the
  // real scroll container at runtime by walking up from a known-good anchor.
  function findScrollableAncestor(el) {
    while (el) {
      const cs = getComputedStyle(el);
      if ((cs.overflowY === 'auto' || cs.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 10) {
        return el;
      }
      el = el.parentElement;
    }
    return document.scrollingElement || document.documentElement;
  }

  // Segments that are never a person's profile slug — used to tell "we
  // navigated to someone's profile" apart from Facebook's other sections.
  const RESERVED_FIRST_SEGMENTS = new Set([
    'friends', 'groups', 'messages', 'watch', 'marketplace', 'gaming',
    'events', 'notifications', 'settings', 'help', 'pages', 'photo', 'photo.php',
    'login', 'reel', 'stories', 'ads', 'business',
  ]);

  MKT.scrape.isProfileUrl = function (href) {
    try {
      const u = new URL(href);
      if (u.hostname !== 'www.facebook.com' && u.hostname !== 'facebook.com') return false;
      const segments = u.pathname.split('/').filter(Boolean);
      if (segments.length !== 1) return false;
      return !RESERVED_FIRST_SEGMENTS.has(segments[0].toLowerCase());
    } catch {
      return false;
    }
  };

  // Walks up from `startEl` looking for the nearest ancestor whose subtree
  // contains an element matching `matchSelector`. Bounded so a missing match
  // can't walk all the way to <html>.
  function findAncestorContaining(startEl, matchSelector, maxDepth = 10) {
    let el = startEl;
    for (let i = 0; i < maxDepth && el; i++) {
      el = el.parentElement;
      if (!el) break;
      const match = el.querySelector(matchSelector);
      if (match) return { ancestor: el, match };
    }
    return null;
  }

  // Anchored on the Add Friend button, not the profile link — Facebook's own
  // top nav (Home, Reels, Groups, Gaming, ...) also uses
  // `a[role="link"][aria-label]`, so scanning for that selector directly
  // pulls in nav-bar noise. Verified live: this misidentified 4 nav links as
  // "candidates" before the fix. The Add Friend button has no such false
  // positives, so real candidates are found by walking up from it instead.
  MKT.scrape.listCandidates = function () {
    const buttons = document.querySelectorAll(MKT.selectors.addFriendButton);
    const results = [];
    for (const btn of buttons) {
      const found = findAncestorContaining(btn, MKT.selectors.candidateProfileLink);
      if (found) {
        results.push({ name: found.match.getAttribute('aria-label'), href: found.match.href });
      }
    }
    return results;
  };

  MKT.scrape.getListScrollContainer = function () {
    const anchor = document.querySelector(MKT.selectors.addFriendButton);
    if (!anchor) return null;
    return findScrollableAncestor(anchor);
  };

  MKT.scrape.scrollList = function (amount = 800) {
    const container = MKT.scrape.getListScrollContainer();
    if (!container) return false;
    container.scrollBy(0, amount);
    return true;
  };

  // Confirmed live: the detail pane's scrollable ancestor is <html> itself
  // (document.scrollingElement), unlike the list, which has its own
  // internal scroll container. A plain window scroll is enough here.
  MKT.scrape.scrollDetailPane = function (amount = 800) {
    window.scrollBy(0, amount);
  };

  // Mirrors the prior (validated) approach: grab all visible text rather
  // than dissect individual Intro-box fields, and let keyword/AI matching
  // find industry signal wherever it appears (see WORKFLOW-MAP.md Phase 1).
  MKT.scrape.extractVisibleText = function () {
    return document.body.innerText;
  };
})();
