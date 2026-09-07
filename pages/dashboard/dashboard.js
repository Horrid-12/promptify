/**
 * dashboard.js
 * Grayscale Analytics Dashboard for AI Tracker Chromium and Gecko Extension.
 *
 * platforms.js, db.js, and analytics.js are loaded before this script.
 */

var _refreshTimer = null;
var currentPeriod = 'daily'; // 'daily', 'weekly', 'monthly'

var ICON_BASE_PATH = '../../assets/icons/';

// ─── Main Orchestrator ────────────────────────────────────────────────────────

async function renderDashboard() {
    try {
        var activeData = await new Promise(function(resolve) {
            chrome.storage.local.get(['activeSessionState'], resolve);
        });
        var activeSession = activeData.activeSessionState || null;

        var stats;
        if (currentPeriod === 'daily') {
            stats = await getDailyStats(0, activeSession);
            renderHeroCards(stats, 'Today');
            renderChart(stats.dailyBreakdown || [{ date: stats.date, ms: stats.totalMs }], 'DAILY USAGE');
        } else if (currentPeriod === 'weekly') {
            stats = await getWeeklyStats(0);
            if (activeSession) {
                var todayStr = getLocalDateString(Date.now());
                var activeMs = getActiveSessionElapsedMs(activeSession);
                stats.totalMs += activeMs;
                var activeSiteId = (typeof normalizeSiteId === 'function') ? normalizeSiteId(activeSession.site) : activeSession.site;
                if (stats.byPlatform[activeSiteId] !== undefined) {
                    stats.byPlatform[activeSiteId] += activeMs;
                }
                var todayBucket = stats.dailyBreakdown.find(function(d) { return d.date === todayStr; });
                if (todayBucket) todayBucket.ms += activeMs;
            }
            renderHeroCards(stats, 'This Week');
            renderChart(stats.dailyBreakdown, 'LAST 7 DAYS');
        } else if (currentPeriod === 'monthly') {
            stats = await getMonthlyStatsForMonth(0);
            if (activeSession) {
                var todayStr = getLocalDateString(Date.now());
                var activeMs = getActiveSessionElapsedMs(activeSession);
                stats.totalMs += activeMs;
                var activeSiteId = (typeof normalizeSiteId === 'function') ? normalizeSiteId(activeSession.site) : activeSession.site;
                if (stats.byPlatform[activeSiteId] !== undefined) {
                    stats.byPlatform[activeSiteId] += activeMs;
                }
                var todayBucket = stats.dailyBreakdown.find(function(d) { return d.date === todayStr; });
                if (todayBucket) todayBucket.ms += activeMs;
            }
            renderHeroCards(stats, stats.label);
            renderChart(stats.dailyBreakdown, 'DAILY USAGE - ' + stats.label);
        }

        renderPlatformBreakdown(stats.byPlatform, stats.totalMs);

    } catch (err) {
        console.error('[AI Tracker] Dashboard render failed:', err);
        showToast('Failed to load data.', 'error');
    }
}

// ─── Renderers ────────────────────────────────────────────────────────────────

function renderHeroCards(stats, periodLabel) {
    setText('card1-val', formatDuration(stats.totalMs));
    setText('card1-sub', periodLabel);

    setText('card2-val', String(stats.sessionCount));
    setText('card2-sub', 'sessions completed');

    setText('card3-val', stats.sessionCount > 0 ? formatDuration(stats.avgMs) : '\u2014');
    setText('card3-sub', 'per session');

    setText('card4-val', stats.topPlatform
        ? ((typeof getPlatformName === 'function') ? getPlatformName(stats.topPlatform) : stats.topPlatform)
        : '\u2014');

    var pct = 0;
    if (stats.topPlatform && stats.totalMs > 0) {
        pct = Math.round((stats.byPlatform[stats.topPlatform] / stats.totalMs) * 100);
    }
    setText('card4-sub', pct > 0 ? pct + '% of time' : '');
}

