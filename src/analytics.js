/**
 * analytics.js
 * Shared statistics layer for AI Time Tracker.
 *
 * Depends on db.js being loaded first (global functions: getSessionsByDate,
 * getSessionsByDateRange, getAllSessions, getRecentSessions).
 *
 * Compatible with:
 *   - importScripts in the service worker
 *   - <script> tag in popup.html / dashboard.html
 *
 * All statistics functions return Promises.
 */

// Dynamic platform list from central registry (platforms.js must be loaded first)
var SUPPORTED_PLATFORMS = (typeof getAllPlatformIds === 'function') ? getAllPlatformIds() : ['ChatGPT', 'Claude', 'Gemini', 'Perplexity'];

// Must match background.js
const INACTIVITY_TIMEOUT_MS = 300000; // 5 minutes

// ─── Date / Time Helpers ──────────────────────────────────────────────────────

/**
 * Converts a Unix ms timestamp to a local YYYY-MM-DD string.
 */
function getLocalDateString(timestamp) {
    const d = new Date(timestamp);
    const year  = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day   = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

/**
 * Returns the start of today (00:00:00.000) as a Unix ms timestamp.
 */
function getTodayStart() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime();
}

/**
 * Returns the end of today (23:59:59.999) as a Unix ms timestamp.
 */
function getTodayEnd() {
    const d = new Date();
    d.setHours(23, 59, 59, 999);
    return d.getTime();
}

/**
 * Returns the start of a day N days in the past (00:00:00.000) as Unix ms.
 * daysBack = 0 → start of today, daysBack = 1 → start of yesterday, etc.
 */
function getDateDaysAgo(daysBack) {
    const d = new Date();
    d.setDate(d.getDate() - daysBack);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
}

/**
 * Formats a duration (ms) into a human-readable string.
 * Examples: "2h 5m", "45m", "0m"
 */
function formatDuration(ms) {
    if (!ms || ms < 0) ms = 0;
    const totalMinutes = Math.floor(ms / 60000);
    const hours   = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
}

/**
 * Formats a timestamp into a friendly relative date string.
 * Returns "Today", "Yesterday", or a short date like "Aug 22".
 */
