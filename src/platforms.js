/**
 * platforms.js
 * Central registry of all tracked AI platforms.
 *
 * Single source of truth — every other file imports or references this.
 * Works in both service worker (importScripts) and page contexts (<script>).
 */

// ─── Platform Registry ────────────────────────────────────────────────────────

const PLATFORM_REGISTRY = [
    {
        id: 'chatgpt', name: 'ChatGPT',
        icon: 'icons8-chatgpt-50.png',
        match: function(h) { return h === 'chatgpt.com' || h.endsWith('.chatgpt.com'); },
        subPlatforms: [
            {
                id: 'codex', name: 'Codex', parentId: 'chatgpt',
                icon: 'codex.png',
                match: function(h, p) {
                    return (h === 'chatgpt.com' || h.endsWith('.chatgpt.com'))
                        && p && p.startsWith('/codex');
                }
            }
        ]
    },
    {
        id: 'claude', name: 'Claude',
        icon: 'icons8-claude-ai-50.png',
        match: function(h) { return h === 'claude.ai' || h.endsWith('.claude.ai'); }
    },
    {
        id: 'gemini', name: 'Gemini',
        icon: 'icons8-gemini-ai-50.png',
        match: function(h) { return h === 'gemini.google.com' || h.endsWith('.gemini.google.com'); },
        subPlatforms: [
            {
                id: 'flow', name: 'Flow', parentId: 'gemini',
                icon: 'flow.png',
                match: function(h, p) {
                    if (h === 'flow.google') return true;
                    if (h === 'labs.google' && p && p.startsWith('/fx/tools/flow')) return true;
                    return false;
                }
            },
            {
                id: 'notebooklm', name: 'NotebookLM', parentId: 'gemini',
                icon: 'notebooklm.png',
                match: function(h) { return h === 'notebooklm.google.com'; }
            },
            {
                id: 'veo', name: 'Veo', parentId: 'gemini',
                icon: 'veo.png',
                match: function(h, p) {
                    return h === 'aistudio.google.com' && p && p.includes('/veo');
                }
            }
        ]
    },
    {
        id: 'perplexity', name: 'Perplexity',
        icon: 'icons8-perplexity-ai-50.png',
        match: function(h) {
            return h === 'perplexity.ai' || h === 'www.perplexity.ai'
                || h.endsWith('.perplexity.ai');
        }
    },
    {
        id: 'qwen', name: 'Qwen',
        icon: 'qwen.png',
        match: function(h) {
            return ['chat.qwen.ai', 'qianwen.com', 'www.qianwen.com'].indexOf(h) !== -1;
        }
    },
    {
        id: 'deepseek', name: 'DeepSeek',
        icon: 'deepseek.png',
        match: function(h) {
            return h === 'chat.deepseek.com' || h === 'deepseek.com' || h === 'www.deepseek.com';
        }
    },
    {
        id: 'kimi', name: 'Kimi',
        icon: 'kimi.png',
        match: function(h) {
            return ['kimi.ai', 'www.kimi.ai', 'kimi.moonshot.cn', 'www.kimi.moonshot.cn',
                    'kimi.com', 'www.kimi.com'].indexOf(h) !== -1;
        }
    },
    {
        id: 'copilot', name: 'Copilot',
        icon: 'copilot.png',
        match: function(h) {
            return ['copilot.microsoft.com', 'copilot.cloud.microsoft',
                    'm365copilot.com', 'm365.cloud.microsoft'].indexOf(h) !== -1;
        }
    },
    {
        id: 'grok', name: 'Grok',
        icon: 'grok.png',
        match: function(h) {
            return h === 'grok.com' || h === 'www.grok.com';
        }
    }
];

// ─── Derived Lists (computed once) ────────────────────────────────────────────

const ALL_PLATFORM_IDS = [];
const ALL_PLATFORM_NAMES = {};
const PLATFORM_ICONS = {};
const PARENT_MAP = {}; // subPlatformId -> parentId

PLATFORM_REGISTRY.forEach(function(p) {
    ALL_PLATFORM_IDS.push(p.id);
    ALL_PLATFORM_NAMES[p.id] = p.name;
    PLATFORM_ICONS[p.id] = p.icon;
    if (p.subPlatforms) {
        p.subPlatforms.forEach(function(sp) {
            ALL_PLATFORM_IDS.push(sp.id);
            ALL_PLATFORM_NAMES[sp.id] = sp.name;
            PLATFORM_ICONS[sp.id] = sp.icon;
            PARENT_MAP[sp.id] = sp.parentId;
        });
    }
});

