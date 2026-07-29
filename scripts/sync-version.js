#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const packagePath = path.join(__dirname, '..', 'package.json');
const manifestPath = path.join(__dirname, '..', 'manifest.json');
const versionsPath = path.join(__dirname, '..', 'versions.json');

const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
const manifestJson = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

manifestJson.version = packageJson.version;

fs.writeFileSync(manifestPath, JSON.stringify(manifestJson, null, 2) + '\n');

// Sync versions.json: ensure current version is mapped to the manifest's minAppVersion.
let versionsJson = {};
try {
  versionsJson = JSON.parse(fs.readFileSync(versionsPath, 'utf8'));
} catch {
  // File missing or corrupt — start fresh.
}
versionsJson[packageJson.version] = manifestJson.minAppVersion;
// Sort keys from oldest to newest (semver sort by length, then locale).
const sorted = Object.fromEntries(
  Object.entries(versionsJson).sort(([a], [b]) => {
    const aParts = a.split('.').map(Number);
    const bParts = b.split('.').map(Number);
    for (let i = 0; i < 3; i++) {
      if ((aParts[i] ?? 0) !== (bParts[i] ?? 0)) return (aParts[i] ?? 0) - (bParts[i] ?? 0);
    }
    return 0;
  }),
);
fs.writeFileSync(versionsPath, JSON.stringify(sorted, null, 2) + '\n');

console.log(`Synced version to ${packageJson.version} (versions.json: ${Object.keys(sorted).length} entries)`);