function renderPlatformBreakdown(byPlatform, totalMs) {
    var container = document.getElementById('platform-breakdown');
    container.innerHTML = '';

    // Get all platforms (top-level only for the main view)
    var topLevelIds = (typeof getTopLevelPlatformIds === 'function')
        ? getTopLevelPlatformIds()
        : SUPPORTED_PLATFORMS;

    // Build entries sorted by usage
    var entries = [];
    topLevelIds.forEach(function(platformId) {
        var ms = byPlatform[platformId] || 0;
        entries.push({
            id:   platformId,
            name: (typeof getPlatformName === 'function') ? getPlatformName(platformId) : platformId,
            icon: (typeof getPlatformIcon === 'function') ? getPlatformIcon(platformId) : '',
            ms:   ms
        });
    });

    entries.sort(function(a, b) { return b.ms - a.ms; });

    // Filter to only show platforms with usage
    var visible = entries.filter(function(e) { return e.ms > 0; });

    if (visible.length === 0) {
        container.innerHTML = '<div style="color:var(--text-secondary);font-family:IBM Plex Mono;">No platform usage</div>';
        return;
    }

    visible.forEach(function(entry) {
        var pct = Math.round((entry.ms / totalMs) * 100) || 0;
        var iconSrc = entry.icon ? (ICON_BASE_PATH + entry.icon) : '';
        var subIds = (typeof getSubPlatformIds === 'function') ? getSubPlatformIds(entry.id) : [];

        // Check if any sub-platforms have usage
        var hasSubUsage = false;
        var subEntries = [];
        subIds.forEach(function(subId) {
            var subMs = byPlatform[subId] || 0;
            if (subMs > 0) {
                hasSubUsage = true;
                subEntries.push({
                    id:   subId,
                    name: (typeof getPlatformName === 'function') ? getPlatformName(subId) : subId,
                    icon: (typeof getPlatformIcon === 'function') ? getPlatformIcon(subId) : '',
                    ms:   subMs,
                    pct:  Math.round((subMs / totalMs) * 100) || 0
                });
            }
        });

        var chevron = hasSubUsage
            ? '<span class="platform-chevron" data-target="sub-' + entry.id + '">\u25B6</span>'
            : '';

        var html = '<div class="platform-entry">'
            + '<div class="platform-row">'
            +   '<div class="platform-icon">'
            +     (iconSrc
                ? '<img src="' + iconSrc + '" alt="' + entry.name + '" style="width: 24px; height: 24px;">'
                : '<span class="platform-icon-lg">' + entry.name.charAt(0) + '</span>')
            +   '</div>'
            +   '<div class="platform-info">'
            +     '<div class="platform-meta">'
            +       '<span class="platform-name">' + entry.name + chevron + '</span>'
            +       '<div class="platform-stats">'
            +         '<span>' + formatDuration(entry.ms) + '</span>'
            +         '<span class="platform-pct">' + pct + '%</span>'
            +       '</div>'
            +     '</div>'
            +     '<div class="platform-bar-bg">'
            +       '<div class="platform-bar-fill" style="width: ' + pct + '%;"></div>'
            +     '</div>'
            +   '</div>'
            + '</div>';

        // Sub-platform entries (hidden by default)
        if (hasSubUsage) {
            html += '<div class="platform-sub-list" id="sub-' + entry.id + '" style="display:none;">';
            subEntries.forEach(function(sub) {
                var subIconSrc = sub.icon ? (ICON_BASE_PATH + sub.icon) : '';
                html += '<div class="platform-row platform-row-sub">'
                    + '<div class="platform-icon">'
                    +   (subIconSrc
                        ? '<img src="' + subIconSrc + '" alt="' + sub.name + '" style="width: 18px; height: 18px;">'
                        : '<span class="platform-icon-md">' + sub.name.charAt(0) + '</span>')
                    + '</div>'
                    + '<div class="platform-info">'
                    +   '<div class="platform-meta">'
                    +     '<span class="platform-name">' + sub.name + '</span>'
                    +     '<div class="platform-stats">'
                    +       '<span>' + formatDuration(sub.ms) + '</span>'
                    +       '<span class="platform-pct">' + sub.pct + '%</span>'
                    +     '</div>'
                    +   '</div>'
                    +   '<div class="platform-bar-bg">'
                    +     '<div class="platform-bar-fill" style="width: ' + sub.pct + '%;"></div>'
                    +   '</div>'
                    + '</div>'
                    + '</div>';
            });
            html += '</div>';
        }

        container.insertAdjacentHTML('beforeend', html);
    });

    // Attach chevron click handlers
    container.querySelectorAll('.platform-chevron').forEach(function(chevron) {
        chevron.addEventListener('click', function(e) {
            e.stopPropagation();
            var targetId = chevron.getAttribute('data-target');
            var subList = document.getElementById(targetId);
            if (subList) {
                var isVisible = subList.style.display !== 'none';
                subList.style.display = isVisible ? 'none' : 'block';
                chevron.textContent = isVisible ? '\u25B6' : '\u25BC';
            }
        });
    });
}

