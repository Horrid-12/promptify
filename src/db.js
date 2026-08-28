/**
 * db.js
 * Centralised IndexedDB data-access layer for AI Time Tracker.
 *
 * Compatible with both:
 *   - importScripts('db.js') inside the Manifest V3 service worker
 *   - <script src="db.js"> in popup.html / dashboard.html
 *
 * All public functions return Promises.
 * Errors are logged as [AI Tracker][DB] and re-thrown.
 */

const DB_NAME = 'AI_TIME_TRACKER';
const DB_VERSION = 1;
const STORE_SESSIONS = 'sessions';

// Cached open connection — reset to null if the DB closes unexpectedly.
let _db = null;

// ─── Core Connection ──────────────────────────────────────────────────────────

/**
 * Opens (or re-opens) the IndexedDB database.
 * Creates the object store and indexes on first run.
 * @returns {Promise<IDBDatabase>}
 */
function initDatabase() {
    return new Promise((resolve, reject) => {
        if (_db) { resolve(_db); return; }

        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = (event) => {
            const db = event.target.result;

            if (!db.objectStoreNames.contains(STORE_SESSIONS)) {
                const store = db.createObjectStore(STORE_SESSIONS, { keyPath: 'id' });

                // Index for per-platform queries
                store.createIndex('by_site', 'site', { unique: false });

                // Index for date-range queries (timestamp ms)
                store.createIndex('by_startTime', 'startTime', { unique: false });

                // Index for exact-day queries (YYYY-MM-DD string)
                store.createIndex('by_date', 'date', { unique: false });

                console.log('[AI Tracker][DB] Object store created with indexes.');
            }
        };

        request.onsuccess = (event) => {
            _db = event.target.result;

            // Reset cached connection if the database closes unexpectedly.
            _db.onclose = () => {
                console.warn('[AI Tracker][DB] Database connection closed unexpectedly. Will reopen on next access.');
                _db = null;
            };
            _db.onerror = (event) => {
                console.error('[AI Tracker][DB] Database error:', event.target.error);
            };

            console.log('[AI Tracker][DB] Database initialized.');
            resolve(_db);
        };

        request.onerror = (event) => {
            console.error('[AI Tracker][DB] Failed to open database:', event.target.error);
            reject(event.target.error);
        };

        request.onblocked = () => {
            console.warn('[AI Tracker][DB] Database upgrade blocked by another open tab. Close all AI Tracker pages and try again.');
        };
    });
}

/**
 * Returns the open DB connection, opening it first if needed.
 * @returns {Promise<IDBDatabase>}
 */
function getDb() {
    if (_db) return Promise.resolve(_db);
    return initDatabase();
}

// ─── Write Operations ─────────────────────────────────────────────────────────

/**
 * Inserts a session record.
 * Silently ignores duplicate IDs (idempotent — safe to retry).
 *
 * @param {Object} session - Must include: id, site, domain, startTime, endTime, duration, date, createdAt
 * @returns {Promise<boolean>} true if inserted, false if duplicate
 */
function addSession(session) {
    return getDb().then(db => new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_SESSIONS, 'readwrite');
        const store = tx.objectStore(STORE_SESSIONS);
        const request = store.add(session);

        request.onsuccess = () => {
            console.log(`[AI Tracker][DB] Session stored: ${session.site} (${Math.round(session.duration / 1000)}s)`);
            resolve(true);
        };

        request.onerror = (event) => {
            if (event.target.error && event.target.error.name === 'ConstraintError') {
                // Primary key conflict — duplicate session, not an error condition.
                console.log(`[AI Tracker][DB] Duplicate session ignored: ${session.id}`);
                event.preventDefault();
                // Abort cleanly so the transaction doesn't propagate an error.
                tx.abort();
                resolve(false);
            } else {
                console.error('[AI Tracker][DB] Failed to store session:', event.target.error);
                reject(event.target.error);
            }
        };
    }));
}

