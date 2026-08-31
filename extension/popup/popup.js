const PAGE_PREFIX = 'blvPage:';
const statusEl = document.getElementById('status');
const summaryEl = document.getElementById('summary');

async function getCurrentTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0];
}

async function loadSummary() {
  const tab = await getCurrentTab();
  if (!tab?.url) {
    statusEl.textContent = 'No page available.';
    return;
  }
  const result = await chrome.storage.local.get(`${PAGE_PREFIX}${tab.url}`);
  const entry = result[`${PAGE_PREFIX}${tab.url}`];
  if (!entry) {
    statusEl.textContent = 'Analysis is not ready yet.';
    summaryEl.textContent = '';
    return;
  }
  statusEl.textContent = `Analyzed ${new Date(entry.updatedAt).toLocaleString()}`;
  summaryEl.textContent = entry.summary;
}

async function sendControl(type, extra = {}) {
  await chrome.runtime.sendMessage({
    type: 'popup-control',
    action: { type, ...extra }
  });
}

document.querySelectorAll('[data-action]').forEach(button => {
  button.addEventListener('click', () => sendControl(button.dataset.action, button.dataset.action === 'rewind' || button.dataset.action === 'fast-forward' ? { seconds: 10 } : button.dataset.action === 'speed-up' ? { delta: 1 } : button.dataset.action === 'slow-down' ? { delta: -1 } : {}));
});

loadSummary().catch(error => {
  statusEl.textContent = `Error: ${error.message}`;
});
