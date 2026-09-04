const BACKEND_URL = "http://localhost:8787";
const PAGE_PREFIX = "blvPage:";
const MAX_CACHED_PAGES = 20;

// Tracks the newest analysis for each tab.
// If an older navigation finishes after a newer one,
// its result will be ignored.
const latestAnalysisByTab = new Map();

// The tab that currently owns the audio being played/loaded
// in the offscreen document.
let activeAudioTabId = null;

async function logEvent(event, data = {}) {
    const result = await chrome.storage.local.get("blvLogs");
    const logs = Array.isArray(result.blvLogs) ? result.blvLogs : [];

    logs.push({
        event,
        data,
        ts: new Date().toISOString(),
    });

    await chrome.storage.local.set({
        blvLogs: logs.slice(-5000),
    });
}

function pageKey(url) {
    return `${PAGE_PREFIX}${url}`;
}

let offscreenCreationPromise = null;

async function ensureOffscreenDocument() {
    console.log("[BLV Background] Checking offscreen document");

    if (await chrome.offscreen.hasDocument()) {
        console.log("[BLV Background] Offscreen document exists");
        return;
    }

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

// =============================================================
// OFFSCREEN REQUEST/RESPONSE
// =============================================================
//
// Use this for messages where the background script needs
// a response from the offscreen document.
//
// Examples:
// - load-audio
// - toggle-play-pause
// - rewind
// - set-speed
// - get-audio-state
// - stop-all-audio
// =============================================================

async function sendToOffscreen(message) {
    await ensureOffscreenDocument();

    console.log("[BLV Background] Sending to offscreen:", message.type);

    const response = await chrome.runtime.sendMessage(message);

    console.log("[BLV Background] Offscreen response:", response);

    return response;
}

// =============================================================
// OFFSCREEN FIRE-AND-FORGET
// =============================================================
//
// Use this for messages where we do NOT need a response.
//
// Examples:
// - play-notification
// - play-navigation-notification
//
// This prevents Chrome from expecting an asynchronous
// sendResponse() from the offscreen document.
// =============================================================

async function sendToOffscreenFireAndForget(message) {
    await ensureOffscreenDocument();

    console.log(
        "[BLV Background] Sending fire-and-forget to offscreen:",
        message.type,
    );

    chrome.runtime.sendMessage(message).catch((error) => {
        console.warn(
            "[BLV Background] Fire-and-forget message failed:",
            error.message,
        );
    });
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

    if (remove.length) {
        await chrome.storage.local.remove(remove.map(([key]) => key));
    }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // =========================================================
    // PAGE STRUCTURE READY
    // =========================================================

    if (message.type === "page-structure-ready") {
        console.log("========================================");
        console.log("[BLV Background] PAGE STRUCTURE RECEIVED");
        console.log("[BLV Background] URL:", message.structure?.url);
        console.log("[BLV Background] Title:", message.structure?.title);
        console.log(
            "[BLV Background] Element count:",
            message.structure?.elementCount,
        );
        console.log("[BLV Background] Reason:", message.reason);
        console.log("[BLV Background] Tab ID:", sender.tab?.id);
        console.log("[BLV Background] Time:", new Date().toISOString());
        console.log("========================================");

        // =====================================================
        // NAVIGATION ANNOUNCEMENT
        // =====================================================

        // Only play this for SPA navigation.
        //
        // IMPORTANT:
        // This is fire-and-forget.
        //
        // The backend analysis should begin immediately while
        // the short navigation announcement is playing.

        if (
            message.reason === "initial-load" ||
            message.reason === "spa-navigation"
        ) {
            console.log(
                "[BLV Background] Playing navigation notification:",
                message.reason,
            );

            sendToOffscreenFireAndForget({
                type: "play-navigation-notification",
            });

            logEvent("navigation-notification", {
                tabId: sender.tab?.id,
                url: message.structure?.url,
                reason: message.reason,
            }).catch(() => {});
        }

        // =====================================================
        // START ANALYSIS
        // =====================================================

        (async () => {
            const tabId = sender.tab?.id;
            const url = message.structure?.url;

            if (tabId == null || !url) {
                console.warn("[BLV Background] Missing tab ID or URL");
                return;
            }

            // Create a unique ID for this analysis.
            const analysisId = crypto.randomUUID();

            // This becomes the newest analysis for this tab.
            latestAnalysisByTab.set(tabId, analysisId);

            console.log("[BLV Background] New analysis registered");
            console.log("[BLV Background] Analysis ID:", analysisId);
            console.log("[BLV Background] Tab ID:", tabId);
            console.log("[BLV Background] URL:", url);

            const startedAt = Date.now();

            // -------------------------------------------------
            // Helper to determine whether this analysis is
            // still the newest navigation for this tab.
            // -------------------------------------------------

            function isLatestAnalysis() {
                return latestAnalysisByTab.get(tabId) === analysisId;
            }

            try {
                await logEvent("analysis-start", {
                    url,
                    tabId,
                    analysisId,
                    elementCount: message.structure.elementCount,
                });

                console.log("\n========== ANALYSIS START ==========");

                console.log("[BLV Background] URL:", url);

                console.log("[BLV Background] Analysis ID:", analysisId);

                console.log(
                    "[BLV Background] Element count:",
                    message.structure.elementCount,
                );

                // =================================================
                // 1. CALL BACKEND
                // =================================================

                console.log("[BLV Background] Sending to backend:", url);

                const response = await fetch(`${BACKEND_URL}/summarize`, {
                    method: "POST",

                    headers: {
                        "Content-Type": "application/json",
                    },

                    body: JSON.stringify({
                        structure: message.structure,
                    }),
                });

                if (!response.ok) {
                    throw new Error(`Backend returned ${response.status}`);
                }

                const result = await response.json();

                console.log(
                    "[BLV Background] Backend response received for:",
                    url,
                );

                // =================================================
                // IMPORTANT:
                // Check whether another navigation happened
                // while the backend was processing.
                // =================================================

                if (!isLatestAnalysis()) {
                    console.log("[BLV Background] IGNORING STALE RESULT");

                    console.log("[BLV Background] Stale URL:", url);

                    console.log("[BLV Background] Analysis ID:", analysisId);

                    await logEvent("analysis-stale", {
                        url,
                        tabId,
                        analysisId,
                    });

                    return;
                }

                // =================================================
                // 2. LOG LLM SUMMARY
                // =================================================

                console.log("\n========== LLM SUMMARY ==========");

                console.log(result.summary);

                console.log("==================================");

                console.log(
                    "[BLV Background] Summary length:",
                    result.summary?.length,
                );

                // =================================================
                // 3. LOG AUDIO
                // =================================================

                console.log("\n========== AUDIO DATA ==========");

                console.log(
                    "[BLV Background] Audio exists:",
                    Boolean(result.audio),
                );

                console.log(
                    "[BLV Background] Audio length:",
                    result.audio?.length,
                );

                console.log(
                    "[BLV Background] Audio prefix:",
                    result.audio?.substring(0, 40),
                );

                console.log("================================");

                if (!result.summary || !result.audio) {
                    throw new Error(
                        "Backend response is missing summary or audio",
                    );
                }

                // =================================================
                // 4. SAVE RESULT
                // =================================================

                if (!isLatestAnalysis()) {
                    console.log(
                        "[BLV Background] Analysis became stale before saving",
                    );

                    return;
                }

                // IMPORTANT:
                // Do NOT save result.audio to chrome.storage.local.
                // The audio is several MB and will eventually exceed
                // the storage quota.
                //
                // Only save metadata and summary.

                const entry = {
                    url,

                    title: message.structure.title || "",

                    summary: result.summary,

                    elementCount: message.structure.elementCount,

                    updatedAt: new Date().toISOString(),
                };

                await chrome.storage.local.set({
                    [pageKey(url)]: entry,
                });

                await prunePageCache();

                console.log(
                    "[BLV Background] Summary metadata saved to storage",
                );

                // =================================================
                // 5. LOAD AUDIO INTO OFFSCREEN
                // =================================================

                if (!isLatestAnalysis()) {
                    console.log(
                        "[BLV Background] Analysis became stale before loading audio",
                    );

                    return;
                }

                console.log("[BLV Background] Loading summary audio for:", url);

                const loadResult = await sendToOffscreen({
                    type: "load-audio",
                    audio: result.audio,
                });

                console.log("[BLV Background] load-audio result:", loadResult);

                // =================================================
                // IMPORTANT:
                //
                // Only NOW does this tab become the owner of
                // the currently loaded audio.
                // =================================================

                if (!isLatestAnalysis()) {
                    console.log(
                        "[BLV Background] Analysis became stale after loading audio",
                    );

                    return;
                }

                activeAudioTabId = tabId;

                console.log(
                    "[BLV Background] Active audio tab:",
                    activeAudioTabId,
                );

                // =================================================
                // 6. PLAY SUMMARY-READY NOTIFICATION
                // =================================================

                if (!isLatestAnalysis()) {
                    console.log(
                        "[BLV Background] Analysis became stale before notification",
                    );

                    return;
                }

                console.log(
                    "[BLV Background] Playing summary-ready notification for:",
                    url,
                );

                // IMPORTANT:
                // Notification is fire-and-forget.
                // We do NOT wait for a response from offscreen.

                sendToOffscreenFireAndForget({
                    type: "play-notification",
                });

                // =================================================
                // ANALYSIS COMPLETE
                // =================================================

                console.log("\n========== ANALYSIS COMPLETE ==========");

                console.log("[BLV Background] URL:", url);

                console.log("[BLV Background] Analysis ID:", analysisId);

                console.log(
                    "[BLV Background] Active audio tab:",
                    activeAudioTabId,
                );

                console.log(
                    "[BLV Background] Total latency:",
                    Date.now() - startedAt,
                    "ms",
                );

                console.log("========================================\n");

                await logEvent("analysis-complete", {
                    url,
                    tabId,
                    analysisId,
                    elementCount: message.structure.elementCount,
                    latencyMs: Date.now() - startedAt,
                });

                // Only remove the analysis if this is still
                // the newest analysis for this tab.
                if (isLatestAnalysis()) {
                    latestAnalysisByTab.delete(tabId);
                }
            } catch (error) {
                console.error("[BLV Background] Analysis error:", error);

                await logEvent("analysis-error", {
                    url,
                    tabId,
                    analysisId,
                    error: error.message,
                });

                if (isLatestAnalysis()) {
                    latestAnalysisByTab.delete(tabId);
                }
            }
        })();

        // IMPORTANT:
        //
        // page-structure-ready is a fire-and-forget message.
        // The content script does NOT need to wait for the
        // LLM/TTS analysis to finish.
        //
        // Therefore:
        // - no sendResponse()
        // - no return true

        return;
    }

    // =========================================================
    // POPUP CONTROLS
    // =========================================================

    if (message.type === "popup-control") {
        (async () => {
            try {
                console.log("[BLV Background] Popup control:", message.action);

                const result = await sendToOffscreen(message.action);

                await logEvent("playback-action", {
                    action: message.action.type,
                });

                sendResponse({
                    ok: true,
                    result,
                });
            } catch (error) {
                console.error("[BLV Background] Playback error:", error);

                sendResponse({
                    ok: false,
                    error: error.message,
                });
            }
        })();

        return true;
    }

    // =========================================================
    // AUDIO STATE
    // =========================================================

    if (message.type === "get-audio-state") {
        sendToOffscreen({
            type: "get-audio-state",
        })
            .then(() =>
                sendResponse({
                    ok: true,
                }),
            )
            .catch((error) =>
                sendResponse({
                    ok: false,
                    error: error.message,
                }),
            );

        return true;
    }

    if (message.type === "audio-state") {
        console.log("[BLV Background] Audio state:", message.state);

        chrome.runtime.sendMessage(message).catch(() => {});
    }
});

