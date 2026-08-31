/**
 * launch-floorp.js
 * Launches Floorp (Firefox fork) with the extension loaded as a temporary
 * add-on directly into the user's MAIN Floorp profile via web-ext.
 *
 * Detects the active Floorp profile from profiles.ini and passes it to
 * web-ext with --keep-profile-changes so the extension persists across
 * restarts of that profile (as long as the terminal stays open).
 *
 * IMPORTANT: You must close all Floorp windows before running this script.
 * web-ext needs exclusive access to the profile directory.
 *
 * Invokes web-ext's CLI (bin/web-ext.js) directly through Node so paths with
 * spaces are passed safely and the Windows .cmd shim is avoided.
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const rootDir = path.resolve(__dirname, '..');
const distFloorp = path.join(rootDir, 'dist', 'floorp');
const floorpAppData = path.join(process.env.APPDATA || process.env.HOME, 'Floorp');
const profilesIni = path.join(floorpAppData, 'profiles.ini');

// ─── Detect Floorp executable ────────────────────────────────────────────────
const CANDIDATES = [
    process.env.FLOORP_BIN,
    'C:\\Program Files\\Ablaze Floorp\\floorp.exe',
    'C:\\Program Files (x86)\\Ablaze Floorp\\floorp.exe',
    process.env.LOCALAPPDATA + '\\Ablaze Floorp\\floorp.exe',
    process.env.LOCALAPPDATA + '\\Floorp\\floorp.exe',
    '/usr/lib/floorp/floorp',
    '/opt/floorp/floorp',
    '/usr/bin/floorp'
].filter(Boolean);

const floorp = CANDIDATES.find(p => fs.existsSync(p));

if (!floorp) {
    console.error('Floorp executable not found. Set the FLOORP_BIN env var to its path.');
    process.exit(1);
}

if (!fs.existsSync(path.join(distFloorp, 'manifest.json'))) {
    console.error('dist/floorp not built. Run `npm run build` first.');
    process.exit(1);
}

// ─── Detect the active Floorp profile from profiles.ini ─────────────────────
function detectProfile() {
    if (!fs.existsSync(profilesIni)) {
        console.error('Could not find Floorp profiles.ini at: ' + profilesIni);
        process.exit(1);
    }

    const ini = fs.readFileSync(profilesIni, 'utf8');
    const profiles = [];

    // Parse all [ProfileN] sections
    const sections = ini.split(/\r?\n\[/);
    for (const section of sections) {
        const lines = section.split(/\r?\n/);
        let profilePath = null;
        let isDefault = false;
        let name = '';

        for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.startsWith('Path=')) profilePath = trimmed.slice(5);
            if (trimmed === 'Default=1') isDefault = true;
            if (trimmed.startsWith('Name=')) name = trimmed.slice(5);
        }

        if (profilePath) {
            const fullPath = path.isAbsolute(profilePath)
                ? profilePath
                : path.join(floorpAppData, profilePath);
            profiles.push({ name, path: fullPath, isDefault });
        }
    }

    // Priority 1: [Install...] section Default= (the actual release-channel default)
    for (const section of sections) {
        if (section.trim().startsWith('Install')) {
            const lines = section.split(/\r?\n/);
            for (const line of lines) {
                const trimmed = line.trim();
                if (trimmed.startsWith('Default=')) {
                    const rel = trimmed.slice(8);
                    const fullPath = path.isAbsolute(rel)
                        ? rel
                        : path.join(floorpAppData, rel);
                    const match = profiles.find(p => p.path === fullPath);
                    if (match) return match;
                }
            }
        }
    }

    // Priority 2: [ProfileN] with Default=1
    const def = profiles.find(p => p.isDefault);
    if (def) return def;

    // Priority 3: most recently modified profile directory
    const existing = profiles.filter(p => fs.existsSync(p.path));
    if (existing.length > 0) {
        existing.sort((a, b) => {
            const sa = fs.statSync(a.path).mtimeMs;
            const sb = fs.statSync(b.path).mtimeMs;
            return sb - sa;
        });
        return existing[0];
    }

    console.error('No valid Floorp profiles found.');
    process.exit(1);
}

const profile = detectProfile();

if (!fs.existsSync(profile.path)) {
    console.error('Profile directory not found: ' + profile.path);
    console.error('Make sure Floorp has been run at least once to create profiles.');
    process.exit(1);
}

console.log('Floorp binary:      ' + floorp);
console.log('Using profile:      ' + profile.name + ' (' + profile.path + ')');
console.log('');
console.log('IMPORTANT: Close ALL Floorp windows before continuing.');
console.log('web-ext needs exclusive access to the profile directory.');
console.log('');
console.log('(press Ctrl+C to abort)');
console.log('');

// Give user 3 seconds to close Floorp, then proceed
setTimeout(() => {
    console.log('Launching Floorp with extension...');
    console.log('(keep this terminal open; edit src/ and save to auto-reload)\n');

    const webextCli = path.join(rootDir, 'node_modules', 'web-ext', 'bin', 'web-ext.js');
    const args = [
        webextCli,
        'run',
        '--source-dir', distFloorp,
        '--firefox', floorp,
        '--firefox-profile', profile.path,
        '--keep-profile-changes',
        '--no-config-discovery',
        '--no-input'
    ];

    const child = spawn(process.execPath, args, { cwd: rootDir, stdio: 'inherit' });
    child.on('error', err => {
        console.error('[launch-floorp] Failed to start web-ext:', err);
        process.exit(1);
    });
    child.on('exit', code => process.exit(code));

    process.on('SIGINT', () => child.kill('SIGINT'));
    process.on('SIGTERM', () => child.kill('SIGTERM'));
}, 3000);
