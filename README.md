# BLV Page Navigator

A Manifest V3 Chrome extension that automatically builds a compact DOM/layout representation, sends it to a backend for an LLM orientation summary and TTS, and lets the user play/pause the cached speech with a keyboard shortcut even when the popup is closed.

## Project structure

- `extension/` — Chrome extension
- `backend/` — Node/Express API; provider keys stay server-side

## 1. Start the backend

```bash
cd backend
npm install
cp .env.example .env
```

Fill `.env`:

- `OPENROUTER_API_KEY`
- `OPENROUTER_MODEL`
- `TTS_API_KEY` — OpenAI API key for TTS
- `TTS_PROVIDER=openai`
- `PORT=8787`
- `ALLOWED_ORIGINS=chrome-extension://YOUR_EXTENSION_ID`

Start it:

```bash
npm start
```

Health check:

```text
http://localhost:8787/health
```

## 2. Load the extension

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Choose **Load unpacked**.
4. Select the `extension/` folder.
5. Copy the extension ID shown by Chrome.
6. Put `chrome-extension://THE_ID` into `ALLOWED_ORIGINS` in `backend/.env`.
7. Restart the backend after changing `.env`.

The manifest currently allows the local backend at `http://localhost:8787`.

## 3. Test extraction before using the LLM

Open a normal page and inspect the extension service worker console. The content script waits 700 ms after the document is ready, extracts visible semantic/layout elements, and sends up to 150 records to the service worker.

For the first validation iteration, it is useful to temporarily log `structure` in `content.js` and test 5–10 messy real sites before relying on summary quality.

## 4. Keyboard controls

- `Ctrl+Shift+U` — play/pause
- `Ctrl+Shift+Left` — rewind 10 seconds
- `Ctrl+Shift+Right` — forward 10 seconds
- `Ctrl+Shift+Up` — speed up
- `Ctrl+Shift+Down` — slow down

Chrome may require changing a shortcut if one is already reserved. Visit `chrome://extensions/shortcuts`.

## 5. Popup

Opening the popup only reads the cached summary for the active tab. It does not trigger analysis. The popup also exposes the same playback controls.

## 6. Study logs

Open the extension's options page from the extension management page. Logs are stored under `blvLogs` and include analysis start/completion/error and playback events. The options page exports CSV or clears the logs.

## Important implementation notes

- Provider API keys are only in the backend environment.
- Backend CORS is allowlisted rather than `*`.
- The offscreen document owns the persistent `<audio>` element.
- The service worker owns keyboard commands and backend calls.
- The current audio cache is bounded to 20 page entries because `chrome.storage.local` has finite storage.
- The current extractor caps a page at 150 elements; chunking can be added later for large pages.
- Automatic analysis intentionally happens on every load/navigation, including repeated SPA navigations. This is convenient but can increase LLM/TTS cost and latency. A manual-refresh mode or debounce/throttle for SPA route changes is a future improvement.

## Open questions to decide for the study

1. Add lightweight backend authentication, such as a shared header token, to protect the LLM/TTS budget?
2. Add debounce/throttle or manual refresh for repeated SPA route changes?
3. Keep OpenAI TTS for simplicity/cost, or evaluate ElevenLabs if voice quality becomes more important?
