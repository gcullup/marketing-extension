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

  MKT.scrape.scrollList = function (amount) {
    const container = MKT.scrape.getListScrollContainer();
    if (!container) return false;
    container.scrollBy({ top: amount, left: 0, behavior: 'smooth' });
    return true;
  };

  // Confirmed live: the detail pane's scrollable ancestor is <html> itself
  // (document.scrollingElement), unlike the list, which has its own
  // internal scroll container. A plain window scroll is enough here.
  // `behavior: 'smooth'` animates the scroll rather than jumping instantly —
  // a real mouse-wheel/trackpad scroll is never an instant jump.
  MKT.scrape.scrollDetailPane = function (amount) {
    window.scrollBy({ top: amount, left: 0, behavior: 'smooth' });
  };

  // Mirrors the prior (validated) approach: grab all visible text rather
  // than dissect individual Intro-box fields, and let keyword/AI matching
  // find industry signal wherever it appears (see WORKFLOW-MAP.md Phase 1).
  //
  // Confirmed live this needed a fix: the persistent left-hand suggestions
  // list sits earlier in the DOM than the clicked candidate's own content,
  // and a plain document.body.innerText grab returned page after page of
  // "50 mutual friends / Add friend / Remove" noise with none of the actual
  // candidate's content — the split-view layout means the list is still
  // fully attached to the page, not swapped out. `excludeEl` (the list's
  // scroll container, from getListScrollContainer()) is temporarily hidden
  // via visibility so it's excluded from innerText's rendered-text
  // computation, then immediately restored. Verified in a live browser JS
  // engine: correctly drops the list's text, keeps the real content, and
  // leaves visibility exactly as it was afterward.
  MKT.scrape.extractVisibleText = function (excludeEl) {
    if (!excludeEl) return document.body.innerText;
    const prevVisibility = excludeEl.style.visibility;
    excludeEl.style.visibility = 'hidden';
    const text = document.body.innerText;
    excludeEl.style.visibility = prevVisibility;
    return text;
  };

  // A personal business website (verified live: giuseppebuyshouses.com) is a
  // far stronger, less ambiguous signal than anything in the free-text blob
  // — worth surfacing to the AI as its own explicit field rather than hoping
  // it's noticed inside a wall of text. `excludeEl` filters out the
  // persistent list's own links (a[href] isn't affected by the
  // visibility-hiding trick used above, so this checks DOM containment
  // directly instead). Facebook's own domains are filtered out since
  // they're internal chrome, not a signal about the person.
  const FACEBOOK_HOST_SUFFIXES = ['facebook.com', 'fb.com', 'fb.watch', 'fbcdn.net'];
  function isFacebookHost(hostname) {
    const host = hostname.replace(/^www\./, '');
    return FACEBOOK_HOST_SUFFIXES.some((suffix) => host === suffix || host.endsWith('.' + suffix));
  }

  MKT.scrape.extractExternalLinks = function (excludeEl) {
    const anchors = document.querySelectorAll('a[href]');
    const externalHrefs = new Set();
    for (const a of anchors) {
      if (excludeEl && excludeEl.contains(a)) continue;
      try {
        const u = new URL(a.href);
        if (isFacebookHost(u.hostname)) continue;
        externalHrefs.add(u.origin + u.pathname.replace(/\/$/, ''));
      } catch {
        // Ignore unparseable hrefs (e.g. javascript:void(0)).
      }
    }
    return [...externalHrefs];
  };
})();
