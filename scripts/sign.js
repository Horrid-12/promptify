/**
 * sign.js
 * Signs the extension with Mozilla AMO (web-ext sign) on the *unlisted*
 * channel, producing a signed .xpi that can be installed permanently into a
 * Firefox/Floorp profile with no terminal and no dev-mode flag.
 *
 * AMO developer API credentials are read from, in priority order:
 *   1. Environment variables WED_EXT_API_KEY / WED_EXT_API_SECRET
 *   2. A local, git-ignored config file at <repo>/.amo-keys.json
 *      (never commit this file — it contains secrets!)
 *
 * The signed artifact is written to dist/promptify-<version>.xpi.
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const rootDir = path.resolve(__dirname, '..');
const distFirefox = path.join(rootDir, 'dist', 'firefox');
const artifactsDir = path.join(rootDir, 'dist');
const configFile = path.join(rootDir, '.amo-keys.json');

if (!fs.existsSync(path.join(distFirefox, 'manifest.json'))) {
    console.error('dist/firefox not built. Run `npm run build` first.');
    process.exit(1);
}

function loadCredentials() {
    const apiKey = process.env.WED_EXT_API_KEY;
    const apiSecret = process.env.WED_EXT_API_SECRET;

    if (apiKey && apiSecret) {
        return { apiKey, apiSecret, source: 'environment variables' };
    }

    if (fs.existsSync(configFile)) {
        try {
            const cfg = JSON.parse(fs.readFileSync(configFile, 'utf8'));
            if (cfg.apiKey && cfg.apiSecret) {
                return { apiKey: cfg.apiKey, apiSecret: cfg.apiSecret, source: configFile };
            }
        } catch (err) {
            console.error('Could not parse ' + configFile + ':', err.message);
        }
    }

    console.error('No AMO credentials found.');
    console.error('');
    console.error('Set WED_EXT_API_KEY and WED_EXT_API_SECRET env vars, OR create ' + configFile + ':');
    console.error('  { "apiKey": "<JWT issuer>", "apiSecret": "<JWT secret>" }');
    console.error('');
    console.error('Get keys at: https://addons.mozilla.org/developers/addon/api/key/');
    process.exit(1);
}

const creds = loadCredentials();
console.log('Using AMO credentials from: ' + creds.source);

// Invoke web-ext's CLI directly through Node (avoids Windows .cmd shim issues
// and passes paths with spaces safely).
const webextCli = path.join(rootDir, 'node_modules', 'web-ext', 'bin', 'web-ext.js');
const args = [
    webextCli,
    'sign',
    '--source-dir', distFirefox,
    '--artifacts-dir', artifactsDir,
    '--channel', 'unlisted',
    '--api-key', creds.apiKey,
    '--api-secret', creds.apiSecret,
    '--no-config-discovery',
    '--no-input'
];

console.log('Signing extension via AMO (unlisted channel)...');
const child = spawn(process.execPath, args, {
    cwd: rootDir,
    stdio: 'inherit',
    env: { ...process.env }
});
child.on('error', err => {
    console.error('[sign] Failed to start web-ext:', err);
    process.exit(1);
});
child.on('exit', code => {
    if (code === 0) {
        console.log('\nSigning complete.');
        console.log('Install the .xpi permanently into your Firefox/Floorp profile:');
        console.log('  1. Open Floorp → about:addons');
        console.log('  2. Click the gear → "Install Add-on From File..."');
        console.log('  3. Select dist/promptify-<version>.xpi');
    }
    process.exit(code);
});
