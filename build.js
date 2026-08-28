const fs = require('fs');
const path = require('path');

const rootDir = __dirname;
const distDir = path.join(rootDir, 'dist');
const chromeDir = path.join(distDir, 'chrome');
const firefoxDir = path.join(distDir, 'firefox');

// Files and directories to include
const includePaths = [
    'assets',
    'pages',
    'src',
    'manifest.json',
    'README.md'
];

function copyRecursiveSync(src, dest) {
    const exists = fs.existsSync(src);
    const stats = exists && fs.statSync(src);
    const isDirectory = exists && stats.isDirectory();
    if (isDirectory) {
        if (!fs.existsSync(dest)) {
            fs.mkdirSync(dest, { recursive: true });
        }
        fs.readdirSync(src).forEach(function(childItemName) {
            copyRecursiveSync(path.join(src, childItemName), path.join(dest, childItemName));
        });
    } else {
        fs.copyFileSync(src, dest);
    }
}

// Clean dist directory
if (fs.existsSync(distDir)) {
    fs.rmSync(distDir, { recursive: true, force: true });
}

fs.mkdirSync(chromeDir, { recursive: true });
fs.mkdirSync(firefoxDir, { recursive: true });

console.log('Copying files...');

includePaths.forEach(item => {
    const srcPath = path.join(rootDir, item);
    if (fs.existsSync(srcPath)) {
        copyRecursiveSync(srcPath, path.join(chromeDir, item));
        copyRecursiveSync(srcPath, path.join(firefoxDir, item));
    }
});

console.log('Modifying manifests...');

// Process Chrome Manifest
const chromeManifestPath = path.join(chromeDir, 'manifest.json');
const chromeManifest = JSON.parse(fs.readFileSync(chromeManifestPath, 'utf8'));

// Chrome requires service_worker and no scripts array in MV3
if (chromeManifest.background) {
    delete chromeManifest.background.scripts;
}
// Remove firefox-specific keys
delete chromeManifest.browser_specific_settings;

fs.writeFileSync(chromeManifestPath, JSON.stringify(chromeManifest, null, 2));

// Process Firefox Manifest
const firefoxManifestPath = path.join(firefoxDir, 'manifest.json');
const firefoxManifest = JSON.parse(fs.readFileSync(firefoxManifestPath, 'utf8'));

// Firefox works better with scripts array for MV3 background, remove service_worker
if (firefoxManifest.background) {
    delete firefoxManifest.background.service_worker;
}

fs.writeFileSync(firefoxManifestPath, JSON.stringify(firefoxManifest, null, 2));

console.log('Build complete. Directories created at dist/chrome and dist/firefox');