function renderChart(data, title) {
    setText('chart-title', title);
    var container = document.getElementById('main-chart');
    container.innerHTML = '';

    if (!data || data.length === 0) return;

    var maxMs = Math.max.apply(null, data.map(function(d) { return d.ms; }).concat([1]));
    var BARS = data.length;
    var BAR_W = BARS > 7 ? 14 : 36;
    var GAP = BARS > 7 ? 6 : 24;
    var CHART_H = 180;
    var LABEL_H = 24;
    var TOTAL_W = BARS * (BAR_W + GAP) - GAP;
    var TOTAL_H = CHART_H + LABEL_H + 20;

    var NS = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 ' + TOTAL_W + ' ' + TOTAL_H);
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');

    data.forEach(function(d, i) {
        var x = i * (BAR_W + GAP);
        var targetH = maxMs > 0 ? (d.ms / maxMs) * CHART_H : 0;
        var barY = CHART_H + 10;

        // Base bar background
        var bg = document.createElementNS(NS, 'rect');
        bg.setAttribute('x', x);
        bg.setAttribute('y', 10);
        bg.setAttribute('width', BAR_W);
        bg.setAttribute('height', CHART_H);
        bg.setAttribute('fill', 'var(--background)');
        svg.appendChild(bg);

        // Value bar
        if (targetH > 0) {
            var rect = document.createElementNS(NS, 'rect');
            rect.setAttribute('x', x);
            rect.setAttribute('y', barY - targetH);
            rect.setAttribute('width', BAR_W);
            rect.setAttribute('height', targetH);
            rect.setAttribute('fill', 'var(--text-primary)');
            svg.appendChild(rect);
        }

        // Bottom border line for the axis
        var axis = document.createElementNS(NS, 'line');
        axis.setAttribute('x1', 0);
        axis.setAttribute('y1', barY);
        axis.setAttribute('x2', TOTAL_W);
        axis.setAttribute('y2', barY);
        axis.setAttribute('stroke', 'var(--border-color)');
        axis.setAttribute('stroke-width', '2');
        svg.appendChild(axis);

        // Label
        if (BARS <= 7 || i % Math.ceil(BARS / 7) === 0) {
            var lbl = document.createElementNS(NS, 'text');
            lbl.setAttribute('x', x + BAR_W / 2);
            lbl.setAttribute('y', TOTAL_H - 2);
            lbl.setAttribute('text-anchor', 'middle');
            lbl.setAttribute('font-family', 'IBM Plex Mono, monospace');
            lbl.setAttribute('font-size', '10');
            lbl.setAttribute('font-weight', '600');
            lbl.setAttribute('fill', 'var(--text-secondary)');

            if (BARS <= 7) {
                lbl.textContent = new Date(d.date + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short' });
            } else {
                lbl.textContent = new Date(d.date + 'T12:00:00').getDate();
            }
            svg.appendChild(lbl);
        }
    });

    container.appendChild(svg);
}

// ─── Theme Management ─────────────────────────────────────────────────────────

function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    var toggleBtn = document.getElementById('theme-toggle');
    if (toggleBtn) {
        toggleBtn.textContent = theme === 'dark' ? '\u263E' : '\u263C';
    }
}

