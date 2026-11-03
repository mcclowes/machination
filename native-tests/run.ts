/** Run real iOS replay, first-player, or secure-editor flows in a new simulator; never reuse a player's container. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { gunzipSync } from 'node:zlib';
import { decodeReplayArtifact, seekReplayArtifact } from '../src/replay/artifact';
import { SHARED_REPLAY_LIMITS } from '../src/replay/timeline';
import { startLoggedCommand } from './process';

type Fixture = { name: string; gzip?: string; text?: string; bytes: number; sha256: string; schema: number | null; from?: number; through?: number };
const root = resolve(dirname(process.argv[1]!), '..');
const native = join(root, 'native-tests');
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const { values } = parseArgs({ options: {
  app: { type: 'string' }, runtime: { type: 'string', default: 'com.apple.CoreSimulator.SimRuntime.iOS-27-0' },
  'device-type': { type: 'string', default: 'com.apple.CoreSimulator.SimDeviceType.iPhone-18-Pro' }, help: { type: 'boolean' },
  orientation: { type: 'string', default: 'portrait' },
  'content-size': { type: 'string', default: 'large' },
  flow: { type: 'string', default: 'replay' },
} });

async function main() {
  if (values.help) {
    console.log('Usage: npm run test:native-replay -- --app /path/to/simulator-QA.app [--flow replay|first-player|secure-editors|shared-header|solo-responsiveness] [--runtime identifier] [--device-type identifier] [--orientation portrait|landscape] [--content-size large|accessibility-extra-extra-extra-large]');
    return;
  }
  assert.equal(process.platform, 'darwin', 'Native replay acceptance requires macOS and Xcode.');
  assert.equal(process.version, `v${(await readFile(join(root, '.nvmrc'), 'utf8')).trim()}`, 'Use the pinned Node version.');
  assert.ok(values.app, 'Provide a separately identified simulator QA app with --app.');
  assert.ok(values.orientation === 'portrait' || values.orientation === 'landscape', 'Choose portrait or landscape orientation.');
  assert.ok(values['content-size'] === 'large' || values['content-size'] === 'accessibility-extra-extra-extra-large', 'Choose large or accessibility-extra-extra-extra-large content size.');
  assert.ok(values.flow === 'replay' || values.flow === 'first-player' || values.flow === 'secure-editors' || values.flow === 'shared-header' || values.flow === 'solo-responsiveness', 'Choose replay, first-player, secure-editors, shared-header, or solo-responsiveness flow.');
  assert.ok(values.flow === 'replay' || values.orientation === 'portrait', 'Non-replay acceptance currently supports portrait only.');
  const prefix = '-only-testing:ReplayUITests/ReplayNativeAcceptance/';
  const flow = values.flow === 'solo-responsiveness'
    ? { count: 1, selectors: [prefix + 'testSoloResponsiveness'], scope: 'Simulator default and ten-player solo advance, inspection, forecast, and return-to-live readiness; physical-device latency remains separate.' }
    : values.flow === 'first-player'
    ? { count: 1, selectors: [prefix + 'testFirstReinforcement'], scope: 'Simulator first-player practice interaction and retained progress only.' }
    : values.flow === 'secure-editors'
      ? { count: 1, selectors: [prefix + 'testSecureEditorTransitions'], scope: 'Simulator secure/plain editor transitions using synthetic input only; no recovery submission or account acceptance.' }
      : values.flow === 'shared-header'
        ? { count: 1, selectors: [prefix + 'testSharedHeader'], scope: 'Simulator shared-header visible text and Games/sound/manual interaction only.' }
        : { count: 3, selectors: [prefix + 'testPackedReplayRecovery', prefix + 'testLegacyReplayControls', prefix + 'testDriftingLegacyReplay'], scope: 'Simulator file-picker/replay interaction only.' };
  const app = resolve(values.app);
  const parent = join(root, '.data/native-replay-acceptance');
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const out = await mkdtemp(join(parent, 'run-'));
  const commands: object[] = [];
  let device: string | undefined;
  let activePid: number | undefined;
  let interrupted = false;
  let succeeded = false;
  const terminate = () => {
    interrupted = true;
    if (activePid) { try { process.kill(-activePid, 'SIGTERM'); } catch { /* Already terminal. */ } }
  };
  process.once('SIGINT', terminate);
  process.once('SIGTERM', terminate);
  async function run(label: string, command: string[], timeout = 60_000, cleanup = false) {
    assert.ok(cleanup || !interrupted, 'Native acceptance interrupted.');
    const stdout = join(out, `${label}.log`), stderr = join(out, `${label}.stderr.log`);
    const started = Date.now();
    const running = startLoggedCommand(command, { cwd: out, env: process.env, stdout, stderr });
    const { child } = running; activePid = child.pid;
    const record = { label, command, pid: child.pid, started, code: null as number | null, signal: null as NodeJS.Signals | null, expired: false, elapsedMs: 0 };
    commands.push(record);
    const completed = running.completed.then(result => {
      record.code = result.code; record.signal = result.signal;
      if (activePid === child.pid) activePid = undefined;
      return result.error;
    });
    let force: ReturnType<typeof setTimeout> | undefined;
    const timer = setTimeout(() => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      record.expired = true;
      try { process.kill(-child.pid!, 'SIGTERM'); } catch { /* Already terminal. */ }
      force = setTimeout(() => { try { process.kill(-child.pid!, 'SIGKILL'); } catch { /* Already terminal. */ } }, 10_000);
    }, timeout);
    try {
      await writeFile(join(out, 'commands.json'), JSON.stringify(commands, null, 2));
      const launchError = await completed;
      if (launchError) throw launchError;
    } catch (error) {
      if (child.pid && child.exitCode === null && child.signalCode === null) {
        try { process.kill(-child.pid, 'SIGTERM'); } catch { /* Already terminal. */ }
        force = setTimeout(() => { try { process.kill(-child.pid!, 'SIGKILL'); } catch { /* Already terminal. */ } }, 10_000);
        await completed;
      }
      throw error;
    } finally {
      clearTimeout(timer); if (force) clearTimeout(force); activePid = undefined;
      record.elapsedMs = Date.now() - started;
      await writeFile(join(out, 'commands.json'), JSON.stringify(commands, null, 2));
    }
    assert.equal(record.code, 0, `${label} failed; inspect ${stderr} and ${stdout}.`);
    return (await readFile(stdout, 'utf8')).trim();
  }
  const sim = (label: string, ...args: string[]) => run(label, ['xcrun', 'simctl', ...args]);
  try {
    const id = await run('bundle-id', ['/usr/libexec/PlistBuddy', '-c', 'Print :CFBundleIdentifier', join(app, 'Info.plist')]);
    assert.match(id, /^com\.mcclowes\.machination\.[a-z0-9-]*qa$/, 'Use a separate Machination QA identity, never the regular app.');
    const name = await run('display-name', ['/usr/libexec/PlistBuddy', '-c', 'Print :CFBundleDisplayName', join(app, 'Info.plist')]);
    assert.equal(await run('documents-visible', ['/usr/libexec/PlistBuddy', '-c', 'Print :UIFileSharingEnabled', join(app, 'Info.plist')]), 'true', 'QA Documents must be visible to the real picker.');
    const executable = await run('executable', ['/usr/libexec/PlistBuddy', '-c', 'Print :CFBundleExecutable', join(app, 'Info.plist')]);
    const platform = await run('platform', ['xcrun', 'vtool', '-show-build', join(app, executable)]);
    assert.match(platform, /platform IOSSIMULATOR/, 'Provide a simulator app, not a device archive or IPA.');
    await run('signature', ['codesign', '--verify', '--deep', '--strict', app]);
    const bundle = hash(await readFile(join(app, 'main.jsbundle')));
    const fixtures = JSON.parse(await readFile(join(native, 'fixtures/manifest.json'), 'utf8')) as Fixture[];
    const payloads = new Map<string, Buffer>();
    for (const fixture of fixtures) {
      assert.match(fixture.name, /^\d{2}-[a-z-]+\.json$/);
      const raw = fixture.gzip ? gunzipSync(await readFile(join(native, 'fixtures', fixture.gzip)), { maxOutputLength: SHARED_REPLAY_LIMITS.bytes }) : Buffer.from(fixture.text!);
      assert.equal(raw.length, fixture.bytes); assert.equal(hash(raw), fixture.sha256);
      if (fixture.schema) {
        const replay = decodeReplayArtifact(raw.toString('utf8'));
        assert.equal(replay.schemaVersion, fixture.schema); assert.equal(replay.from, fixture.from); assert.equal(replay.through, fixture.through);
        seekReplayArtifact(replay, replay.through);
      } else assert.throws(() => decodeReplayArtifact(raw.toString('utf8')));
      payloads.set(fixture.name, raw);
    }
    await writeFile(join(out, 'fixtures.json'), JSON.stringify(fixtures, null, 2));
    const project = join(out, 'project'); await mkdir(project);
    await cp(join(native, 'ReplayUITests.xcodeproj'), join(project, 'ReplayUITests.xcodeproj'), { recursive: true });
    await cp(join(native, 'ReplayNativeAcceptance.m'), join(project, 'ReplayNativeAcceptance.m'));
    const sourceHash = hash(await readFile(join(project, 'ReplayNativeAcceptance.m')));
    device = await sim('create-device', 'create', 'Machination isolated replay acceptance', values['device-type']!, values.runtime!);
    assert.match(device, /^[A-F0-9-]{36}$/);
    await sim('boot', 'boot', device); await sim('boot-ready', 'bootstatus', device, '-b');
    await sim('content-size-set', 'ui', device, 'content_size', values['content-size']!);
    assert.equal(await sim('content-size-read', 'ui', device, 'content_size'), values['content-size'], 'Simulator must apply the requested text size.');
    await sim('install', 'install', device, app);
    const installed = await sim('installed-app', 'get_app_container', device, id, 'app');
    assert.equal(hash(await readFile(join(installed, 'main.jsbundle'))), bundle);
    const data = await sim('data-container', 'get_app_container', device, id, 'data');
    const documents = join(data, 'Documents'); await mkdir(documents, { recursive: true });
    for (const [file, raw] of payloads) await writeFile(join(documents, file), raw, { flag: 'wx', mode: 0o600 });
    const derived = join(out, 'DerivedData');
    await run('build', ['xcodebuild', 'build-for-testing', '-project', join(project, 'ReplayUITests.xcodeproj'), '-scheme', 'ReplayUITests', '-destination', `platform=iOS Simulator,id=${device}`, '-derivedDataPath', derived, '-jobs', '2', '-resultBundlePath', join(out, 'build.xcresult')], 240_000);
    assert.equal(hash(await readFile(join(project, 'ReplayNativeAcceptance.m'))), sourceHash);
    const products = join(derived, 'Build/Products');
    const runfiles = (await readdir(products)).filter(file => file.endsWith('.xctestrun')); assert.equal(runfiles.length, 1);
    const runfile = join(products, runfiles[0]!);
    await run('qa-id', ['/usr/libexec/PlistBuddy', '-c', `Add :ReplayUITests:EnvironmentVariables:QA_BUNDLE_ID string ${id}`, runfile]);
    await run('qa-name', ['/usr/libexec/PlistBuddy', '-c', `Add :ReplayUITests:EnvironmentVariables:QA_DOCUMENTS_NAME string ${name}`, runfile]);
    await run('qa-orientation', ['/usr/libexec/PlistBuddy', '-c', `Add :ReplayUITests:EnvironmentVariables:QA_ORIENTATION string ${values.orientation}`, runfile]);
    assert.equal(await run('qa-name-check', ['/usr/libexec/PlistBuddy', '-c', 'Print :ReplayUITests:EnvironmentVariables:QA_DOCUMENTS_NAME', runfile]), name);
    console.log(`Native cases running on owned simulator ${device}. Evidence: ${out}`);
    await run('tests', ['xcodebuild', 'test-without-building', '-xctestrun', runfile, '-destination', `platform=iOS Simulator,id=${device}`, ...flow.selectors, '-parallel-testing-enabled', 'NO', '-resultBundlePath', join(out, 'tests.xcresult')], 360_000);
    const summary = JSON.parse(await run('summary', ['xcrun', 'xcresulttool', 'get', 'test-results', 'summary', '--path', join(out, 'tests.xcresult')]));
    assert.equal(summary.totalTestCount, flow.count); assert.equal(summary.passedTests, flow.count); assert.equal(summary.failedTests, 0); assert.equal(summary.skippedTests, 0);
    for (const [file, raw] of payloads) assert.equal(hash(await readFile(join(documents, file))), hash(raw), `Original fixture changed: ${file}`);
    const cache = join(data, 'Library/Caches/DocumentPicker');
    assert.deepEqual(await readdir(cache).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return []; throw error; }), [], 'Picker cache copies must be cleaned.');
    assert.equal(hash(await readFile(join(app, 'main.jsbundle'))), bundle, 'Input app changed.');
    await run('screenshots', ['xcrun', 'xcresulttool', 'export', 'attachments', '--path', join(out, 'tests.xcresult'), '--output-path', join(out, 'attachments')]);
    assert.equal(await sim('content-size-final', 'ui', device, 'content_size'), values['content-size'], 'Text size must remain applied throughout acceptance.');
    await writeFile(join(out, 'acceptance.json'), JSON.stringify({ flow: values.flow, bundleSha256: bundle, testSourceSha256: sourceHash, device, deviceType: values['device-type'], orientation: values.orientation, contentSize: values['content-size'], runtime: values.runtime, qaIdentity: id, summary, originalFilesPreserved: true, pickerCacheEmpty: true, scope: `${flow.scope} Network-denied, physical-device, complete accessibility, and performance acceptance remain separate.` }, null, 2));
    succeeded = true;
  } finally {
    if (device) await run('shutdown', ['xcrun', 'simctl', 'shutdown', device], 60_000, true).catch(async error => {
      const list = JSON.parse(await run('shutdown-state', ['xcrun', 'simctl', 'list', 'devices', '--json'], 60_000, true));
      assert.ok(Object.values(list.devices as Record<string, { udid: string; state: string }[]>).flat().some(item => item.udid === device && item.state === 'Shutdown'), String(error));
    });
    if (device && succeeded) await run('delete-device', ['xcrun', 'simctl', 'delete', device], 60_000, true);
    await writeFile(join(out, 'result.json'), JSON.stringify({ succeeded, device, interrupted, commands: commands.length }, null, 2));
    process.removeListener('SIGINT', terminate); process.removeListener('SIGTERM', terminate);
    console.log(`${succeeded ? 'PASS' : 'FAIL'}: ${out}`);
  }
}

void main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
