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
      // Click the first candidate, wait for navigation, scroll the detail
      // pane a randomized number of times (mirroring the old tool's 5/15/25
      // pattern), then grab all visible text — the full Step 1 read path
      // for one candidate, end to end. Still no Add Friend click.
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

        let navElapsedMs;
        try {
          navElapsedMs = await waitForProfileUrl();
        } catch (err) {
          sendResponse({ ok: false, reason: err.message, finalUrl: location.href });
          return;
        }

        await delay(800); // let initial profile content render before scrolling

        const scrollCounts = [5, 15, 25];
        const chosenScrollCount = scrollCounts[Math.floor(Math.random() * scrollCounts.length)];
        for (let i = 0; i < chosenScrollCount; i++) {
          MKT.scrape.scrollDetailPane(900);
          await delay(300 + Math.random() * 300);
        }

        const text = MKT.scrape.extractVisibleText();
        sendResponse({
          ok: true,
          targetName: target.name,
          finalUrl: location.href,
          navElapsedMs,
          scrollCount: chosenScrollCount,
          textLength: text.length,
          textPreview: text.slice(0, 500),
        });
      })();
      return true;
    }
    return false;
  });
})();
