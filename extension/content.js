(() => {
  const DELAY_MS = 700;
  const URL_CHECK_INTERVAL_MS = 500;

  let lastAnalyzedUrl = location.href;
  let analysisTimer = null;

  console.log("========================================");
  console.log("[BLV Content] Content script loaded");
  console.log("[BLV Content] Current URL:", location.href);
  console.log("[BLV Content] Document title:", document.title);
  console.log("========================================");

  function sendExtraction(reason = "initial-load") {
    if (!window.blvDomExtractor) {
      console.error(
        "[BLV Content] ERROR: blvDomExtractor is not available"
      );
      return;
    }

    console.log(
      "[BLV Content] Starting extraction..."
    );

    console.log(
      "[BLV Content] URL being analyzed:",
      location.href
    );

    const startedAt = performance.now();

    try {
      const structure =
        window.blvDomExtractor.extractPageStructure();

      const extractionLatencyMs = Math.round(
        performance.now() - startedAt
      );

      console.log(
        "[BLV Content] Extraction completed"
      );

      console.log(
        "[BLV Content] Extraction reason:",
        reason
      );

      console.log(
        "[BLV Content] Extracted URL:",
        structure.url
      );

      console.log(
        "[BLV Content] Element count:",
        structure.elementCount
      );

      console.log(
        "[BLV Content] Sending structure to background..."
      );

      // Fire-and-forget notification.
      // We do not expect a response from the background script.
      chrome.runtime.sendMessage({
        type: "page-structure-ready",
        structure,
        extractionLatencyMs,
        reason,
      }).catch((error) => {
        console.warn(
          "[BLV Content] Failed to notify background:",
          error.message
        );
      });

    } catch (error) {
      console.error(
        "[BLV Content] Extraction failed:",
        error
      );
    }
  }

  function scheduleAnalysis(reason = "spa-navigation") {
    const urlAtDetection = location.href;

    console.log(
      "[BLV Content] Scheduling analysis..."
    );

    console.log(
      "[BLV Content] URL:",
      urlAtDetection
    );

    /*
     * IMPORTANT:
     *
     * Mark this URL immediately.
     *
     * Otherwise the 500 ms URL checker will see the same
     * new URL repeatedly while the 700 ms timer is waiting.
     */
    lastAnalyzedUrl = urlAtDetection;

    clearTimeout(analysisTimer);

    analysisTimer = window.setTimeout(() => {

      /*
       * The website may have navigated again while we were
       * waiting for the DOM to settle.
       *
       * If that happened, analyze the newest URL instead.
       */
      if (location.href !== urlAtDetection) {
        console.log(
          "[BLV Content] URL changed again before analysis."
        );

        console.log(
          "[BLV Content] Detected URL:",
          urlAtDetection
        );

        console.log(
          "[BLV Content] Current URL:",
          location.href
        );

        checkForUrlChange();
        return;
      }

      console.log(
        "[BLV Content] Analysis timer fired"
      );

      console.log(
        "[BLV Content] Analyzing URL:",
        location.href
      );

      sendExtraction(reason);

    }, DELAY_MS);
  }

  function checkForUrlChange() {
    const currentUrl = location.href;

    console.log(
      "[BLV Content] URL CHECK:",
      currentUrl
    );

    if (currentUrl === lastAnalyzedUrl) {
      return;
    }

    console.log(
      "[BLV Content] >>> URL CHANGED <<<"
    );

    console.log(
      "[BLV Content] Previous:",
      lastAnalyzedUrl
    );

    console.log(
      "[BLV Content] Current:",
      currentUrl
    );

    scheduleAnalysis("spa-navigation");
  }

  // Browser Back / Forward
  window.addEventListener("popstate", () => {
    console.log(
      "[BLV Content] popstate event detected"
    );

    checkForUrlChange();
  });

  // Hash navigation
  window.addEventListener("hashchange", () => {
    console.log(
      "[BLV Content] hashchange event detected"
    );

    checkForUrlChange();
  });

  /*
   * Polling is used because many SPAs change the URL using
   * history.pushState() or history.replaceState().
   */
  console.log(
    "[BLV Content] Starting URL monitoring..."
  );

  window.setInterval(
    checkForUrlChange,
    URL_CHECK_INTERVAL_MS
  );

  // Initial page analysis
  function initialAnalysis() {
    console.log(
      "[BLV Content] Preparing initial analysis..."
    );

    console.log(
      "[BLV Content] Initial URL:",
      location.href
    );

    window.setTimeout(() => {

      lastAnalyzedUrl = location.href;

      console.log(
        "[BLV Content] Running initial extraction for:",
        location.href
      );

      sendExtraction("initial-load");

    }, DELAY_MS);
  }

  if (document.readyState === "loading") {

    console.log(
      "[BLV Content] Waiting for DOMContentLoaded..."
    );

    document.addEventListener(
      "DOMContentLoaded",
      initialAnalysis,
      { once: true }
    );

  } else {

    initialAnalysis();

  }
})();