/**
 * Deletes a single session by UUID.
 * @returns {Promise<boolean>}
 */
function deleteSession(id) {
    return getDb().then(db => new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_SESSIONS, 'readwrite');
        const request = tx.objectStore(STORE_SESSIONS).delete(id);
        request.onsuccess = () => resolve(true);
        request.onerror = (e) => {
            console.error('[AI Tracker][DB] Failed to delete session:', e.target.error);
            reject(e.target.error);
        };
    }));
}

/**
 * Clears ALL sessions from the database. Irreversible.
 * @returns {Promise<boolean>}
 */
function deleteAllSessions() {
    return getDb().then(db => new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_SESSIONS, 'readwrite');
        const request = tx.objectStore(STORE_SESSIONS).clear();
        request.onsuccess = () => {
            console.log('[AI Tracker][DB] All sessions deleted.');
            resolve(true);
        };
        request.onerror = (e) => {
            console.error('[AI Tracker][DB] Failed to clear sessions:', e.target.error);
            reject(e.target.error);
        };
    }));
}

// ─── Read Operations ──────────────────────────────────────────────────────────

/**
 * Returns a single session by UUID, or null if not found.
 * @returns {Promise<Object|null>}
 */
function getSession(id) {
    return getDb().then(db => new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_SESSIONS, 'readonly');
        const request = tx.objectStore(STORE_SESSIONS).get(id);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = (e) => reject(e.target.error);
    }));
}

/**
 * Returns ALL sessions.
 * Use sparingly — only for data export or full-lifetime aggregations.
 * @returns {Promise<Object[]>}
 */
function getAllSessions() {
    return getDb().then(db => new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_SESSIONS, 'readonly');
        const request = tx.objectStore(STORE_SESSIONS).getAll();
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = (e) => reject(e.target.error);
    }));
}

/**
 * Returns sessions where startTime falls within [startMs, endMs] (inclusive).
 * Uses the by_startTime index for efficiency.
 * @returns {Promise<Object[]>}
 */
function getSessionsByDateRange(startMs, endMs) {
    return getDb().then(db => new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_SESSIONS, 'readonly');
        const index = tx.objectStore(STORE_SESSIONS).index('by_startTime');
        const request = index.getAll(IDBKeyRange.bound(startMs, endMs));
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = (e) => reject(e.target.error);
    }));
}

/**
 * Returns all sessions for a specific local date string (YYYY-MM-DD).
 * Uses the by_date index.
 * @returns {Promise<Object[]>}
 */
function getSessionsByDate(localDateString) {
    return getDb().then(db => new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_SESSIONS, 'readonly');
        const index = tx.objectStore(STORE_SESSIONS).index('by_date');
        const request = index.getAll(IDBKeyRange.only(localDateString));
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = (e) => reject(e.target.error);
    }));
}

/**
 * Returns sessions for a specific platform name (e.g. "ChatGPT").
 * @returns {Promise<Object[]>}
 */
function getSessionsBySite(site) {
    return getDb().then(db => new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_SESSIONS, 'readonly');
        const index = tx.objectStore(STORE_SESSIONS).index('by_site');
        const request = index.getAll(IDBKeyRange.only(site));
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = (e) => reject(e.target.error);
    }));
}

/**
 * Returns the most recent N sessions, sorted newest-first.
 * @param {number} limit - max records to return (default 20)
 * @returns {Promise<Object[]>}
 */
function getRecentSessions(limit) {
    limit = limit || 20;
    return getAllSessions().then(sessions =>
        sessions.sort((a, b) => b.startTime - a.startTime).slice(0, limit)
    );
}

/**
 * Returns the total number of stored sessions.
 * @returns {Promise<number>}
 */
function getSessionCount() {
    return getDb().then(db => new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_SESSIONS, 'readonly');
        const request = tx.objectStore(STORE_SESSIONS).count();
        request.onsuccess = () => resolve(request.result);
        request.onerror = (e) => reject(e.target.error);
    }));
}