function formatDate(timestamp) {
    const now      = new Date();
    const todayStr = getLocalDateString(now.getTime());
    const dateStr  = getLocalDateString(timestamp);

    if (dateStr === todayStr) return 'Today';

    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    if (dateStr === getLocalDateString(yesterday.getTime())) return 'Yesterday';

    return new Date(timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/**
 * Formats a Unix ms timestamp to a HH:MM time string in local timezone.
 */
function formatTime(timestamp) {
    return new Date(timestamp).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

// ─── Active Session Helper ────────────────────────────────────────────────────

/**
 * Returns how many ms the current in-progress session has accumulated,
 * capped at lastActivity if the user has been idle past the timeout.
 *
 * @param {Object|null} activeSession — chrome.storage.local.activeSessionState
 * @returns {number} elapsed ms (0 if no active session)
 */
function getActiveSessionElapsedMs(activeSession) {
    if (!activeSession) return 0;
    const now = Date.now();
    const isInactive = (now - activeSession.lastActivity >= INACTIVITY_TIMEOUT_MS);
    if (isInactive) {
        return Math.max(0, activeSession.lastActivity - activeSession.startTime);
    }
    return Math.max(0, now - activeSession.startTime);
}

// ─── Statistics Functions ─────────────────────────────────────────────────────

/**
 * Today's stats, including any currently active in-progress session.
 *
 * Session counting semantics:
 *   - sessionCount = completed sessions only (does not count the active one)
 *   - totalMs      = completed duration + active session elapsed time
 *   - byPlatform   = same split logic (completed + active)
 *   - avgMs        = avg of completed sessions only
 *
 * The active session is NOT double-counted after it ends and is persisted
 * to IndexedDB, because endCurrentSession in background.js clears activeSessionState.
 *
 * @param {Object|null} activeSession
 * @returns {Promise<{totalMs, sessionCount, avgMs, byPlatform, topPlatform}>}
 */
/**
 * Stats for a specific day (daysAgo: 0 = today, 1 = yesterday).
 */
async function getDailyStats(daysAgo = 0, activeSession = null) {
    const targetDateStr = getLocalDateString(getDateDaysAgo(daysAgo));
    const sessions = await getSessionsByDate(targetDateStr);

    const byPlatform = {};
    SUPPORTED_PLATFORMS.forEach(p => { byPlatform[p] = 0; });

    let completedMs = 0;
    sessions.forEach(s => {
        completedMs += s.duration;
        var siteId = (typeof normalizeSiteId === 'function') ? normalizeSiteId(s.site) : s.site;
        if (Object.prototype.hasOwnProperty.call(byPlatform, siteId)) {
            byPlatform[siteId] += s.duration;
        }
    });

    // Add in-progress active session (only if querying today)
    let activeMs = 0;
    if (daysAgo === 0 && activeSession && getLocalDateString(activeSession.startTime) === targetDateStr) {
        activeMs = getActiveSessionElapsedMs(activeSession);
        var activeSiteId = (typeof normalizeSiteId === 'function') ? normalizeSiteId(activeSession.site) : activeSession.site;
        if (Object.prototype.hasOwnProperty.call(byPlatform, activeSiteId)) {
            byPlatform[activeSiteId] += activeMs;
        }
    }

    const totalMs      = completedMs + activeMs;
    const sessionCount = sessions.length;
    const avgMs        = sessionCount > 0 ? completedMs / sessionCount : 0;

    let topPlatform = null;
    let topMs = 0;
    for (const [platform, ms] of Object.entries(byPlatform)) {
        if (ms > topMs) { topMs = ms; topPlatform = platform; }
    }

    return { totalMs, sessionCount, avgMs, byPlatform, topPlatform, date: targetDateStr };
}

async function getTodayStats(activeSession) {
    return getDailyStats(0, activeSession);
}

/**
 * Stats for the last 7 days (days 0–6, where 0 = today).
 * @returns {Promise<{totalMs, dailyBreakdown, avgDailyMs, topPlatform}>}
 */
/**
 * Stats for a 7-day period (weeksAgo: 0 = last 7 days, 1 = previous 7 days).
 */
async function getWeeklyStats(weeksAgo = 0) {
    const endOffset = weeksAgo * 7;
    const startOffset = endOffset + 6;

    const start = getDateDaysAgo(startOffset);
    // If weeksAgo=0, end is end of today. If weeksAgo > 0, end is end of that past day.
    const endObj = new Date(getDateDaysAgo(endOffset));
    endObj.setHours(23, 59, 59, 999);
    const end = endObj.getTime();
    
    const sessions = await getSessionsByDateRange(start, end);

    // Pre-populate all 7 days with 0
    const dailyMap = {};
    for (let i = startOffset; i >= endOffset; i--) {
        dailyMap[getLocalDateString(getDateDaysAgo(i))] = 0;
    }

    const byPlatform = {};
    SUPPORTED_PLATFORMS.forEach(p => { byPlatform[p] = 0; });

    sessions.forEach(s => {
        const d = getLocalDateString(s.startTime);
        var siteId = (typeof normalizeSiteId === 'function') ? normalizeSiteId(s.site) : s.site;
        if (Object.prototype.hasOwnProperty.call(dailyMap, d)) {
            dailyMap[d] += s.duration;
        }
        if (Object.prototype.hasOwnProperty.call(byPlatform, siteId)) {
            byPlatform[siteId] += s.duration;
        }
    });

    const dailyBreakdown = Object.entries(dailyMap).map(([date, ms]) => ({ date, ms }));
    const totalMs        = sessions.reduce((acc, s) => acc + s.duration, 0);
    const sessionCount   = sessions.length;
    const avgMs          = sessionCount > 0 ? totalMs / sessionCount : 0;

    let topPlatform = null;
    let topMs = 0;
    for (const [platform, ms] of Object.entries(byPlatform)) {
        if (ms > topMs) { topMs = ms; topPlatform = platform; }
    }

    return { totalMs, sessionCount, avgMs, dailyBreakdown, byPlatform, topPlatform };
}

/**
 * Per-platform stats across all stored sessions.
 * @returns {Promise<Array<{site, totalMs, sessionCount, avgMs, percent}>>}
 */
async function getPlatformStats() {
    const all     = await getAllSessions();
    const totalMs = all.reduce((acc, s) => acc + s.duration, 0);

    return SUPPORTED_PLATFORMS.map(platform => {
        const platSessions = all.filter(s => {
            var siteId = (typeof normalizeSiteId === 'function') ? normalizeSiteId(s.site) : s.site;
            return siteId === platform;
        });
        const platMs       = platSessions.reduce((acc, s) => acc + s.duration, 0);
        return {
            site:         platform,
            totalMs:      platMs,
            sessionCount: platSessions.length,
            avgMs:        platSessions.length > 0 ? platMs / platSessions.length : 0,
            percent:      totalMs > 0 ? Math.round((platMs / totalMs) * 100) : 0
        };
    });
}

/**
 * Monthly usage totals for the last N calendar months (default 12).
 *
 * Returns an array ordered oldest → newest, one entry per month:
 *   { month: "2026-08", label: "Aug '26", ms: 12345000, sessionCount: 42 }
 *
 * Months with no sessions are included with ms = 0 so charts always
 * show a complete, contiguous range.
 *
 * @param {number} months - how many calendar months to include (default 12)
 * @returns {Promise<Array<{month, label, ms, sessionCount}>>}
 */
/**
 * Stats for a specific calendar month (monthsAgo: 0 = current month).
 */
async function getMonthlyStatsForMonth(monthsAgo = 0) {
    const now = new Date();
    const startObj = new Date(now.getFullYear(), now.getMonth() - monthsAgo, 1);
    const endObj = new Date(now.getFullYear(), now.getMonth() - monthsAgo + 1, 0); // Last day of month
    endObj.setHours(23, 59, 59, 999);
    
    const start = startObj.getTime();
    const end = endObj.getTime();

    const sessions = await getSessionsByDateRange(start, end);

    // Pre-populate days of month
    const dailyMap = {};
    const daysInMonth = endObj.getDate();
    for (let i = 1; i <= daysInMonth; i++) {
        const d = new Date(startObj.getFullYear(), startObj.getMonth(), i);
        dailyMap[getLocalDateString(d.getTime())] = 0;
    }

    const byPlatform = {};
    SUPPORTED_PLATFORMS.forEach(p => { byPlatform[p] = 0; });

    sessions.forEach(s => {
        const d = getLocalDateString(s.startTime);
        var siteId = (typeof normalizeSiteId === 'function') ? normalizeSiteId(s.site) : s.site;
        if (Object.prototype.hasOwnProperty.call(dailyMap, d)) {
            dailyMap[d] += s.duration;
        }
        if (Object.prototype.hasOwnProperty.call(byPlatform, siteId)) {
            byPlatform[siteId] += s.duration;
        }
    });

    const dailyBreakdown = Object.entries(dailyMap).map(([date, ms]) => ({ date, ms }));
    const totalMs        = sessions.reduce((acc, s) => acc + s.duration, 0);
    const sessionCount   = sessions.length;
    const avgMs          = sessionCount > 0 ? totalMs / sessionCount : 0;

    let topPlatform = null;
    let topMs = 0;
    for (const [platform, ms] of Object.entries(byPlatform)) {
        if (ms > topMs) { topMs = ms; topPlatform = platform; }
    }

    return { totalMs, sessionCount, avgMs, dailyBreakdown, byPlatform, topPlatform, label: startObj.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) };
}

/**
 * Monthly usage totals for the last N calendar months (default 12).
 * (Used for the old 12-month chart if needed)
 */
async function getMonthlyStats(months) {
    months = months || 12;

    const monthMap = {};
    const now = new Date();

    for (let i = months - 1; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        const label = d.toLocaleDateString(undefined, { month: 'short' }) +
            " '" + String(d.getFullYear()).slice(2);
        monthMap[key] = { month: key, label, ms: 0, sessionCount: 0 };
    }

    const keys       = Object.keys(monthMap);
    const oldestKey  = keys[0];
    const rangeStart = new Date(oldestKey + '-01');
    rangeStart.setHours(0, 0, 0, 0);

    const sessions = await getSessionsByDateRange(rangeStart.getTime(), Date.now());

    sessions.forEach(s => {
        const d   = new Date(s.startTime);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        if (Object.prototype.hasOwnProperty.call(monthMap, key)) {
            monthMap[key].ms           += s.duration;
            monthMap[key].sessionCount += 1;
        }
    });

    return Object.values(monthMap);
}

/**
 * Aggregate statistics about session durations across all time.
 * @returns {Promise<{longest, shortest, avg, total}>}
 */
async function getSessionStats() {
    const all = await getAllSessions();
    if (all.length === 0) {
        return { longest: 0, shortest: 0, avg: 0, total: 0 };
    }
    const durations = all.map(s => s.duration);
    return {
        longest:  Math.max(...durations),
        shortest: Math.min(...durations),
        avg:      durations.reduce((a, b) => a + b, 0) / durations.length,
        total:    all.length
    };
}

// ─── Nested Platform Stats ────────────────────────────────────────────────────

/**
 * Returns platform stats grouped with parent/sub-platform nesting.
 * For each top-level platform that has sub-platforms, includes a
 * `children` array with the sub-platform breakdown.
 */
async function getNestedPlatformStats() {
    const all = await getAllSessions();
    const totalMs = all.reduce((acc, s) => acc + s.duration, 0);
    const topLevelIds = (typeof getTopLevelPlatformIds === 'function')
        ? getTopLevelPlatformIds()
        : SUPPORTED_PLATFORMS;

    const result = topLevelIds.map(function(platformId) {
        const platSessions = all.filter(s => s.site === platformId);
        const platMs = platSessions.reduce((acc, s) => acc + s.duration, 0);

        var entry = {
            id:           platformId,
            name:         (typeof getPlatformName === 'function') ? getPlatformName(platformId) : platformId,
            icon:         (typeof getPlatformIcon === 'function') ? getPlatformIcon(platformId) : '',
            totalMs:      platMs,
            sessionCount: platSessions.length,
            avgMs:        platSessions.length > 0 ? platMs / platSessions.length : 0,
            percent:      totalMs > 0 ? Math.round((platMs / totalMs) * 100) : 0,
            children:     []
        };

        var subIds = (typeof getSubPlatformIds === 'function') ? getSubPlatformIds(platformId) : [];
        subIds.forEach(function(subId) {
            var subSessions = all.filter(s => s.site === subId);
            var subMs = subSessions.reduce((acc, s) => acc + s.duration, 0);
            if (subMs > 0) {
                entry.children.push({
                    id:           subId,
                    name:         (typeof getPlatformName === 'function') ? getPlatformName(subId) : subId,
                    icon:         (typeof getPlatformIcon === 'function') ? getPlatformIcon(subId) : '',
                    totalMs:      subMs,
                    sessionCount: subSessions.length,
                    avgMs:        subSessions.length > 0 ? subMs / subSessions.length : 0,
                    percent:      totalMs > 0 ? Math.round((subMs / totalMs) * 100) : 0
                });
            }
        });

        return entry;
    });

    return result;
}
