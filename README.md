# BLV Page Navigator

A Manifest V3 Chrome extension designed to help blind and low-vision users orient themselves on web pages.

The extension automatically extracts a compact representation of the page's DOM/layout, sends it to a backend for an LLM-generated orientation summary, converts the summary to speech using Piper TTS, and provides keyboard and popup controls for playback.

The extension also provides immediate audio feedback when navigation occurs and when a new summary is ready.

## Project structure

* `extension/` — Chrome extension
* `backend/` — Node/Express API; provider keys and TTS models stay server-side

## 1. Start the backend

```bash
cd backend
npm install
cp .env.example .env
```

Fill `.env` with:

* `OPENROUTER_API_KEY`
* `OPENROUTER_MODEL`
* `TTS_PROVIDER=piper`
* `PIPER_MODEL=en_US-amy-medium`
* `PORT=8787`
* `ALLOWED_ORIGINS=chrome-extension://YOUR_EXTENSION_ID`

The current implementation uses Piper for local/free TTS rather than requiring a paid TTS API.

Start the backend:

```bash
npm start
```

Health check:

```text
http://localhost:8787/health
```

## 2. Load the extension

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Choose **Load unpacked**.
4. Select the `extension/` folder.
5. Copy the extension ID shown by Chrome.
6. Put `chrome-extension://THE_ID` into `ALLOWED_ORIGINS` in `backend/.env`.
7. Restart the backend after changing `.env`.

The manifest currently allows the local backend at:

```text
http://localhost:8787
```

## 3. Page analysis flow

The extension automatically analyzes pages when they are loaded or when an SPA navigation is detected.

The general flow is:

```text
Page load / navigation
        ↓
DOM extraction
        ↓
Navigation notification plays immediately
        ↓
LLM analysis
        ↓
TTS generation
        ↓
Summary audio loaded
        ↓
Summary-ready notification plays
        ↓
User presses Play
        ↓
Generated summary audio plays
```

Navigation notifications do not wait for the LLM analysis.

Similarly, the summary-ready notification does not automatically start the summary. It only informs the user that the summary is available.

## 4. Audio architecture

The offscreen document owns the persistent audio elements.

There are three separate audio roles:

### Navigation notification

`navigation.wav`

Played immediately when:

* a page initially loads
* an SPA navigation is detected

### Summary-ready notification

`shortcuts.wav`

Played when the LLM summary and its TTS audio are ready.

### Generated summary

The generated TTS audio returned by the backend.

The summary is loaded into the persistent audio element but remains paused until the user explicitly presses Play.

Notifications must not remove, reset, or overwrite the generated summary audio.

## 5. Keyboard controls

* `Ctrl+Shift+U` — play/pause summary
* `Ctrl+Shift+Left` — rewind 5 seconds
* `Ctrl+Shift+Up` — increase playback speed
* `Ctrl+Shift+Down` — decrease playback speed

Chrome allows an extension to have many commands, but only four commands can have suggested default shortcuts in the manifest. Additional shortcuts can be assigned manually through:

```text
chrome://extensions/shortcuts
```

Chrome may also require changing a shortcut if it is already reserved by the browser or another extension.

## 6. Popup

Opening the popup reads the cached summary for the active tab.

It does not trigger a new analysis.

The popup provides:

* current page summary
* playback controls
* playback state
* playback speed controls
* language selection when multiple languages are enabled

## 7. Language and TTS

The current implementation uses Piper TTS.

English currently uses:

```text
en_US-lessac-medium
en_US-amy-medium
```

Piper also provides a Bengali (Bangladesh) voice:

```text
bn_BD-google-medium
```

Bangla support can therefore be implemented without replacing the existing TTS system.

The intended multilingual flow is:

```text
Selected language
        ↓
LLM generates summary in that language
        ↓
Language-specific Piper voice
        ↓
Generated audio
```

For example:

```text
English
→ English summary
→ en_US-lessac-medium

Bangla
→ Bangla summary
→ bn_BD-google-medium
```

Language selection should be handled through the popup/settings rather than consuming another default Chrome keyboard shortcut.

## 8. Test extraction before using the LLM

Open a normal page and inspect the extension service worker console.

The content script waits approximately 700 ms after the document is ready, extracts visible semantic/layout elements, and sends up to 150 records to the service worker.

For initial validation, it is useful to temporarily log `structure` in `content.js` and test several messy real-world sites before relying on summary quality.

## 9. Caching

The extension stores summary metadata in `chrome.storage.local`.

The cache is bounded to 20 page entries because `chrome.storage.local` has finite storage capacity.

The generated audio is kept in the offscreen document for the currently active audio context rather than being treated as the primary page-summary cache.

## 10. Study logs

Open the extension's options page from the extension management page.

Logs are stored under:

```text
blvLogs
```

They include events such as:

* analysis start
* analysis completion
* analysis errors
* navigation notifications
* playback actions

The options page can export the logs as CSV or clear them.

## Important implementation notes

* Provider API keys remain server-side.
* Backend CORS is allowlisted rather than `*`.
* The offscreen document owns persistent audio playback.
* The service worker handles keyboard commands and backend communication.
* Navigation notifications are fire-and-forget messages.
* Summary-ready notifications are fire-and-forget messages.
* Playback commands use request/response messaging.
* Stale LLM results are ignored using per-tab analysis IDs.
* The extractor currently caps a page at 150 elements.
* Chunking can be added later for very large pages.
* Automatic analysis occurs on page load and SPA navigation.
* Repeated SPA navigation can increase LLM/TTS cost and latency.

## Current limitations / future work

1. Add Bangla language selection and verify the quality of the `bn_BD-google-medium` Piper voice with BLV participants.
2. Decide whether language selection should affect only future analyses or also allow regeneration of an existing summary.
3. Add lightweight backend authentication, such as a shared header token, to protect the LLM/TTS budget.
4. Add debounce/throttle or manual refresh options for repeated SPA route changes.
5. Evaluate summary quality and navigation/orientation usefulness through usability testing with BLV participants.
6. Investigate additional Piper voices/languages if multilingual support expands.
7. Improve handling of very large pages through DOM chunking or hierarchical summarization.
8. Consider more sophisticated audio queuing if future versions require multiple simultaneous notification types.
