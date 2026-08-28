/**
 * background.js
 * Service worker coordinating active AI sessions with inactivity checks.
 * Persists completed sessions to IndexedDB via db.js.
 */

importScripts('db.js');

// ─── Platform Registry ────────────────────────────────────────────────────────

const AI_SITES = {
    'chatgpt.com':        'ChatGPT',
    'claude.ai':          'Claude',
    'gemini.google.com':  'Gemini',
    'perplexity.ai':      'Perplexity'
};

// Reverse map: site name → canonical domain
const AI_SITE_DOMAINS = {
    'ChatGPT':    'chatgpt.com',
    'Claude':     'claude.ai',
    'Gemini':     'gemini.google.com',
    'Perplexity': 'perplexity.ai'
};

// Inactivity threshold: 5 minutes
const INACTIVITY_TIMEOUT_MS = 300000;

// In-memory active session (transient; also persisted to chrome.storage.local
// so it survives service worker suspension).
let activeSession = null;

// ─── Startup — Restore Active Session ────────────────────────────────────────

// Restore any serialized active session state on service worker startup.
chrome.storage.local.get(['activeSessionState'], (result) => {
    if (result.activeSessionState && isValidActiveSession(result.activeSessionState)) {
        activeSession = result.activeSessionState;
        console.log('[AI Tracker] Restored active session state:', activeSession.site);
    } else if (result.activeSessionState) {
        // Corrupted state — clear it.
        chrome.storage.local.remove('activeSessionState');
        console.warn('[AI Tracker] Cleared corrupted active session state.');
    }
});

// ─── Install / Update ────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener((details) => {
    // Always initialise IndexedDB on install/update.
    initDatabase().then(() => {
        console.log('[AI Tracker] IndexedDB ready.');
        runMigrationIfNeeded();
    }).catch(err => {
        console.error('[AI Tracker] IndexedDB init failed on install:', err);
    });
});

/**
 * One-time migration: copies existing chrome.storage.local sessions into IndexedDB.
 * Protected by a databaseMigrationVersion flag so it only runs once.
 */
function runMigrationIfNeeded() {
    chrome.storage.local.get(['sessions', 'databaseMigrationVersion'], (result) => {
        if (result.databaseMigrationVersion >= 1) {
            console.log('[AI Tracker] Migration already complete. Skipping.');
            return;
        }

        const oldSessions = Array.isArray(result.sessions) ? result.sessions : [];

        if (oldSessions.length === 0) {
            chrome.storage.local.set({ databaseMigrationVersion: 1 });
            console.log('[AI Tracker] No legacy sessions to migrate.');
            return;
        }

        console.log(`[AI Tracker] Migrating ${oldSessions.length} legacy session(s) to IndexedDB...`);

        const valid = oldSessions.filter(isValidLegacySession);
        const promises = valid.map(s => {
            const record = {
                id:        s.id || crypto.randomUUID(),
                site:      s.site,
                domain:    AI_SITE_DOMAINS[s.site] || s.site.toLowerCase() + '.com',
                startTime: s.startTime,
                endTime:   s.endTime,
                duration:  s.duration,
                date:      s.date || getLocalDateString(s.startTime),
                createdAt: s.endTime || Date.now()
            };
            return addSession(record);
        });

        Promise.all(promises).then(() => {
            chrome.storage.local.set({ databaseMigrationVersion: 1 });
            console.log(`[AI Tracker] Migration complete. ${valid.length} session(s) migrated.`);
            // Old sessions[] preserved in chrome.storage.local as a safety net.
            // It can be cleared in a future version once migration is confirmed stable.
        }).catch(err => {
            console.error('[AI Tracker] Migration failed:', err);
            // Do NOT set databaseMigrationVersion so it retries next time.
        });
    });
}

// ─── Validation ───────────────────────────────────────────────────────────────

function isValidActiveSession(session) {
    return session &&
           typeof session === 'object' &&
           typeof session.site === 'string' &&
           typeof session.startTime === 'number' &&
           typeof session.lastActivity === 'number' &&
           typeof session.tabId === 'number';
}

