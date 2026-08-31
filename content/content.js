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
    return false;
  });
})();
