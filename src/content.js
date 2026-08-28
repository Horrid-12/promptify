/**
 * content.js
 * Injected into supported AI websites to detect user activity and visibility state.
 */

// Throttle active signals to avoid spamming the background service worker
const THROTTLE_INTERVAL_MS = 10000; // 10 seconds
let lastMessageTime = 0;
let listenersActive = true;

/**
 * Validates if the extension context is still active and connected.
 */
function isContextValid() {
    try {
        return !!(chrome.runtime && chrome.runtime.id);
    } catch (e) {
        return false;
    }
}

/**
 * Removes event listeners when the script is orphaned due to extension reload/update.
 */
function cleanUpAndStop() {
    if (!listenersActive) return;
    listenersActive = false;

    console.log("[AI Tracker] Extension context invalidated. Cleaning up page event listeners.");

    ["mousemove", "keydown", "click", "scroll"].forEach((eventName) => {
        window.removeEventListener(eventName, handleActivityEvent, { passive: true });
    });
    document.removeEventListener("visibilitychange", handleVisibilityEvent);
}

/**
 * Sends an activity heartbeat to the background script, throttled.
 */
function reportActivity(eventType) {
    if (!isContextValid()) {
        cleanUpAndStop();
        return;
    }

    const now = Date.now();
    if (now - lastMessageTime > THROTTLE_INTERVAL_MS) {
        lastMessageTime = now;
        try {
            chrome.runtime.sendMessage({
                type: "USER_ACTIVITY",
                eventType: eventType,
                timestamp: now
            }, (response) => {
                if (chrome.runtime) {
                    const err = chrome.runtime.lastError;
                }
            });
        } catch (e) {
            cleanUpAndStop();
        }
    }
}

/**
 * Reports tab visibility status changes immediately.
 */
function reportVisibilityChange() {
    if (!isContextValid()) {
        cleanUpAndStop();
        return;
    }

    try {
        chrome.runtime.sendMessage({
            type: "VISIBILITY_CHANGE",
            visibilityState: document.visibilityState,
            timestamp: Date.now()
        }, (response) => {
            if (chrome.runtime) {
                const err = chrome.runtime.lastError;
            }
        });
    } catch (e) {
        cleanUpAndStop();
    }
}

// Named event handlers so they can be removed dynamically
const handleActivityEvent = (event) => reportActivity(event.type);
const handleVisibilityEvent = () => reportVisibilityChange();

// Add event listeners for active user interactions
["mousemove", "keydown", "click", "scroll"].forEach((eventName) => {
    window.addEventListener(eventName, handleActivityEvent, { passive: true });
});

// Monitor page visibility state
document.addEventListener("visibilitychange", handleVisibilityEvent);

// Report initial states
reportVisibilityChange();
reportActivity("init");
