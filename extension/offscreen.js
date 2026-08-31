const audio = document.getElementById("summaryAudio");
const notificationAudio = document.getElementById("notificationAudio");

notificationAudio.src = chrome.runtime.getURL("audio/shortcuts.wav");

const SPEEDS = [0.75, 1, 1.25, 1.5, 1.75, 2];

console.log("[BLV Offscreen] Loaded");

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

audio.addEventListener("play", () => {
    console.log("[BLV Offscreen] PLAY");
    sendState();
});

audio.addEventListener("pause", () => {
    console.log("[BLV Offscreen] PAUSE");
    sendState();
});

audio.addEventListener("timeupdate", sendState);
audio.addEventListener("ratechange", sendState);

audio.addEventListener("ended", () => {
    console.log("[BLV Offscreen] ENDED");
    sendState();
});

audio.addEventListener("loadedmetadata", () => {
    console.log(
        "[BLV Offscreen] Audio metadata loaded. Duration:",
        audio.duration,
    );
});

audio.addEventListener("canplay", () => {
    console.log("[BLV Offscreen] Audio can play");
});

audio.addEventListener("error", () => {
    console.error("[BLV Offscreen] AUDIO ERROR:", audio.error);
});

async function loadAudio(audioData) {
    if (!audioData) {
        throw new Error("No audio data provided");
    }

    console.log(
        "[BLV Offscreen] Loading audio. Data length:",
        audioData.length,
    );

    // Stop the previous audio.
    audio.pause();

    // Reset the previous audio source.
    audio.removeAttribute("src");
    audio.load();

    // Reset playback position.
    audio.currentTime = 0;

    // Set the new audio.
    audio.src = audioData;

    console.log("[BLV Offscreen] Audio source assigned.");

    // Tell the browser to load the new audio.
    audio.load();

    // Wait until the audio is actually ready to play.
    await new Promise((resolve, reject) => {
        const handleCanPlay = () => {
            cleanup();

            console.log("[BLV Offscreen] Audio loaded and ready to play.");

            resolve();
        };

        const handleError = () => {
            cleanup();

            const error = audio.error;

            reject(
                new Error(
                    `Audio failed to load. Code: ${error?.code || "unknown"}`,
                ),
            );
        };

        const cleanup = () => {
            audio.removeEventListener("canplay", handleCanPlay);
            audio.removeEventListener("error", handleError);
        };

        audio.addEventListener("canplay", handleCanPlay);
        audio.addEventListener("error", handleError);
    });

    sendState();
}

async function togglePlayPause() {
    console.log("[BLV Offscreen] Toggle requested");

    if (!audio.src) {
        console.warn("[BLV Offscreen] No audio source!");
        return;
    }

    if (audio.paused) {
        console.log("[BLV Offscreen] Calling audio.play()");

        await audio.play();

        console.log("[BLV Offscreen] audio.play() succeeded");
    } else {
        console.log("[BLV Offscreen] Calling audio.pause()");

        audio.pause();
    }

    sendState();
}

function rewind(seconds = 10) {
    console.log("[BLV Offscreen] Rewind requested:", seconds);

    audio.currentTime = Math.max(0, audio.currentTime - seconds);

    sendState();
}

function fastForward(seconds = 10) {
    console.log("[BLV Offscreen] Fast-forward requested:", seconds);

    if (!Number.isFinite(audio.duration)) {
        console.warn("[BLV Offscreen] Audio duration is not available yet.");
        return;
    }

    audio.currentTime = Math.min(audio.duration, audio.currentTime + seconds);

    sendState();
}

function setSpeed(delta) {
    console.log("[BLV Offscreen] Speed change requested:", delta);

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

    // Make sure changing speed doesn't leave playback paused.
    if (wasPlaying && audio.paused) {
        console.log("[BLV Offscreen] Audio unexpectedly paused. Resuming...");

        audio.play().catch((error) => {
            console.error(
                "[BLV Offscreen] Failed to resume after speed change:",
                error,
            );
        });
    }

    sendState();
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    console.log("[BLV Offscreen] Received message:", message.type);

    (async () => {
        switch (message.type) {
            case "play-notification":
                console.log("[BLV Offscreen] Playing notification");

                notificationAudio.pause();
                notificationAudio.currentTime = 0;

                await notificationAudio.play();

                break;

            case "load-audio":
                await loadAudio(message.audio);
                break;

            case "toggle-play-pause":
                console.log("[BLV Offscreen] Toggle requested");

                if (!audio.src) {
                    console.warn("[BLV Offscreen] No summary audio source!");
                    break;
                }

                // Stop the shortcut notification immediately.
                notificationAudio.pause();
                notificationAudio.currentTime = 0;

                if (audio.paused) {
                    console.log("[BLV Offscreen] Calling audio.play()");
                    await audio.play();
                    console.log("[BLV Offscreen] audio.play() succeeded");
                } else {
                    console.log("[BLV Offscreen] Calling audio.pause()");
                    audio.pause();
                }

                sendState();
                break;

            case "rewind":
                rewind(message.seconds || 10);
                break;

            case "fast-forward":
                fastForward(message.seconds || 10);
                break;

            case "set-speed":
                setSpeed(Number(message.delta || 0));
                break;

            case "get-audio-state":
                console.log("[BLV Offscreen] State requested");

                sendState();
                break;

            default:
                console.warn("[BLV Offscreen] Unknown message:", message.type);
        }

        sendResponse({ ok: true });
    })().catch((error) => {
        console.error("[BLV Offscreen] Message handling error:", error);

        sendResponse({
            ok: false,
            error: error.message,
        });
    });

    return true;
});
