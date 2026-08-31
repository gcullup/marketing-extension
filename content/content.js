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
      const candidates = MKT.scrape.listCandidates();
      if (!candidates.length) {
        sendResponse({ ok: false, reason: 'no candidates found' });
        return true;
      }
      const target = candidates[0];
      const clickResult = MKT.act.clickCandidate(target.href);
      if (!clickResult.clicked) {
        sendResponse({ ok: false, reason: clickResult.reason });
        return true;
      }
      const startedAt = Date.now();
      const poll = setInterval(() => {
        const elapsed = Date.now() - startedAt;
        if (MKT.scrape.isProfileUrl(location.href)) {
          clearInterval(poll);
          sendResponse({
            ok: true,
            targetName: target.name,
            finalUrl: location.href,
            elapsedMs: elapsed,
          });
        } else if (elapsed > 6000) {
          clearInterval(poll);
          sendResponse({
            ok: false,
            reason: 'timed out waiting for URL to change to a profile',
            finalUrl: location.href,
            elapsedMs: elapsed,
          });
        }
      }, 250);
      return true; // keep the message channel open for the async sendResponse
    }
    return false;
  });
})();
