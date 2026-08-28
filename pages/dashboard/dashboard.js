/**
 * dashboard.js
 * Grayscale Neo-Brutalist Analytics dashboard for AI Time Tracker.
 */

let _refreshTimer = null;
let currentPeriod = 'daily'; // 'daily', 'weekly', 'monthly'

const PLATFORM_ICONS = {
    'ChatGPT':    '../../assets/icons/icons8-chatgpt-50.png',
    'Claude':     '../../assets/icons/icons8-claude-ai-50.png',
    'Gemini':     '../../assets/icons/icons8-gemini-ai-50.png',
    'Perplexity': '../../assets/icons/icons8-perplexity-ai-50.png'
};

// ─── Main Orchestrator ────────────────────────────────────────────────────────

async function renderDashboard() {
    try {
        const activeData = await new Promise(resolve => chrome.storage.local.get(['activeSessionState'], resolve));
        const activeSession = activeData.activeSessionState || null;
        
        let stats;
        if (currentPeriod === 'daily') {
            stats = await getDailyStats(0, activeSession);
            renderHeroCards(stats, 'Today');
            renderChart(stats.dailyBreakdown || [{ date: stats.date, ms: stats.totalMs }], 'DAILY USAGE'); 
        } else if (currentPeriod === 'weekly') {
            stats = await getWeeklyStats(0);
            if (activeSession) {
                const todayStr = getLocalDateString(Date.now());
                const activeMs = getActiveSessionElapsedMs(activeSession);
                stats.totalMs += activeMs;
                if (stats.byPlatform[activeSession.site] !== undefined) {
                    stats.byPlatform[activeSession.site] += activeMs;
                }
                const todayBucket = stats.dailyBreakdown.find(d => d.date === todayStr);
                if (todayBucket) todayBucket.ms += activeMs;
            }
            renderHeroCards(stats, 'This Week');
            renderChart(stats.dailyBreakdown, 'LAST 7 DAYS');
        } else if (currentPeriod === 'monthly') {
            stats = await getMonthlyStatsForMonth(0);
            if (activeSession) {
                const todayStr = getLocalDateString(Date.now());
                const activeMs = getActiveSessionElapsedMs(activeSession);
                stats.totalMs += activeMs;
                if (stats.byPlatform[activeSession.site] !== undefined) {
                    stats.byPlatform[activeSession.site] += activeMs;
                }
                const todayBucket = stats.dailyBreakdown.find(d => d.date === todayStr);
                if (todayBucket) todayBucket.ms += activeMs;
            }
            renderHeroCards(stats, stats.label);
            renderChart(stats.dailyBreakdown, `DAILY USAGE - ${stats.label}`);
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

    setText('card3-val', stats.sessionCount > 0 ? formatDuration(stats.avgMs) : '—');
    setText('card3-sub', 'per session');

    setText('card4-val', stats.topPlatform || '—');
    
    let pct = 0;
    if (stats.topPlatform && stats.totalMs > 0) {
        pct = Math.round((stats.byPlatform[stats.topPlatform] / stats.totalMs) * 100);
    }
    setText('card4-sub', pct > 0 ? `${pct}% of time` : '');
}

function renderPlatformBreakdown(byPlatform, totalMs) {
    const container = document.getElementById('platform-breakdown');
    container.innerHTML = '';
    
    const sorted = Object.entries(byPlatform)
        .filter(([_, ms]) => ms > 0)
        .sort((a, b) => b[1] - a[1]);

    if (sorted.length === 0) {
        container.innerHTML = '<div style="color:var(--text-secondary);font-family:IBM Plex Mono;">No platform usage</div>';
        return;
    }

    sorted.forEach(([platform, ms]) => {
        const pct = Math.round((ms / totalMs) * 100) || 0;
        const iconId = PLATFORM_ICONS[platform] || '';
        
        const html = `
            <div class="platform-row">
                <div class="platform-icon">
                    <img src="${iconId}" alt="${platform}" style="width: 24px; height: 24px;">
                </div>
                <div class="platform-info">
                    <div class="platform-meta">
                        <span class="platform-name">${platform}</span>
                        <div class="platform-stats">
                            <span>${formatDuration(ms)}</span>
                            <span class="platform-pct">${pct}%</span>
                        </div>
                    </div>
                    <div class="platform-bar-bg">
                        <div class="platform-bar-fill" style="width: ${pct}%;"></div>
                    </div>
                </div>
            </div>
        `;
        container.insertAdjacentHTML('beforeend', html);
    });
}

function renderChart(data, title) {
    setText('chart-title', title);
    const container = document.getElementById('main-chart');
    container.innerHTML = '';

    if (!data || data.length === 0) return;

    const maxMs = Math.max(...data.map(d => d.ms), 1);
    const BARS = data.length;
    const BAR_W = BARS > 7 ? 14 : 36;
    const GAP = BARS > 7 ? 6 : 24;
    const CHART_H = 180;
    const LABEL_H = 24;
    const TOTAL_W = BARS * (BAR_W + GAP) - GAP;
    const TOTAL_H = CHART_H + LABEL_H + 20;

    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${TOTAL_W} ${TOTAL_H}`);
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');

    data.forEach((d, i) => {
        const x = i * (BAR_W + GAP);
        const targetH = maxMs > 0 ? (d.ms / maxMs) * CHART_H : 0;
        const barY = CHART_H + 10;

        // Base bar background
        const bg = document.createElementNS(NS, 'rect');
        bg.setAttribute('x', x);
        bg.setAttribute('y', 10);
        bg.setAttribute('width', BAR_W);
        bg.setAttribute('height', CHART_H);
        bg.setAttribute('fill', 'var(--background)');
        svg.appendChild(bg);

        // Value bar
        if (targetH > 0) {
            const rect = document.createElementNS(NS, 'rect');
            rect.setAttribute('x', x);
            rect.setAttribute('y', barY - targetH);
            rect.setAttribute('width', BAR_W);
            rect.setAttribute('height', targetH);
            rect.setAttribute('fill', 'var(--text-primary)');
            svg.appendChild(rect);
        }

        // Bottom border line for the axis
        const axis = document.createElementNS(NS, 'line');
        axis.setAttribute('x1', 0);
        axis.setAttribute('y1', barY);
        axis.setAttribute('x2', TOTAL_W);
        axis.setAttribute('y2', barY);
        axis.setAttribute('stroke', 'var(--border-color)');
        axis.setAttribute('stroke-width', '2');
        svg.appendChild(axis);

        // Label
        if (BARS <= 7 || i % Math.ceil(BARS/7) === 0) {
            const lbl = document.createElementNS(NS, 'text');
            lbl.setAttribute('x', x + BAR_W/2);
            lbl.setAttribute('y', TOTAL_H - 2);
            lbl.setAttribute('text-anchor', 'middle');
            lbl.setAttribute('font-family', 'IBM Plex Mono, monospace');
            lbl.setAttribute('font-size', '10');
            lbl.setAttribute('font-weight', '600');
            lbl.setAttribute('fill', 'var(--text-secondary)');
            
            if (BARS <= 7) {
                lbl.textContent = new Date(d.date + 'T12:00:00').toLocaleDateString(undefined, {weekday:'short'});
            } else {
                lbl.textContent = new Date(d.date + 'T12:00:00').getDate();
            }
            svg.appendChild(lbl);
        }
    });

    container.appendChild(svg);
}

// ─── Setup ────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
    try {
        await initDatabase();
    } catch (err) {
        console.error('[AI Tracker] DB init failed:', err);
    }

    // Tabs
    document.querySelectorAll('.period-tab').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.period-tab').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            currentPeriod = e.target.dataset.period;
            renderDashboard();
        });
    });

    await renderDashboard();
    _refreshTimer = setInterval(renderDashboard, 30000);

    document.getElementById('btn-export')?.addEventListener('click', handleExport);
    document.getElementById('btn-delete')?.addEventListener('click', handleDeleteAll);
});

async function handleExport() {
    try {
        const sessions = await getAllSessions();
        const payload  = { version: 1, exportedAt: new Date().toISOString(), sessions };
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href     = url;
        a.download = `ai-tracker-export-${getLocalDateString(Date.now())}.json`;
        a.click();
        URL.revokeObjectURL(url);
        showToast('Export successful');
    } catch(e) {}
}

async function handleDeleteAll() {
    if(!confirm('Delete ALL recorded sessions?')) return;
    try {
        await deleteAllSessions();
        showToast('All sessions deleted');
        await renderDashboard();
    } catch(e) {}
}

function showToast(message, type='') {
    const t = document.getElementById('toast');
    t.textContent = message;
    t.className = `toast ${type}`;
    setTimeout(() => t.classList.add('hidden'), 3000);
}

function setText(id, val) {
    const el = document.getElementById(id);
    if(el) el.textContent = val;
}