function isValidLegacySession(s) {
    return s &&
           typeof s === 'object' &&
           typeof s.site === 'string' &&
           typeof s.startTime === 'number' &&
           typeof s.endTime === 'number' &&
           typeof s.duration === 'number' &&
           s.duration >= 0 &&
           s.endTime >= s.startTime;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Converts a Unix ms timestamp to a local YYYY-MM-DD string.
 * Duplicated here to keep background.js self-contained
 * (analytics.js is not imported in the service worker).
 */
function getLocalDateString(timestamp) {
    const d = new Date(timestamp);
    const year  = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day   = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function formatDurationLog(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}m ${seconds}s`;
}

/**
 * Normalizes a URL and returns the AI platform name, or null if unsupported.
 */
function getAiSiteName(urlString) {
    if (!urlString) return null;
    try {
        const { hostname } = new URL(urlString);
        for (const [domain, name] of Object.entries(AI_SITES)) {
            if (hostname === domain || hostname.endsWith('.' + domain)) {
                return name;
            }
        }
    } catch (_) { /* invalid URL */ }
    return null;
}

// ─── Active Session State Persistence ────────────────────────────────────────

/**
 * Writes the current activeSession to chrome.storage.local so the service
 * worker can restore it after suspension.
 */
function persistActiveSessionState() {
    if (activeSession) {
        chrome.storage.local.set({ activeSessionState: activeSession });
    } else {
        chrome.storage.local.remove('activeSessionState');
    }
}

// ─── Session Engine ───────────────────────────────────────────────────────────

/**
 * Ends the current active session, calculates its real duration using
 * timestamps (never a counter), and persists it to IndexedDB.
 *
 * If the user was inactive for >= INACTIVITY_TIMEOUT_MS, the session end
 * time is capped at lastActivity to exclude idle time.
 */
function endCurrentSession(now) {
    if (!activeSession) return;
    now = now || Date.now();

    const timeSinceLastActivity = now - activeSession.lastActivity;
    const endTime = timeSinceLastActivity >= INACTIVITY_TIMEOUT_MS
        ? activeSession.lastActivity  // cap at last known activity
        : now;

    const duration = endTime - activeSession.startTime;

    // Only persist sessions of at least 1 second.
    if (duration >= 1000) {
        const sessionRecord = {
            id:        activeSession.id,
            site:      activeSession.site,
            domain:    AI_SITE_DOMAINS[activeSession.site] || activeSession.site,
            startTime: activeSession.startTime,
            endTime:   endTime,
            duration:  duration,
            date:      getLocalDateString(activeSession.startTime),
            createdAt: Date.now()
        };

        console.log(`[AI Tracker] Session ended: ${sessionRecord.site} (${formatDurationLog(duration)})`);

        // Persist to IndexedDB.
        addSession(sessionRecord).catch(err => {
            console.error('[AI Tracker] Failed to persist session to IndexedDB:', err);
        });
    }

    activeSession = null;
    persistActiveSessionState();
}

/**
 * Starts a new tracking session for a specific AI site.
 * If a session for the same tab is already active and not yet inactive,
 * only refreshes lastActivity. Otherwise ends the existing session first.
 */
function startSession(site, tabId, now) {
    now = now || Date.now();

    if (activeSession) {
        if (activeSession.site === site && activeSession.tabId === tabId) {
            const timeSinceLastActivity = now - activeSession.lastActivity;
            if (timeSinceLastActivity >= INACTIVITY_TIMEOUT_MS) {
                // Same tab resumed after going idle — treat as a new session.
                console.log('[AI Tracker] Session resumed after inactivity. Starting new session.');
                endCurrentSession(now);
                // fall through to start a new session below
            } else {
                // Same active tab — just refresh the activity timestamp.
                activeSession.lastActivity = now;
                persistActiveSessionState();
                return;
            }
        } else {
            // Different site or tab — end the previous session.
            endCurrentSession(now);
        }
    }

    activeSession = {
        id:           crypto.randomUUID(),
        site:         site,
        startTime:    now,
        lastActivity: now,
        tabId:        tabId
    };

    console.log(`[AI Tracker] Session started: ${site}`);
    persistActiveSessionState();
}

/**
 * Evaluates a tab and decides whether to start, continue, or stop tracking.
 */
function handleTabChange(tab) {
    if (!tab) { endCurrentSession(); return; }
    const siteName = getAiSiteName(tab.url);
    if (siteName) {
        startSession(siteName, tab.id);
    } else {
        endCurrentSession();
    }
}

// ─── Chrome Event Listeners ───────────────────────────────────────────────────

// 1. Active tab changes
chrome.tabs.onActivated.addListener((activeInfo) => {
    chrome.tabs.get(activeInfo.tabId, (tab) => {
        if (chrome.runtime.lastError || !tab) return;
        handleTabChange(tab);
    });
});

// 2. Tab navigation / URL changes
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete' || changeInfo.url) {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            const activeTab = tabs[0];
            if (activeTab && activeTab.id === tabId) {
                handleTabChange(activeTab);
            }
        });
    }
});

// 3. Tab closed
chrome.tabs.onRemoved.addListener((tabId) => {
    if (activeSession && activeSession.tabId === tabId) {
        console.log('[AI Tracker] AI tab closed. Ending session.');
        endCurrentSession();
    }
});

// 4. Window focus changes
chrome.windows.onFocusChanged.addListener((windowId) => {
    if (windowId === chrome.windows.WINDOW_ID_NONE) {
        console.log('[AI Tracker] Browser unfocused. Ending session.');
        endCurrentSession();
    } else {
        chrome.tabs.query({ active: true, windowId: windowId }, (tabs) => {
            if (tabs[0]) handleTabChange(tabs[0]);
        });
    }
});

// 5. Messages from content.js (activity heartbeats and visibility changes)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!sender.tab || !sender.tab.id) return;

    const siteName = getAiSiteName(sender.tab.url);
    if (!siteName) return;

    const now = Date.now();

    if (message.type === 'USER_ACTIVITY') {
        // Only count activity from the currently active tab.
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0] && tabs[0].id === sender.tab.id) {
                startSession(siteName, sender.tab.id, now);
            }
        });
    } else if (message.type === 'VISIBILITY_CHANGE') {
        if (message.visibilityState === 'hidden') {
            if (activeSession && activeSession.tabId === sender.tab.id) {
                endCurrentSession(now);
            }
        } else if (message.visibilityState === 'visible') {
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                if (tabs[0] && tabs[0].id === sender.tab.id) {
                    startSession(siteName, sender.tab.id, now);
                }
            });
        }
    }

    sendResponse({ status: 'ok' });
});

// 6. Periodic alarm: enforce inactivity timeout even if content.js is silent
//    (e.g. user moved to another app without closing the tab).
chrome.alarms.create('inactivityCheck', { periodInMinutes: 1 });

chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'inactivityCheck' && activeSession) {
        const now = Date.now();
        if (now - activeSession.lastActivity >= INACTIVITY_TIMEOUT_MS) {
            console.log('[AI Tracker] Inactivity timeout reached via alarm. Ending session.');
            endCurrentSession(now);
        }
    }
});
