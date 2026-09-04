const audio = document.getElementById("summaryAudio");
const notificationAudio = document.getElementById("notificationAudio");
const navigationAudio = document.createElement("audio");

audio.preload = "auto";
notificationAudio.preload = "auto";
notificationAudio.src = chrome.runtime.getURL("audio/shortcuts.wav");
notificationAudio.load();

navigationAudio.preload = "auto";
navigationAudio.src = chrome.runtime.getURL("audio/navigation.wav");
navigationAudio.load();

const SPEEDS = [0.75, 1, 1.25, 1.5, 1.75, 2];

let audioLoadId = 0;

console.log("[BLV Offscreen] Loaded");

function logAudioDiagnostics(label) {
    console.log(`[BLV Offscreen] ${label}`, {
        summary: {
            hasSrc: Boolean(audio.src),
            src: audio.src,
            readyState: audio.readyState,
            networkState: audio.networkState,
            currentTime: audio.currentTime,
            duration: audio.duration,
            paused: audio.paused,
            error: audio.error,
        },
        notification: {
            paused: notificationAudio.paused,
            ended: notificationAudio.ended,
            readyState: notificationAudio.readyState,
            networkState: notificationAudio.networkState,
            error: notificationAudio.error,
        },
        navigation: {
            paused: navigationAudio.paused,
            ended: navigationAudio.ended,
            readyState: navigationAudio.readyState,
            networkState: navigationAudio.networkState,
            error: navigationAudio.error,
        },
    });
}

// ============================================================
// STATE
// ============================================================

function sendState() {
    const state = {
        paused: audio.paused,
        currentTime: audio.currentTime || 0,
        duration: Number.isFinite(audio.duration) ? audio.duration : 0,
        playbackRate: audio.playbackRate,
        hasSrc: Boolean(audio.src),
    };

    console.log("[BLV Offscreen] State:", state);

    chrome.runtime
        .sendMessage({
            type: "audio-state",
            state,
        })
        .catch((error) => {
            console.error("[BLV Offscreen] Failed to send state:", error);
        });
}

// ============================================================
// SUMMARY AUDIO EVENTS
// ============================================================

audio.addEventListener("play", () => {
    console.log("[BLV Offscreen] SUMMARY PLAY");
    sendState();
});

audio.addEventListener("pause", () => {
    console.log("[BLV Offscreen] SUMMARY PAUSE");
    sendState();
});

audio.addEventListener("timeupdate", sendState);
audio.addEventListener("ratechange", sendState);

audio.addEventListener("ended", () => {
    console.log("[BLV Offscreen] SUMMARY ENDED");
    sendState();
});

audio.addEventListener("loadedmetadata", () => {
    console.log(
        "[BLV Offscreen] Summary metadata loaded. Duration:",
        audio.duration,
    );
});

audio.addEventListener("canplay", () => {
    console.log("[BLV Offscreen] Summary can play");
});

audio.addEventListener("error", () => {
    console.error("[BLV Offscreen] SUMMARY AUDIO ERROR:", audio.error);
    logAudioDiagnostics("Summary audio error");
});

// ============================================================
// NOTIFICATION AUDIO EVENTS
// ============================================================

notificationAudio.addEventListener("play", () => {
    console.log("[BLV Offscreen] NOTIFICATION PLAY");
});

notificationAudio.addEventListener("pause", () => {
    console.log("[BLV Offscreen] NOTIFICATION PAUSE");
});

notificationAudio.addEventListener("ended", () => {
    console.log("[BLV Offscreen] NOTIFICATION FINISHED");
    logAudioDiagnostics("Shortcuts notification ended; summary unchanged");
});

notificationAudio.addEventListener("error", () => {
    console.error(
        "[BLV Offscreen] NOTIFICATION AUDIO ERROR:",
        notificationAudio.error,
    );
});

// ============================================================
// NAVIGATION AUDIO EVENTS
// ============================================================

navigationAudio.addEventListener("play", () => {
    console.log("[BLV Offscreen] NAVIGATION PLAY");
});

navigationAudio.addEventListener("pause", () => {
    console.log("[BLV Offscreen] NAVIGATION PAUSE");
});

navigationAudio.addEventListener("ended", () => {
    console.log("[BLV Offscreen] NAVIGATION FINISHED");
});

navigationAudio.addEventListener("error", () => {
    console.error(
        "[BLV Offscreen] NAVIGATION AUDIO ERROR:",
        navigationAudio.error,
    );
});

// ============================================================
// LOAD SUMMARY AUDIO
// ============================================================

