/**
 * popup.js
 * AI Time Tracker popup controller.
 *
 * Reads session data from IndexedDB via the shared analytics.js layer.
 * db.js and analytics.js are loaded before this script in popup.html.
 */

// Must match analytics.js and background.js
const INACTIVITY_TIMEOUT_MS_POPUP = 300000; // 5 minutes

// ─── Header Status ────────────────────────────────────────────────────────────

function updateHeaderStatus(active, isInactive) {
    const statusTextEl = document.getElementById('tracker-status-text');
    const indicatorEl  = document.querySelector('.pulse-indicator');
    if (!indicatorEl || !statusTextEl) return;

    indicatorEl.className = 'pulse-indicator';

    if (active && !isInactive) {
        statusTextEl.textContent = 'Tracking';
        statusTextEl.style.color = '#10b981';
        indicatorEl.classList.add('pulse-active');
    } else if (active && isInactive) {
        statusTextEl.textContent = 'Inactive';
        statusTextEl.style.color = '#f59e0b';
        indicatorEl.classList.add('pulse-idle');
    } else {
        statusTextEl.textContent = 'Idle';
        statusTextEl.style.color = '#94a3b8';
    }
}

// ─── Stats Renderer ───────────────────────────────────────────────────────────

async function updatePopupStats() {
    try {
        // activeSessionState lives in chrome.storage.local (transient in-progress session)
        const data = await new Promise(resolve =>
            chrome.storage.local.get(['activeSessionState'], resolve)
        );
        const active = data.activeSessionState || null;
        const isInactive = active &&
            (Date.now() - active.lastActivity >= INACTIVITY_TIMEOUT_MS_POPUP);

        updateHeaderStatus(active, isInactive);

        // Pull today's stats from IndexedDB via analytics.js
        const stats = await getTodayStats(active);
        const { totalMs, sessionCount, avgMs, byPlatform } = stats;

        // Hero number
        document.getElementById('total-time-today').textContent = formatDuration(totalMs);

        // Platform rows
        SUPPORTED_PLATFORMS.forEach(platform => {
            const platformMs = byPlatform[platform] || 0;
            const key        = platform.toLowerCase();
            const timeEl     = document.getElementById(`time-${key}`);
            const barEl      = document.getElementById(`bar-${key}`);
            if (timeEl) timeEl.textContent = formatDuration(platformMs);
            if (barEl)  barEl.style.width  = totalMs > 0
                ? `${(platformMs / totalMs) * 100}%`
                : '0%';
        });

        // Summary cards
        document.getElementById('sessions-count-val').textContent = sessionCount;
        document.getElementById('avg-duration-val').textContent   =
            avgMs > 0 ? formatDuration(avgMs) : '—';

    } catch (err) {
        console.error('[AI Tracker] Popup update failed:', err);
    }
}

// ─── Initialise ───────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
    // Open/verify IndexedDB connection, then start polling.
    initDatabase()
        .then(() => {
            updatePopupStats();
            // Refresh every second for the live timer effect.
            setInterval(updatePopupStats, 1000);
        })
        .catch(err => {
            console.error('[AI Tracker] DB init failed in popup:', err);
            // Try rendering anyway — DB may already be open from a previous call.
            updatePopupStats();
            setInterval(updatePopupStats, 1000);
        });

    // Open the full analytics dashboard in a new tab.
    document.getElementById('open-dashboard-btn')?.addEventListener('click', () => {
        chrome.tabs.create({ url: chrome.runtime.getURL('pages/dashboard/dashboard.html') });
        window.close(); // Close the popup after opening the tab.
    });
});
