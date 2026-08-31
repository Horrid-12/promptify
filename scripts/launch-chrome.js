/**
 * launch-chrome.js
 * Launches Chrome/Edge with the unpacked extension loaded, so it persists
 * across restarts (dev mode stays enabled). Detects common install locations
 * on Windows, macOS, and Linux, falling back to a user-provided path.
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const dist = path.join(__dirname, '..', 'dist', 'chrome');
if (!fs.existsSync(path.join(dist, 'manifest.json'))) {
    console.error('dist/chrome not built. Run `npm run build` first.');
    process.exit(1);
}

const candidates = [
    // Windows
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    process.env.LOCALAPPDATA + '\\Google\\Chrome\\Application\\chrome.exe',
    // Edge
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    process.env.LOCALAPPDATA + '\\Microsoft\\Edge\\Application\\msedge.exe',
    // macOS
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    // Linux
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser'
];

const browser = candidates.find(p => p && fs.existsSync(p));

if (!browser) {
    console.error('Chrome/Edge not found. Launch manually with:');
    console.error('  chrome --load-extension=' + dist.replace(/\\/g, '/'));
    process.exit(1);
}

console.log('Launching ' + browser);
const child = spawn(browser, [
    '--load-extension=' + dist,
    '--user-data-dir=' + path.join(__dirname, '..', '.dev-profile')
], { stdio: 'inherit', detached: true });

child.unref();
console.log('Chrome launched with extension. To rebuild, run: npm run dev:watch');