// Top-level platform IDs only (excludes sub-platforms)
const TOP_LEVEL_PLATFORM_IDS = PLATFORM_REGISTRY.map(function(p) { return p.id; });

// ─── Lookup Functions ─────────────────────────────────────────────────────────

/**
 * Looks up a URL and returns the matching platform.
 * Sub-platforms are checked first (more specific match wins).
 * Returns { id, name, parentId } or null.
 */
function lookupPlatform(urlString) {
    if (!urlString) return null;
    try {
        var url = new URL(urlString);
        var hostname = url.hostname;
        var pathname = url.pathname;

        // Check sub-platforms first (more specific)
        for (var i = 0; i < PLATFORM_REGISTRY.length; i++) {
            var platform = PLATFORM_REGISTRY[i];
            if (platform.subPlatforms) {
                for (var j = 0; j < platform.subPlatforms.length; j++) {
                    var sub = platform.subPlatforms[j];
                    if (sub.match(hostname, pathname)) {
                        return { id: sub.id, name: sub.name, parentId: sub.parentId };
                    }
                }
            }
        }

        // Check top-level platforms
        for (var i = 0; i < PLATFORM_REGISTRY.length; i++) {
            var platform = PLATFORM_REGISTRY[i];
            if (platform.match(hostname, pathname)) {
                return { id: platform.id, name: platform.name, parentId: null };
            }
        }
    } catch (_) { /* invalid URL */ }
    return null;
}

/**
 * Returns the parent platform ID for a sub-platform, or null if top-level.
 */
function getParentPlatformId(platformId) {
    return PARENT_MAP[platformId] || null;
}

/**
 * Returns array of sub-platform IDs for a given parent, or empty array.
 */
function getSubPlatformIds(parentId) {
    var result = [];
    for (var i = 0; i < PLATFORM_REGISTRY.length; i++) {
        var p = PLATFORM_REGISTRY[i];
        if (p.id === parentId && p.subPlatforms) {
            p.subPlatforms.forEach(function(sp) { result.push(sp.id); });
        }
    }
    return result;
}

/**
 * Returns the icon filename for a platform ID.
 */
function getPlatformIcon(platformId) {
    return PLATFORM_ICONS[platformId] || '';
}

/**
 * Returns the display name for a platform ID.
 */
function getPlatformName(platformId) {
    return ALL_PLATFORM_NAMES[platformId] || platformId;
}

/**
 * Returns all platform IDs including sub-platforms.
 */
function getAllPlatformIds() {
    return ALL_PLATFORM_IDS.slice();
}

/**
 * Returns only top-level platform IDs.
 */
function getTopLevelPlatformIds() {
    return TOP_LEVEL_PLATFORM_IDS.slice();
}

// ─── Legacy Name → ID Mapping ────────────────────────────────────────────────
// Old sessions in IndexedDB may store display names ('ChatGPT') instead of
// IDs ('chatgpt'). This map normalizes them.

var LEGACY_NAME_TO_ID = {};
PLATFORM_REGISTRY.forEach(function(p) {
    LEGACY_NAME_TO_ID[p.name.toLowerCase()] = p.id;
    LEGACY_NAME_TO_ID[p.id] = p.id;
    if (p.subPlatforms) {
        p.subPlatforms.forEach(function(sp) {
            LEGACY_NAME_TO_ID[sp.name.toLowerCase()] = sp.id;
            LEGACY_NAME_TO_ID[sp.id] = sp.id;
        });
    }
});

/**
 * Normalizes a stored session site value to a current platform ID.
 * Handles both old display names ('ChatGPT') and new IDs ('chatgpt').
 */
function normalizeSiteId(site) {
    if (!site) return site;
    var lower = site.toLowerCase();
    return LEGACY_NAME_TO_ID[lower] || LEGACY_NAME_TO_ID[site] || site;
}

// ─── Compatibility Exports ────────────────────────────────────────────────────

var SUPPORTED_PLATFORMS = getAllPlatformIds();

var AI_SITES = {};
PLATFORM_REGISTRY.forEach(function(p) {
    AI_SITES[p.id] = p.name;
});

var AI_SITE_DOMAINS = {};
PLATFORM_REGISTRY.forEach(function(p) {
    AI_SITE_DOMAINS[p.name] = p.id;
});


