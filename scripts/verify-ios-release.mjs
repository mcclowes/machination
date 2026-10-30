import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const archive = process.argv[2];
const server = process.env.EXPO_PUBLIC_GAME_SERVER;
if (!archive || !server?.startsWith('https://')) throw new Error('Provide the archive and an HTTPS EXPO_PUBLIC_GAME_SERVER.');
const { expo } = JSON.parse(readFileSync(new URL('../app.json', import.meta.url), 'utf8'));
const app = resolve(archive, 'Products/Applications/Machination.app');
execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' });
for (const [field, expected] of Object.entries({
  CFBundleIdentifier: expo.ios.bundleIdentifier,
  CFBundleShortVersionString: expo.version,
  CFBundleVersion: expo.ios.buildNumber,
  ITSAppUsesNonExemptEncryption: 'false',
})) {
  const actual = execFileSync('/usr/libexec/PlistBuddy', ['-c', `Print :${field}`, resolve(app, 'Info.plist')], { encoding: 'utf8' }).trim();
  if (actual !== expected) throw new Error(`${field}: expected ${expected}, received ${actual}.`);
}
if (!readFileSync(resolve(app, 'main.jsbundle')).includes(Buffer.from(server))) {
  throw new Error('The archived JavaScript does not contain the configured HTTPS multiplayer origin.');
}
console.log(`Verified signed iOS ${expo.version} (${expo.ios.buildNumber}) with ${server}.`);
