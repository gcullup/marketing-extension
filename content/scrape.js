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

  MKT.scrape.listCandidates = function () {
    const links = document.querySelectorAll(MKT.selectors.candidateProfileLink);
    return [...links].map((link) => ({
      name: link.getAttribute('aria-label'),
      href: link.href,
    }));
  };

  MKT.scrape.getListScrollContainer = function () {
    const anchor = document.querySelector(MKT.selectors.candidateProfileLink);
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