function getSystemTheme() {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function initTheme() {
    chrome.storage.local.get(['theme'], function(data) {
        var theme = data.theme || getSystemTheme();
        applyTheme(theme);
    });

    var toggleBtn = document.getElementById('theme-toggle');
    if (toggleBtn) {
        toggleBtn.addEventListener('click', function() {
            var current = document.documentElement.getAttribute('data-theme') || 'light';
            var next = current === 'dark' ? 'light' : 'dark';
            applyTheme(next);
            chrome.storage.local.set({ theme: next });
        });
    }

    // Follow OS changes if user hasn't explicitly set a preference
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function(e) {
        chrome.storage.local.get(['theme'], function(data) {
            if (!data.theme) {
                applyTheme(e.matches ? 'dark' : 'light');
            }
        });
    });
}

// ─── Setup ────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async function() {
    // Initialise theme first to avoid flash
    initTheme();

    try {
        await initDatabase();
    } catch (err) {
        console.error('[AI Tracker] DB init failed:', err);
    }

    // Tabs
    document.querySelectorAll('.period-tab').forEach(function(btn) {
        btn.addEventListener('click', function(e) {
            document.querySelectorAll('.period-tab').forEach(function(b) { b.classList.remove('active'); });
            e.target.classList.add('active');
            currentPeriod = e.target.dataset.period;
            renderDashboard();
        });
    });

    await renderDashboard();
    _refreshTimer = setInterval(renderDashboard, 30000);

    var exportBtn = document.getElementById('btn-export');
    if (exportBtn) exportBtn.addEventListener('click', handleExport);
    var exportMdBtn = document.getElementById('btn-export-md');
    if (exportMdBtn) exportMdBtn.addEventListener('click', handleExportMarkdown);
    var deleteBtn = document.getElementById('btn-delete');
    if (deleteBtn) deleteBtn.addEventListener('click', handleDeleteAll);
});

