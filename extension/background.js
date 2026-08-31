const BACKEND_URL = "http://localhost:8787";
const PAGE_PREFIX = "blvPage:";
const MAX_CACHED_PAGES = 20;

async function logEvent(event, data = {}) {
    const result = await chrome.storage.local.get("blvLogs");
    const logs = Array.isArray(result.blvLogs) ? result.blvLogs : [];
    logs.push({ event, data, ts: new Date().toISOString() });
    await chrome.storage.local.set({ blvLogs: logs.slice(-5000) });
}

function pageKey(url) {
    return `${PAGE_PREFIX}${url}`;
}

let offscreenCreationPromise = null;

async function ensureOffscreenDocument() {
    console.log("[BLV Background] Checking offscreen document");

    // Always check the actual Chrome offscreen document.
    if (await chrome.offscreen.hasDocument()) {
        console.log("[BLV Background] Offscreen document exists");
        return;
    }

    // If another operation is already creating it, wait for that operation.
    if (offscreenCreationPromise) {
        console.log("[BLV Background] Waiting for existing offscreen creation");
        await offscreenCreationPromise;
        return;
    }

    console.log("[BLV Background] Creating offscreen document");

    offscreenCreationPromise = chrome.offscreen.createDocument({
        url: "offscreen.html",
        reasons: ["AUDIO_PLAYBACK"],
        justification:
            "Persistent audio playback must continue when the popup is closed.",
    });

    try {
        await offscreenCreationPromise;
        console.log("[BLV Background] Offscreen document created");
    } finally {
        offscreenCreationPromise = null;
    }
}

async function sendToOffscreen(message) {
    await ensureOffscreenDocument();

    console.log("[BLV Background] Sending to offscreen:", message.type);

    const response = await chrome.runtime.sendMessage(message);

    console.log("[BLV Background] Offscreen response:", response);

    return response;
}

async function prunePageCache() {
    const all = await chrome.storage.local.get(null);
    const pageEntries = Object.entries(all)
        .filter(
            ([key, value]) =>
                key.startsWith(PAGE_PREFIX) && value && value.updatedAt,
        )
        .sort((a, b) => b[1].updatedAt.localeCompare(a[1].updatedAt));
    const remove = pageEntries.slice(MAX_CACHED_PAGES);
    if (remove.length)
        await chrome.storage.local.remove(remove.map(([key]) => key));
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // if (message.type === "offscreen-ready") {
    //     console.log("[BLV Background] Offscreen document is ready");
    //     offscreenReady = true;
    //     return;
    // }

    if (message.type === "page-structure-ready") {
        (async () => {
            const tabId = sender.tab?.id;
            const url = message.structure?.url;
            if (!tabId || !url) return;

            const startedAt = Date.now();
            try {
                await logEvent("analysis-start", {
                    url,
                    tabId,
                    elementCount: message.structure.elementCount,
                });

                const response = await fetch(`${BACKEND_URL}/summarize`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ structure: message.structure }),
                });
                if (!response.ok)
                    throw new Error(`Backend returned ${response.status}`);

                const result = await response.json();

                console.log("[BLV Background] Backend response received");
                console.log(
                    "[BLV Background] Summary length:",
                    result.summary?.length,
                );
                console.log(
                    "[BLV Background] Audio length:",
                    result.audio?.length,
                );

                if (!result.summary || !result.audio) {
                    throw new Error(
                        "Backend response is missing summary or audio",
                    );
                }

                const entry = {
                    url,
                    title: message.structure.title || "",
                    summary: result.summary,
                    audio: result.audio,
                    elementCount: message.structure.elementCount,
                    updatedAt: new Date().toISOString(),
                };
                await chrome.storage.local.set({ [pageKey(url)]: entry });
                await prunePageCache();

                await sendToOffscreen({
                    type: "load-audio",
                    audio: result.audio,
                });

                await sendToOffscreen({
                    type: "play-notification",
                });

                await logEvent("analysis-complete", {
                    url,
                    tabId,
                    elementCount: message.structure.elementCount,
                    latencyMs: Date.now() - startedAt,
                });
                sendResponse({ ok: true });
            } catch (error) {
                await logEvent("analysis-error", {
                    url,
                    tabId,
                    error: error.message,
                });
                sendResponse({ ok: false, error: error.message });
            }
        })();
        return true;
    }

    if (message.type === "popup-control") {
        (async () => {
            await sendToOffscreen(message.action);
            await logEvent("playback-action", { action: message.action.type });
            sendResponse({ ok: true });
        })().catch((error) =>
            sendResponse({ ok: false, error: error.message }),
        );
        return true;
    }

    if (message.type === "get-audio-state") {
        sendToOffscreen({ type: "get-audio-state" })
            .then(() => sendResponse({ ok: true }))
            .catch((error) =>
                sendResponse({ ok: false, error: error.message }),
            );
        return true;
    }

    if (message.type === "audio-state") {
        chrome.runtime.sendMessage(message).catch(() => {});
    }
});

chrome.commands.onCommand.addListener(async (command) => {
    const actions = {
        "toggle-play-pause": { type: "toggle-play-pause" },
        rewind: { type: "rewind", seconds: 10 },
        "fast-forward": { type: "fast-forward", seconds: 10 },
        "speed-up": { type: "set-speed", delta: 1 },
        "slow-down": { type: "set-speed", delta: -1 },
    };
    const action = actions[command];
    if (!action) return;
    try {
        await sendToOffscreen(action);
        await logEvent("playback-action", {
            action: action.type,
            source: "keyboard",
        });
    } catch (error) {
        await logEvent("playback-error", {
            action: action.type,
            error: error.message,
        });
    }
});

chrome.runtime.onConnect.addListener((port) => {
    if (port.name === "popup") {
        port.onMessage.addListener((message) => {
            if (message.type === "popup-get-audio-state") {
                sendToOffscreen({ type: "get-audio-state" }).catch(() => {});
            }
        });
    }
});
