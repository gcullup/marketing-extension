// Read-only DOM access. Never clicks or types anything — see act.js for that.

(function () {
  const MKT = (self.MKT ||= {});
  MKT.scrape = {
    pageInfo() {
      return {
        url: location.href,
        title: document.title,
      };
    },
    // TODO Phase 1 (task 1.1): scroll-and-collect friend suggestions,
    // handling the feed's virtualized list so it doesn't stop after the
    // first screenful.
  };
})();