async function handleExport() {
    try {
        var sessions = await getAllSessions();

        // Sort sessions chronologically
        sessions.sort(function(a, b) { return a.startTime - b.startTime; });

        // ── Build summary ─────────────────────────────────────────────
        var totalMs = 0;
        var platformTotals = {};
        var dailyTotals = {};

        sessions.forEach(function(s) {
            totalMs += s.duration;

            // Platform aggregation
            var name = (typeof getPlatformName === 'function') ? getPlatformName(s.site) : s.site;
            if (!platformTotals[name]) {
                platformTotals[name] = { sessions: 0, totalMs: 0 };
            }
            platformTotals[name].sessions += 1;
            platformTotals[name].totalMs += s.duration;

            // Daily aggregation
            var dateKey = s.date || getLocalDateString(s.startTime);
            if (!dailyTotals[dateKey]) {
                dailyTotals[dateKey] = { sessions: 0, totalMs: 0 };
            }
            dailyTotals[dateKey].sessions += 1;
            dailyTotals[dateKey].totalMs += s.duration;
        });

        // Format platform breakdown
        var platformBreakdown = {};
        Object.keys(platformTotals).sort(function(a, b) {
            return platformTotals[b].totalMs - platformTotals[a].totalMs;
        }).forEach(function(name) {
            var p = platformTotals[name];
            var pct = totalMs > 0 ? Math.round((p.totalMs / totalMs) * 100) : 0;
            platformBreakdown[name] = {
                totalTime: formatDuration(p.totalMs),
                sessions: p.sessions,
                percentage: pct + '%'
            };
        });

        // Format daily breakdown (sorted by date)
        var dailyBreakdown = {};
        Object.keys(dailyTotals).sort().forEach(function(date) {
            var d = dailyTotals[date];
            // Add day-of-week label
            var dayName = new Date(date + 'T12:00:00').toLocaleDateString(undefined, {
                weekday: 'long', month: 'short', day: 'numeric', year: 'numeric'
            });
            dailyBreakdown[date] = {
                day: dayName,
                totalTime: formatDuration(d.totalMs),
                sessions: d.sessions
            };
        });

        // ── Build readable sessions grouped by date ───────────────────
        var sessionsByDate = {};
        sessions.forEach(function(s) {
            var dateKey = s.date || getLocalDateString(s.startTime);
            if (!sessionsByDate[dateKey]) {
                sessionsByDate[dateKey] = [];
            }

            var startDate = new Date(s.startTime);
            var endDate = new Date(s.endTime);

            sessionsByDate[dateKey].push({
                platform: (typeof getPlatformName === 'function') ? getPlatformName(s.site) : s.site,
                startTime: startDate.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
                endTime: endDate.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
                duration: formatDuration(s.duration),
                durationSeconds: Math.round(s.duration / 1000)
            });
        });

        // ── Find date range ───────────────────────────────────────────
        var firstDate = sessions.length > 0 ? (sessions[0].date || getLocalDateString(sessions[0].startTime)) : 'N/A';
        var lastDate = sessions.length > 0 ? (sessions[sessions.length - 1].date || getLocalDateString(sessions[sessions.length - 1].startTime)) : 'N/A';

        // ── Assemble final payload ────────────────────────────────────
        var payload = {
            _exportInfo: {
                appName: 'Promptify',
                version: 2,
                exportedAt: new Date().toISOString(),
                exportedAtReadable: new Date().toLocaleString(),
                description: 'AI usage data exported from Promptify browser extension'
            },
            summary: {
                dateRange: firstDate + ' to ' + lastDate,
                totalTime: formatDuration(totalMs),
                totalSessions: sessions.length,
                platformBreakdown: platformBreakdown,
                dailyBreakdown: dailyBreakdown
            },
            sessionsByDate: sessionsByDate,
            _rawSessions: sessions
        };

        var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        var url  = URL.createObjectURL(blob);
        var a    = document.createElement('a');
        a.href     = url;
        a.download = 'promptify-export-' + getLocalDateString(Date.now()) + '.json';
        a.click();
        URL.revokeObjectURL(url);
        showToast('Export successful');
    } catch (e) { /* ignore */ }
}