async function loadAudio(audioData) {
    if (!audioData) {
        throw new Error("No audio data provided");
    }

    const thisLoadId = ++audioLoadId;

    console.log(
        "[BLV Offscreen] Loading summary audio. Data length:",
        audioData.length,
    );

    // Stop any previous summary audio.
    audio.pause();

    // Stop notification if it happens to be playing.
    notificationAudio.pause();
    notificationAudio.currentTime = 0;
    navigationAudio.pause();
    navigationAudio.currentTime = 0;

    // Reset the summary audio.
    audio.removeAttribute("src");
    audio.load();

    audio.currentTime = 0;

    // Reset speed whenever a new summary is loaded.
    audio.playbackRate = 1;

    // IMPORTANT:
    // Attach listeners BEFORE calling audio.load().
    const ready = new Promise((resolve, reject) => {
        let finished = false;

        const cleanup = () => {
            audio.removeEventListener("canplay", handleCanPlay);
            audio.removeEventListener("loadeddata", handleLoadedData);
            audio.removeEventListener("error", handleError);
        };

        const finish = () => {
            if (finished) return;

            finished = true;
            cleanup();

            console.log("[BLV Offscreen] Summary audio loaded and ready.");

            resolve();
        };

        const handleCanPlay = () => {
            console.log("[BLV Offscreen] canplay received");

            finish();
        };

        const handleLoadedData = () => {
            console.log("[BLV Offscreen] loadeddata received");

            // loadeddata is sufficient for our purposes.
            finish();
        };

        const handleError = () => {
            if (finished) return;

            finished = true;
            cleanup();

            const error = audio.error;

            reject(
                new Error(
                    `Summary audio failed to load. Code: ${
                        error?.code || "unknown"
                    }`,
                ),
            );
        };

        audio.addEventListener("canplay", handleCanPlay);
        audio.addEventListener("loadeddata", handleLoadedData);
        audio.addEventListener("error", handleError);
    });

    // Set the new audio source.
    audio.src = audioData;

    console.log("[BLV Offscreen] Summary audio source assigned.");

    // Now start loading.
    audio.load();

    await ready;

    // Make sure this is still the latest audio request.
    if (thisLoadId !== audioLoadId) {
        console.log("[BLV Offscreen] Ignoring outdated audio load.");
        return;
    }

    console.log(
        "[BLV Offscreen] Summary audio ready. Duration:",
        audio.duration,
    );

    logAudioDiagnostics("Summary loaded and paused before ready notification");

    sendState();
}

// ============================================================
// PLAY / PAUSE
// ============================================================

async function togglePlayPause() {
    console.log("[BLV Offscreen] Toggle requested");
    logAudioDiagnostics("toggle-play-pause received");

    // The notification should always stop when the user
    // explicitly asks to play/pause the summary.
    notificationAudio.pause();
    notificationAudio.currentTime = 0;
    navigationAudio.pause();
    navigationAudio.currentTime = 0;

    if (!audio.src) {
        console.warn("[BLV Offscreen] No summary audio source!");
        return;
    }

    console.log("[BLV Offscreen] Summary audio state:", {
        paused: audio.paused,
        currentTime: audio.currentTime,
        duration: audio.duration,
        readyState: audio.readyState,
        networkState: audio.networkState,
    });

    if (audio.paused) {
        console.log("[BLV Offscreen] Calling summary audio.play()");
        logAudioDiagnostics("Calling summary audio.play()");

        try {
            await audio.play();
            console.log("[BLV Offscreen] Summary audio.play() succeeded");
            logAudioDiagnostics("Summary audio.play() succeeded");
        } catch (error) {
            console.error(
                "[BLV Offscreen] Failed to play summary audio:",
                error,
            );
            console.error("[BLV Offscreen] Summary media error:", audio.error);
            logAudioDiagnostics("Summary audio.play() rejected");
            throw error;
        }
    } else {
        console.log("[BLV Offscreen] Calling summary audio.pause()");

        audio.pause();
    }

    sendState();
}

// ============================================================
// REWIND
// ============================================================

function rewind(seconds = 5) {
    console.log("[BLV Offscreen] Rewind requested:", seconds);

    if (!audio.src) {
        console.warn("[BLV Offscreen] Cannot rewind: no audio source.");
        return;
    }

    audio.currentTime = Math.max(0, audio.currentTime - seconds);

    sendState();
}

// ============================================================
// SPEED
// ============================================================

