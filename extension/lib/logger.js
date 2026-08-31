(() => {
  async function logEvent(event, data = {}) {
    const result = await chrome.storage.local.get('blvLogs');
    const logs = Array.isArray(result.blvLogs) ? result.blvLogs : [];
    logs.push({ event, data, ts: new Date().toISOString() });
    // Keep the study log bounded so repeated page loads do not consume unlimited storage.
    const bounded = logs.slice(-5000);
    await chrome.storage.local.set({ blvLogs: bounded });
  }

  window.blvLogger = { logEvent };
})();