async function handleExportMarkdown() {
    try {
        var sessions = await getAllSessions();
        sessions.sort(function(a, b) { return a.startTime - b.startTime; });

        if (sessions.length === 0) {
            showToast('No data to export');
            return;
        }

        // ── Aggregate data ────────────────────────────────────────────
        var totalMs = 0;
        var platformTotals = {};
        var dailyTotals = {};
        var sessionsByDate = {};

        sessions.forEach(function(s) {
            totalMs += s.duration;
            var name = (typeof getPlatformName === 'function') ? getPlatformName(s.site) : s.site;
            var dateKey = s.date || getLocalDateString(s.startTime);

            // Platform totals
            if (!platformTotals[name]) platformTotals[name] = { sessions: 0, totalMs: 0 };
            platformTotals[name].sessions += 1;
            platformTotals[name].totalMs += s.duration;

            // Daily totals
            if (!dailyTotals[dateKey]) dailyTotals[dateKey] = { sessions: 0, totalMs: 0 };
            dailyTotals[dateKey].sessions += 1;
            dailyTotals[dateKey].totalMs += s.duration;

            // Sessions grouped by date
            if (!sessionsByDate[dateKey]) sessionsByDate[dateKey] = [];
            sessionsByDate[dateKey].push({
                platform: name,
                start: new Date(s.startTime).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
                end: new Date(s.endTime).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
                duration: formatDuration(s.duration)
            });
        });

        var firstDate = sessions[0].date || getLocalDateString(sessions[0].startTime);
        var lastDate = sessions[sessions.length - 1].date || getLocalDateString(sessions[sessions.length - 1].startTime);

        // ── Build Markdown ────────────────────────────────────────────
        var md = '';
        md += '# Promptify — Usage Report\n\n';
        md += '> Exported on ' + new Date().toLocaleString() + '\n\n';

        // Overview
        md += '## Overview\n\n';
        md += '| Metric | Value |\n';
        md += '|--------|-------|\n';
        md += '| Date Range | ' + firstDate + ' → ' + lastDate + ' |\n';
        md += '| Total AI Time | **' + formatDuration(totalMs) + '** |\n';
        md += '| Total Sessions | ' + sessions.length + ' |\n';
        md += '| Avg. Session | ' + formatDuration(sessions.length > 0 ? totalMs / sessions.length : 0) + ' |\n\n';

        // Platform Breakdown
        md += '## Platform Breakdown\n\n';
        md += '| Platform | Time | Sessions | Share |\n';
        md += '|----------|------|----------|-------|\n';

        var sortedPlatforms = Object.keys(platformTotals).sort(function(a, b) {
            return platformTotals[b].totalMs - platformTotals[a].totalMs;
        });

        sortedPlatforms.forEach(function(name) {
            var p = platformTotals[name];
            var pct = totalMs > 0 ? Math.round((p.totalMs / totalMs) * 100) : 0;
            md += '| ' + name + ' | ' + formatDuration(p.totalMs) + ' | ' + p.sessions + ' | ' + pct + '% |\n';
        });
        md += '\n';

        // Daily Breakdown
        md += '## Daily Breakdown\n\n';
        md += '| Date | Day | Time | Sessions |\n';
        md += '|------|-----|------|----------|\n';

        Object.keys(dailyTotals).sort().forEach(function(date) {
            var d = dailyTotals[date];
            var dayName = new Date(date + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short' });
            md += '| ' + date + ' | ' + dayName + ' | ' + formatDuration(d.totalMs) + ' | ' + d.sessions + ' |\n';
        });
        md += '\n';

        // Detailed Sessions
        md += '---\n\n';
        md += '## Session Details\n\n';

        Object.keys(sessionsByDate).sort().forEach(function(date) {
            var dayLabel = new Date(date + 'T12:00:00').toLocaleDateString(undefined, {
                weekday: 'long', month: 'short', day: 'numeric', year: 'numeric'
            });
            var dayMs = dailyTotals[date].totalMs;

            md += '### ' + dayLabel + '  (' + formatDuration(dayMs) + ')\n\n';
            md += '| # | Platform | Start | End | Duration |\n';
            md += '|---|----------|-------|-----|----------|\n';

            sessionsByDate[date].forEach(function(s, i) {
                md += '| ' + (i + 1) + ' | ' + s.platform + ' | ' + s.start + ' | ' + s.end + ' | ' + s.duration + ' |\n';
            });
            md += '\n';
        });

        // Footer
        md += '---\n\n';
        md += '*Generated by [Promptify](https://github.com/user/promptify) — Your AI usage, quantified.*\n';

        // ── Download ──────────────────────────────────────────────────
        var blob = new Blob([md], { type: 'text/markdown' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = 'promptify-report-' + getLocalDateString(Date.now()) + '.md';
        a.click();
        URL.revokeObjectURL(url);
        showToast('Markdown export successful');
    } catch (e) { /* ignore */ }
}

async function handleDeleteAll() {
    if (!confirm('Delete ALL recorded sessions?')) return;
    try {
        await deleteAllSessions();
        showToast('All sessions deleted');
        await renderDashboard();
    } catch (e) { /* ignore */ }
}

function showToast(message, type) {
    var t = document.getElementById('toast');
    t.textContent = message;
    t.className = 'toast ' + (type || '');
    setTimeout(function() { t.classList.add('hidden'); }, 3000);
}

function setText(id, val) {
    var el = document.getElementById(id);
    if (el) el.textContent = val;
}