// =============================================================
// TAB CLOSED
// =============================================================
//
// If the tab that owns the current audio is closed,
// stop all audio.
//
// We do NOT announce that the tab was closed.
//
// chrome.tabs.onRemoved is the appropriate tab lifecycle event.
// =============================================================

chrome.tabs.onRemoved.addListener(async (tabId) => {
    console.log("[BLV Background] Tab removed:", tabId);

    // The tab can no longer have a useful analysis.
    latestAnalysisByTab.delete(tabId);

    // Only stop audio if this was the tab that owned
    // the current offscreen audio.
    if (activeAudioTabId !== tabId) {
        return;
    }

    console.log("[BLV Background] Closed tab owned active audio.");

    activeAudioTabId = null;

    try {
        await sendToOffscreen({
            type: "stop-all-audio",
        });

        console.log("[BLV Background] Audio stopped after tab close.");

        await logEvent("audio-stopped-tab-closed", {
            tabId,
        });
    } catch (error) {
        console.warn(
            "[BLV Background] Failed to stop audio after tab close:",
            error.message,
        );
    }
});

// =============================================================
// KEYBOARD SHORTCUTS
// =============================================================

chrome.commands.onCommand.addListener(async (command) => {
    const actions = {
        "toggle-play-pause": {
            type: "toggle-play-pause",
        },

        rewind: {
            type: "rewind",
            seconds: 10,
        },

        "speed-up": {
            type: "set-speed",
            delta: 1,
        },

        "slow-down": {
            type: "set-speed",
            delta: -1,
        },
    };

    const action = actions[command];

    if (!action) {
        return;
    }

    console.log("[BLV Background] Keyboard shortcut:", command);

    try {
        await sendToOffscreen(action);

        await logEvent("playback-action", {
            action: action.type,
            source: "keyboard",
            activeAudioTabId,
        });
    } catch (error) {
        await logEvent("playback-error", {
            action: action.type,
            error: error.message,
        });

        console.error("[BLV Background] Keyboard playback error:", error);
    }
});

// =============================================================
// POPUP CONNECTION
// =============================================================

chrome.runtime.onConnect.addListener((port) => {
    if (port.name === "popup") {
        port.onMessage.addListener((message) => {
            if (message.type === "popup-get-audio-state") {
                sendToOffscreen({
                    type: "get-audio-state",
                }).catch(() => {});
            }
        });
    }
});
