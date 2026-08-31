/**
 * popup.js
 * AI Time Tracker popup controller.
 *
 * Reads session data from IndexedDB via the shared analytics.js layer.
 * platforms.js, db.js and analytics.js are loaded before this script in popup.html.
 */

// Must match analytics.js and background.js
var INACTIVITY_TIMEOUT_MS_POPUP = 300000; // 5 minutes

var ICON_BASE_PATH = '../../assets/icons/';

// ─── Header Status ────────────────────────────────────────────────────────────

function updateHeaderStatus(active, isInactive) {
    var statusTextEl = document.getElementById('tracker-status-text');
    var indicatorEl  = document.querySelector('.pulse-indicator');
    if (!indicatorEl || !statusTextEl) return;

    indicatorEl.className = 'pulse-indicator';

    if (active && !isInactive) {
        statusTextEl.textContent = 'Tracking';
        indicatorEl.classList.add('pulse-active');
    } else if (active && isInactive) {
        statusTextEl.textContent = 'Inactive';
        indicatorEl.classList.add('pulse-idle');
    } else {
        statusTextEl.textContent = 'Idle';
    }
}

// ─── Platform Row Builder ─────────────────────────────────────────────────────

function buildPlatformRows(container, byPlatform, totalMs, activeSession) {
    // Build sortable list of platforms with usage data
    var platformData = [];
    var platformIds = (typeof getAllPlatformIds === 'function') ? getAllPlatformIds() : SUPPORTED_PLATFORMS;

    platformIds.forEach(function(platformId) {
        var ms = byPlatform[platformId] || 0;
        var siteId = (typeof normalizeSiteId === 'function') ? normalizeSiteId(activeSession && activeSession.site) : (activeSession && activeSession.site);
        var isActive = activeSession && (siteId === platformId);
        platformData.push({
            id:      platformId,
            name:    (typeof getPlatformName === 'function') ? getPlatformName(platformId) : platformId,
            icon:    (typeof getPlatformIcon === 'function') ? getPlatformIcon(platformId) : '',
            ms:      ms,
            active:  isActive
        });
    });

    // Sort: active platform first, then by usage descending
    platformData.sort(function(a, b) {
        if (a.active && !b.active) return -1;
        if (!a.active && b.active) return 1;
        return b.ms - a.ms;
    });

    // Only show platforms that have usage or are currently active
    var visible = platformData.filter(function(p) { return p.ms > 0 || p.active; });

    // If nothing to show, display a placeholder
    if (visible.length === 0) {
        container.innerHTML = '<div class="platform-empty">No usage yet today</div>';
        return;
    }

    var html = '';
    visible.forEach(function(p) {
        var pct = totalMs > 0 ? (p.ms / totalMs) * 100 : 0;
        var activeClass = p.active ? ' platform-row-active' : '';
        var iconSrc = p.icon ? (ICON_BASE_PATH + p.icon) : '';

        html += '<div class="platform-row' + activeClass + '">'
            + '<div class="platform-meta">'
            +   '<span class="platform-info-left">'
            +     (iconSrc
                ? '<img class="platform-icon-img" src="' + iconSrc + '" alt="' + p.name + '">'
                : '<span class="platform-icon-text">' + p.name.charAt(0) + '</span>')
            +     '<span class="platform-name">' + p.name + '</span>'
            +   '</span>'
            +   '<span class="platform-time">' + formatDuration(p.ms) + '</span>'
            + '</div>'
            + '<div class="progress-bar-bg">'
            +   '<div class="progress-bar-fill" style="width: ' + pct + '%;"></div>'
            + '</div>'
            + '</div>';
    });

    container.innerHTML = html;
}

// ─── Stats Renderer ───────────────────────────────────────────────────────────

async function updatePopupStats() {
    try {
        // activeSessionState lives in chrome.storage.local (transient in-progress session)
        var data = await new Promise(function(resolve) {
            chrome.storage.local.get(['activeSessionState'], resolve);
        });
        var active = data.activeSessionState || null;
        var isInactive = active &&
            (Date.now() - active.lastActivity >= INACTIVITY_TIMEOUT_MS_POPUP);

        updateHeaderStatus(active, isInactive);

        // Pull today's stats from IndexedDB via analytics.js
        var stats = await getTodayStats(active);
        var totalMs = stats.totalMs;
        var sessionCount = stats.sessionCount;
        var avgMs = stats.avgMs;
        var byPlatform = stats.byPlatform;

        // Hero number
        document.getElementById('total-time-today').textContent = formatDuration(totalMs);

        // Platform rows (dynamically built, sorted by usage)
        var container = document.getElementById('platforms-container');
        buildPlatformRows(container, byPlatform, totalMs, active);

        // Summary cards
        document.getElementById('sessions-count-val').textContent = sessionCount;
        document.getElementById('avg-duration-val').textContent =
            avgMs > 0 ? formatDuration(avgMs) : '\u2014';

    } catch (err) {
        console.error('[AI Tracker] Popup update failed:', err);
    }
}

// ─── Initialise ───────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', function() {
    // Open/verify IndexedDB connection, then start polling.
    initDatabase()
        .then(function() {
            updatePopupStats();
            // Refresh every second for the live timer effect.
            setInterval(updatePopupStats, 1000);
        })
        .catch(function(err) {
            console.error('[AI Tracker] DB init failed in popup:', err);
            // Try rendering anyway — DB may already be open from a previous call.
            updatePopupStats();
            setInterval(updatePopupStats, 1000);
        });

    // Open the full analytics dashboard in a new tab.
    var dashBtn = document.getElementById('open-dashboard-btn');
    if (dashBtn) {
        dashBtn.addEventListener('click', function() {
            chrome.tabs.create({ url: chrome.runtime.getURL('pages/dashboard/dashboard.html') });
            window.close();
        });
    }
});
