// Entry point injected on facebook.com. Wires the scrape/act namespaces
// (loaded before this file, see manifest.json) to messages from the
// background service worker and the side panel.

(function () {
  const MKT = (self.MKT ||= {});
  console.log('[TNG Marketing Extension] content script loaded on', location.href);

  chrome.runtime.sendMessage({ type: 'PING' }, (response) => {
    if (chrome.runtime.lastError) {
      console.warn(
        '[TNG Marketing Extension] background not reachable:',
        chrome.runtime.lastError.message
      );
      return;
    }
    console.log('[TNG Marketing Extension] background responded:', response);
  });

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // Waits for a smooth scroll to finish (the 'scrollend' event) rather than
  // a fixed guess, so pacing adapts to however long the animation actually
  // takes instead of a hardcoded number. `target` defaults to window (the
  // detail pane) but the list has its own scrollable element, which fires
  // its own 'scrollend' rather than window's. Falls back to a timeout in
  // case 'scrollend' doesn't fire (e.g. the scroll distance was ~0).
  function waitForScrollSettled(target = window, timeoutMs = 1200) {
    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        target.removeEventListener('scrollend', finish);
        resolve();
      };
      target.addEventListener('scrollend', finish, { once: true });
      setTimeout(finish, timeoutMs);
    });
  }

  function checkCachedScreening(profileUrl) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'CHECK_CACHED_SCREENING', profileUrl }, (response) => {
        resolve(chrome.runtime.lastError ? { cached: false } : response);
      });
    });
  }

  function waitForProfileUrl(timeoutMs = 6000) {
    return new Promise((resolve, reject) => {
      const startedAt = Date.now();
      const poll = setInterval(() => {
        const elapsed = Date.now() - startedAt;
        if (MKT.scrape.isProfileUrl(location.href)) {
          clearInterval(poll);
          resolve(elapsed);
        } else if (elapsed > timeoutMs) {
          clearInterval(poll);
          reject(new Error('timed out waiting for URL to change to a profile'));
        }
      }, 250);
    });
  }

  // Polls for a selector to actually be in the DOM rather than a fixed
  // guess — used after clicking something that opens a popup/modal whose
  // open animation takes a moment (the Messenger chat popup, and — added
  // 2026-09-01 — the create-post modal), same reasoning as waitForProfileUrl
  // above. Generalized from a message-composer-specific version so both
  // callers share one polling implementation instead of two near-identical
  // copies.
  function waitForElement(selector, description, timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
      const startedAt = Date.now();
      const poll = setInterval(() => {
        if (document.querySelector(selector)) {
          clearInterval(poll);
          resolve();
        } else if (Date.now() - startedAt > timeoutMs) {
          clearInterval(poll);
          reject(new Error(`timed out waiting for ${description}`));
        }
      }, 250);
    });
  }

  /**
   * The full read path for ONE candidate: check the ledger first (skip
   * entirely if already known), click, wait for navigation, scroll the
   * detail pane a randomized number of times, extract text + external
   * links. Shared by the manual single-candidate test button and the
   * discovery batch loop — takes an explicit {name, href} rather than
   * always assuming "whoever's first", so the batch loop can drive it
   * across the whole list.
   */
  async function scrapeCandidateProfile(target) {
    const cacheCheck = await checkCachedScreening(target.href);
    if (cacheCheck.cached) {
      return {
        ok: true,
        targetName: target.name,
        finalUrl: target.href,
        fromCache: true,
        skippedScrape: true,
        ...cacheCheck,
      };
    }

    const clickResult = MKT.act.clickCandidate(target.href);
    if (!clickResult.clicked) {
      return { ok: false, reason: clickResult.reason };
    }

    let navElapsedMs;
    try {
      navElapsedMs = await waitForProfileUrl();
    } catch (err) {
      return { ok: false, reason: err.message, finalUrl: location.href };
    }

    await delay(800); // let initial profile content render before scrolling

    // Varied distance and animated (not instant-jump) motion per step, plus
    // an occasional longer pause as if actually reading something — a fixed
    // identical-distance instant jump every time is about as bot-like a
    // pattern as exists. This narrows the gap versus real scrolling, but the
    // bigger protection against being flagged is session-level: daily caps
    // and spread-over-hours pacing (see ARCHITECTURE.md), not the physics
    // of one scroll.
    const scrollCounts = [5, 15, 25];
    const chosenScrollCount = scrollCounts[Math.floor(Math.random() * scrollCounts.length)];
    for (let i = 0; i < chosenScrollCount; i++) {
      const distance = 150 + Math.random() * 950;
      MKT.scrape.scrollDetailPane(distance);
      await waitForScrollSettled(window);
      const isReadingPause = Math.random() < 0.15;
      await delay(isReadingPause ? 1500 + Math.random() * 1500 : 250 + Math.random() * 500);
    }

    const listContainer = MKT.scrape.getListScrollContainer();
    const text = MKT.scrape.extractVisibleText(listContainer);
    const links = MKT.scrape.extractExternalLinks(listContainer);
    return {
      ok: true,
      targetName: target.name,
      finalUrl: location.href,
      navElapsedMs,
      scrollCount: chosenScrollCount,
      excludedListNoise: !!listContainer,
      text,
      links,
      textLength: text.length,
      textPreview: text.slice(0, 500),
    };
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === 'GET_PAGE_INFO') {
      sendResponse(MKT.scrape.pageInfo());
      return true;
    }
    if (message?.type === 'TEST_SCRAPE') {
      // Read-only diagnostic: lists what the scraper can currently see on
      // this page without clicking or navigating anything.
      const candidates = MKT.scrape.listCandidates();
      const listContainer = MKT.scrape.getListScrollContainer();
      sendResponse({
        pageIsProfile: MKT.scrape.isProfileUrl(location.href),
        candidateCount: candidates.length,
        candidates: candidates.slice(0, 5),
        hasListScrollContainer: !!listContainer,
      });
      return true;
    }
    if (message?.type === 'TEST_CLICK_FIRST_CANDIDATE') {
      // Actually clicks the first candidate found and navigates to their
      // real profile — not read-only like TEST_SCRAPE. Tests whether a
      // programmatic .click() triggers Facebook's SPA navigation the same
      // way a real user click does, which isn't a safe assumption to skip.
      (async () => {
        const candidates = MKT.scrape.listCandidates();
        if (!candidates.length) {
          sendResponse({ ok: false, reason: 'no candidates found' });
          return;
        }
        const target = candidates[0];
        const clickResult = MKT.act.clickCandidate(target.href);
        if (!clickResult.clicked) {
          sendResponse({ ok: false, reason: clickResult.reason });
          return;
        }
        try {
          const elapsedMs = await waitForProfileUrl();
          sendResponse({ ok: true, targetName: target.name, finalUrl: location.href, elapsedMs });
        } catch (err) {
          sendResponse({ ok: false, reason: err.message, finalUrl: location.href });
        }
      })();
      return true; // keep the message channel open for the async sendResponse
    }
    if (message?.type === 'TEST_FULL_CANDIDATE_SCRAPE') {
      // Manual single-candidate test — always whoever's first in the list.
      (async () => {
        const candidates = MKT.scrape.listCandidates();
        if (!candidates.length) {
          sendResponse({ ok: false, reason: 'no candidates found' });
          return;
        }
        sendResponse(await scrapeCandidateProfile(candidates[0]));
      })();
      return true;
    }
    if (message?.type === 'GET_CANDIDATE_LIST') {
      // Full (unsliced) candidate list — used by the discovery batch loop
      // to walk every visible candidate, not just the first few for display.
      sendResponse({ candidates: MKT.scrape.listCandidates() });
      return true;
    }
    if (message?.type === 'SCROLL_LIST') {
      // Scrolls the candidate list itself to reveal more entries (the list
      // is virtualized/lazily-loaded — see WORKFLOW-MAP.md Phase 1).
      (async () => {
        const container = MKT.scrape.getListScrollContainer();
        const distance = 200 + Math.random() * 600;
        const scrolled = MKT.scrape.scrollList(distance);
        if (scrolled && container) {
          await waitForScrollSettled(container);
        }
        await delay(400 + Math.random() * 400); // let newly-loaded rows render
        sendResponse({ scrolled });
      })();
      return true;
    }
    if (message?.type === 'SCRAPE_CANDIDATE') {
      // Generalized version of TEST_FULL_CANDIDATE_SCRAPE for an explicit
      // {name, href} — what the discovery batch loop calls for each
      // candidate it walks, in list order.
      (async () => {
        sendResponse(await scrapeCandidateProfile({ name: message.name, href: message.href }));
      })();
      return true;
    }
    if (message?.type === 'REMOVE_CANDIDATE') {
      sendResponse(MKT.act.removeCandidate(message.href, message.testMode));
      return true;
    }
    if (message?.type === 'SEND_FRIEND_REQUEST') {
      sendResponse(MKT.act.sendFriendRequest(message.href, message.testMode));
      return true;
    }
    if (message?.type === 'CLICK_PROFILE_ADD_FRIEND') {
      // Assumes this content script instance is already on the target
      // person's own profile page — the caller (Send Queue) is responsible
      // for navigating there first.
      sendResponse(MKT.act.clickProfileAddFriend(message.testMode));
      return true;
    }
    if (message?.type === 'CHECK_FRIEND_STATUS') {
      // Same assumption as CLICK_PROFILE_ADD_FRIEND — caller has already
      // navigated here.
      sendResponse(MKT.scrape.checkFriendStatus());
      return true;
    }
    if (message?.type === 'CANCEL_FRIEND_REQUEST') {
      // Same assumption — caller has already navigated to the target
      // person's profile page.
      sendResponse(MKT.act.cancelFriendRequest(message.testMode));
      return true;
    }
    if (message?.type === 'SEND_DM') {
      // Same assumption as CLICK_PROFILE_ADD_FRIEND — caller has already
      // navigated to the target person's own profile page. Clicking Message
      // isn't gated by Test Mode (opening the popup isn't the policed
      // action); the actual send inside sendComposedMessage is.
      (async () => {
        const openResult = MKT.act.clickProfileMessage();
        if (!openResult.opened) {
          sendResponse({ sent: false, reason: openResult.reason });
          return;
        }
        try {
          await waitForElement(MKT.selectors.messageComposerInput, 'the message composer to open');
        } catch (err) {
          sendResponse({ sent: false, reason: err.message });
          return;
        }
        sendResponse(await MKT.act.sendComposedMessage(message.text, message.testMode));
      })();
      return true;
    }
    if (message?.type === 'DRAFT_FEED_POST') {
      // Step 3's 3A (post to personal page) — assisted, per Greg's explicit
      // design (2026-09-01): opens the create-post popup and types the
      // approved draft in, then stops. Greg reviews (attaches a photo,
      // picks a background, etc.) and clicks Facebook's own Post button
      // himself — this handler never does. Caller (sidepanel/content.js) is
      // responsible for making sure this tab is actually on a Facebook page
      // where the trigger exists (own profile or home feed) before sending
      // this message.
      (async () => {
        const openResult = MKT.act.clickPostComposerTrigger();
        if (!openResult.opened) {
          sendResponse({ typed: false, reason: openResult.reason });
          return;
        }
        try {
          await waitForElement(MKT.selectors.postComposerInput, 'the post composer to open');
        } catch (err) {
          sendResponse({ typed: false, reason: err.message });
          return;
        }
        sendResponse(await MKT.act.typePostDraft(message.text));
      })();
      return true;
    }
    if (message?.type === 'DRAFT_STORY_POST') {
      // Step 3's 3C (post to Story) — assisted, same design as 3A/3B: opens
      // the text-story editor and types the approved draft in, then stops.
      // Greg picks a background/font and clicks "Share to story" himself.
      // Caller (sidepanel/content.js) is responsible for making sure this
      // tab is already on facebook.com/stories/create, where the trigger
      // exists, before sending this message.
      (async () => {
        const openResult = MKT.act.clickCreateTextStoryTrigger();
        if (!openResult.opened) {
          sendResponse({ typed: false, reason: openResult.reason });
          return;
        }
        try {
          await waitForElement(MKT.selectors.storyTextInput, 'the story text editor to open');
        } catch (err) {
          sendResponse({ typed: false, reason: err.message });
          return;
        }
        sendResponse(await MKT.act.typeStoryText(message.text));
      })();
      return true;
    }
    return false;
  });
})();