async function setSpeed(delta) {
    console.log("[BLV Offscreen] Speed change requested:", delta);

    if (!audio.src) {
        console.warn("[BLV Offscreen] Cannot change speed: no audio source.");
        return;
    }

    const wasPlaying = !audio.paused;

    const currentIndex = SPEEDS.indexOf(audio.playbackRate);

    const index = currentIndex === -1 ? SPEEDS.indexOf(1) : currentIndex;

    const nextIndex = Math.min(SPEEDS.length - 1, Math.max(0, index + delta));

    const newSpeed = SPEEDS[nextIndex];

    console.log(
        "[BLV Offscreen] Changing speed:",
        audio.playbackRate,
        "→",
        newSpeed,
        "wasPlaying:",
        wasPlaying,
    );

    audio.playbackRate = newSpeed;

    // If it was playing before the speed change,
    // make sure it is still playing afterwards.
    if (wasPlaying && audio.paused) {
        console.log("[BLV Offscreen] Audio paused unexpectedly. Resuming...");

        try {
            await audio.play();

            console.log("[BLV Offscreen] Audio resumed after speed change.");
        } catch (error) {
            console.error(
                "[BLV Offscreen] Failed to resume after speed change:",
                error,
            );
        }
    }

    sendState();
}

// ============================================================
// MESSAGES FROM BACKGROUND
// ============================================================

// ============================================================
// STOP ALL AUDIO
// ============================================================

function stopAllAudio() {
    console.log("[BLV Offscreen] Stopping all audio");

    // Stop summary
    audio.pause();
    audio.currentTime = 0;

    // Stop shortcut notification
    notificationAudio.pause();
    notificationAudio.currentTime = 0;

    // Stop navigation notification
    navigationAudio.pause();
    navigationAudio.currentTime = 0;

    sendState();
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    console.log("[BLV Offscreen] Received message:", message.type);

    // ========================================================
    // FIRE-AND-FORGET NOTIFICATIONS
    // ========================================================

    if (message.type === "play-navigation-notification") {
        console.log(
            "[BLV Offscreen] Playing navigation notification"
        );

        (async () => {
            logAudioDiagnostics("Starting navigation notification");

            // Stop anything currently playing.
            audio.pause();

            notificationAudio.pause();
            notificationAudio.currentTime = 0;

            navigationAudio.pause();
            navigationAudio.currentTime = 0;

            // Play the navigation announcement.
            await navigationAudio.play();
            logAudioDiagnostics("Navigation notification started");
        })().catch((error) => {
            console.error(
                "[BLV Offscreen] Navigation notification error:",
                error
            );
        });

        // IMPORTANT:
        // No sendResponse()
        // No return true
        return;
    }

    if (message.type === "play-notification") {
        console.log(
            "[BLV Offscreen] Playing shortcut notification"
        );

        (async () => {
            logAudioDiagnostics("Starting shortcuts notification");

            // Stop summary audio.
            audio.pause();

            // Only one notification should play at a time.
            navigationAudio.pause();
            navigationAudio.currentTime = 0;

            // Restart notification from beginning.
            notificationAudio.pause();
            notificationAudio.currentTime = 0;

            await notificationAudio.play();
            logAudioDiagnostics("Shortcuts notification started");
        })().catch((error) => {
            console.error(
                "[BLV Offscreen] Shortcut notification error:",
                error
            );
        });

        // IMPORTANT:
        // No sendResponse()
        // No return true
        return;
    }

    // ========================================================
    // REQUEST / RESPONSE MESSAGES
    // ========================================================

    (async () => {
        try {
            switch (message.type) {

                // --------------------------------------------
                // STOP ALL AUDIO
                // --------------------------------------------

                case "stop-all-audio":
                    console.log(
                        "[BLV Offscreen] Stop-all-audio requested"
                    );

                    stopAllAudio();

                    break;

                // --------------------------------------------
                // NEW SUMMARY AUDIO
                // --------------------------------------------

                case "load-audio":
                    await loadAudio(message.audio);
                    break;

                // --------------------------------------------
                // PLAY / PAUSE
                // --------------------------------------------

                case "toggle-play-pause":
                    await togglePlayPause();
                    break;

                // --------------------------------------------
                // REWIND
                // --------------------------------------------

                case "rewind":
                    rewind(message.seconds || 10);
                    break;

                // --------------------------------------------
                // SPEED
                // --------------------------------------------

                case "set-speed":
                    await setSpeed(Number(message.delta || 0));
                    break;

                // --------------------------------------------
                // STATE
                // --------------------------------------------

                case "get-audio-state":
                    console.log(
                        "[BLV Offscreen] State requested"
                    );

                    sendState();
                    break;

                // --------------------------------------------
                // UNKNOWN
                // --------------------------------------------

                default:
                    console.warn(
                        "[BLV Offscreen] Unknown message:",
                        message.type
                    );
            }

            sendResponse({
                ok: true,
            });

        } catch (error) {
            console.error(
                "[BLV Offscreen] Message handling error:",
                error
            );

            sendResponse({
                ok: false,
                error: error.message,
            });
        }
    })();

    // These messages use sendResponse asynchronously.
    return true;
});
