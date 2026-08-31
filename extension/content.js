(() => {
  const DELAY_MS = 700;

  function sendExtraction() {
    if (!window.blvDomExtractor) return;
    const startedAt = performance.now();
    const structure = window.blvDomExtractor.extractPageStructure();
    const extractionLatencyMs = Math.round(performance.now() - startedAt);
    chrome.runtime.sendMessage({
      type: 'page-structure-ready',
      structure,
      extractionLatencyMs
    });
  }

  // Deliberately re-runs on every page load/navigation for immediate user convenience.
  // This accepted tradeoff can add LLM/TTS cost and latency, especially on SPAs.
  // A manual-refresh option or debounce/throttle for repeated SPA route changes is a reasonable future improvement.
  function scheduleAnalysis() {
    window.setTimeout(sendExtraction, DELAY_MS);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scheduleAnalysis, { once: true });
  } else {
    scheduleAnalysis();
  }
})();
