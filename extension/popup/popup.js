const PAGE_PREFIX = 'blvPage:';
const LANGUAGE_KEY = 'blvSummaryLanguage';
const statusEl = document.getElementById('status');
const summaryEl = document.getElementById('summary');
const languageSelect = document.getElementById('summary-language');
const languageStatusEl = document.getElementById('summary-language-status');

async function getCurrentTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0];
}

async function loadSummaryLanguage() {
  const result = await chrome.storage.local.get(LANGUAGE_KEY);
  const language = result[LANGUAGE_KEY] === 'bn' ? 'bn' : 'en';
  console.log('[BLV Popup] Loaded summary language:', language);
  languageSelect.value = language;
  return language;
}

async function selectSummaryLanguage() {
  const language = languageSelect.value === 'bn' ? 'bn' : 'en';
  const tab = await getCurrentTab();

  console.log('[BLV Popup] Selected summary language:', language);

  await chrome.storage.local.set({ [LANGUAGE_KEY]: language });
  await chrome.runtime.sendMessage({
    type: 'summary-language-selected',
    language,
    tabId: tab?.id,
  });

  statusEl.textContent = 'Generating summary...';
  summaryEl.textContent = '';
  languageStatusEl.textContent = `${language === 'bn' ? 'Bangla' : 'English'} selected for the next summary.`;
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

languageSelect.addEventListener('change', () => {
  selectSummaryLanguage().catch(error => {
    languageStatusEl.textContent = `Unable to select language: ${error.message}`;
  });
});

Promise.all([loadSummaryLanguage(), loadSummary()]).catch(error => {
  statusEl.textContent = `Error: ${error.message}`;
});
