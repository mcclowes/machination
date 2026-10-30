import { OPERATION_MOTION_NATIVE, operationMotionPreferencePlugin } from '../test-support/operation-motion-host';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { build } from 'esbuild';
import { SPECIALISTS } from '../game/specialist-catalog';
import { chartOffsets, chartPosition } from '../game/chart-projection';

const require = createRequire(import.meta.url);
const React = require('react');
const { create, act } = require('react-test-renderer');
const loaded = build({
  entryPoints: [new URL('./BeltMap.tsx', import.meta.url).pathname], bundle: true, write: false, format: 'esm', platform: 'node',
  plugins: [operationMotionPreferencePlugin, { name: 'specialist-chart-host', setup(builder) {
    builder.onResolve({ filter: /^react(?:\/.*)?$/ }, args => ({ path: pathToFileURL(require.resolve(args.path)).href, external: true }));
    builder.onResolve({ filter: /\.png$/ }, () => ({ path: 'image', namespace: 'image-host' }));
    builder.onLoad({ filter: /.*/, namespace: 'image-host' }, () => ({ contents: `export default 'chart-image';` }));
    builder.onResolve({ filter: /^react-native$/ }, () => ({ path: 'native', namespace: 'native-host' }));
    builder.onLoad({ filter: /.*/, namespace: 'native-host' }, () => ({ contents: `${OPERATION_MOTION_NATIVE}
export const View='View',Text='Text',Pressable='Pressable',ScrollView='ScrollView',Image='Image',StyleSheet={create:x=>x,absoluteFillObject:{position:'absolute',left:0,right:0,top:0,bottom:0}},Platform={OS:'ios'},PanResponder={create:x=>({panHandlers:x})};` }));
    builder.onResolve({ filter: /^react-native-svg$/ }, () => ({ path: 'svg', namespace: 'svg-host' }));
    builder.onLoad({ filter: /.*/, namespace: 'svg-host' }, () => ({ contents: `export default 'Svg';export const Circle='Circle',G='G',Line='Line',Path='Path',Text='SvgText';` }));
    builder.onResolve({ filter: /\/(Artwork|SpecialistIcon|PlayerIdentity|SpaceBackground|DriftCourse|CopyObjectReference|HaulerCombat)$/ }, args => ({ path: args.path.split('/').at(-1)!, namespace: 'chart-host' }));
    builder.onLoad({ filter: /.*/, namespace: 'chart-host' }, args => ({ contents: (args.path === 'Artwork' || args.path === 'SpecialistIcon') ? `export const SpecialistIcon='SpecialistIcon',CaptiveLock='CaptiveLock';` : args.path === 'PlayerIdentity' ? `export const PlayerIdentity='PlayerIdentity';export const usePlayerRoster=()=>f=>({name:f,color:'#abc'});` : `export const ${args.path}=()=>null;` }));
  } }],
}).then(async output => import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0]!.text).toString('base64')}`));

async function withChart(props: Record<string, unknown>, check: (renderer: any) => Promise<void>) {
  const { BeltMap } = await loaded;
  const priorAct = Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });
  let renderer: any;
  try {
    await act(async () => { renderer = create(React.createElement(BeltMap, { player: 'you', selected: '', onSelect() {},
      viewport: { camera: { scale: 1, x: 0, y: 0 }, onChange() {} }, ...props })); });
    await check(renderer);
  } finally {
    if (renderer) await act(async () => renderer.unmount());
    if (priorAct) Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', priorAct);
    else delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
  }
}
function fixture() {
  return { hour: 1, rocks: [
    { id: 'home', name: 'Home', x: 25, y: 60, kind: 'factory', owner: 'you', drones: 10, known: true,
      specialists: [{ id: 'queen', kind: 'queen', owner: 'you' }] },
    { id: 'away', name: 'Away', x: 75, y: 60, kind: 'generator', owner: 'vesper', drones: 20, known: true, specialists: [] },
  ], fleets: [{ id: 9, owner: 'you', from: 'home', to: 'away', drones: 0, departed: 0, arrives: 2,
    specialists: [{ id: 'pilot', kind: 'helmsman', owner: 'you', captive: false }] }] };
}

test('a site stays visible when inspection shrinks the chart after a hauler camera reveal', async () => {
  const { BeltMap } = await loaded;
  const game = { ...fixture(), rules: { map: { width: 200, height: 80, topology: 'torus' } } };
  Object.assign(game.rocks[0]!, { x: 100, y: 20 });
  let camera = { scale: 2, x: 0, y: -60 };
  const changes: typeof camera[] = [];
  const props = { game, selected: 'home', inspecting: true, onSelect() {}, player: 'you', viewport: { camera, onChange: (next: typeof camera) => { camera = next; changes.push(next); } } };
  await withChart(props, async renderer => {
    const resize = async (height: number) => act(async () => renderer.root.findByProps({ testID: 'belt-map' }).props.onLayout({ nativeEvent: { layout: { width: 393, height } } }));
    await resize(616);
    changes.splice(0);
    await resize(250);
    assert.equal(changes.length, 1, 'the smaller viewport reveals the selected site once');
    await act(async () => renderer.update(React.createElement(BeltMap, { ...props, viewport: { ...props.viewport, camera } })));
    const positions = chartOffsets(game as any, camera, { width: 393, height: 250 }).map(offset => chartPosition(game as any, camera, { x: 100 + offset.x, y: 20 + offset.y }, { width: 393, height: 250 }).y * 2.5);
    assert.ok(positions.some(y => y >= 32 && y <= 250 - 32), 'the full site control clears both chart edges');
    assert.equal(camera.scale, 2, 'inspection preserves the current zoom');
    changes.splice(0);
    await act(async () => renderer.update(React.createElement(BeltMap, { ...props, viewport: { ...props.viewport, camera: { ...camera, y: -25 } } })));
    assert.equal(changes.length, 0, 'a later manual pan is not pulled back');
    const site = renderer.root.findAll((node: any) => node.type === 'Pressable' && node.props.accessibilityLabel?.startsWith('Home,'))[0];
    await act(async () => site.props.onPress());
    assert.equal(changes.length, 1, 'reselecting the partially clipped site requests another reveal');
  });
});

test('bounded-chart site controls clear every edge and the replay drawer without changing zoom', async () => {
  const { BeltMap } = await loaded;
  for (const size of [{ width: 393, height: 250, covered: 0 }, { width: 250, height: 393, covered: 0 }, { width: 393, height: 616, covered: 330 }]) {
    for (const point of [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 0, y: 100 }, { x: 100, y: 100 }]) for (const scale of [1, 4]) {
      const game = fixture(); Object.assign(game.rocks[0]!, point);
      let camera = { scale, x: 0, y: 0 };
      const props = { game, selected: 'home', inspecting: true, coveredBottom: size.covered, onSelect() {}, player: 'you', viewport: { camera, onChange: (next: typeof camera) => { camera = next; } } };
      await withChart(props, async renderer => {
        await act(async () => renderer.root.findByProps({ testID: 'belt-map' }).props.onLayout({ nativeEvent: { layout: size } }));
        await act(async () => renderer.update(React.createElement(BeltMap, { ...props, viewport: { ...props.viewport, camera } })));
        const control = renderer.root.findAll((node: any) => node.type === 'Pressable' && node.props.accessibilityLabel?.startsWith('Home,'))[0];
        assert.ok(control, 'the selected site remains rendered');
        const left = parseFloat(control.props.style.at(-1).left) / 100 * size.width;
        const top = parseFloat(control.props.style.at(-1).top) / 100 * size.height;
        const detail = `${JSON.stringify({ size, point, scale })}: ${left},${top}`;
        assert.ok(left >= 32 - 1e-6 && left <= size.width - 32 + 1e-6, detail);
        assert.ok(top >= 32 - 1e-6 && top <= size.height - size.covered - 32 + 1e-6, detail);
        assert.equal(camera.scale, scale);
        const revealedStyle = { ...control.props.style.at(-1) };
        await act(async () => renderer.update(React.createElement(BeltMap, { ...props, destination: 'away', viewport: { ...props.viewport, camera } })));
        const planning = renderer.root.findAll((node: any) => node.type === 'Pressable' && node.props.accessibilityLabel?.startsWith('Home,'))[0];
        assert.deepEqual(planning.props.style.at(-1), revealedStyle, 'planning keeps the current edge allowance without another reveal');
      });
    }
  }
});

test('site reveal respects planning and yields the camera to an inspected hauler', async () => {
  const game = fixture(); Object.assign(game.rocks[0]!, { x: 50, y: 0 });
  for (const guard of [{ inspecting: false }, { destination: 'away' }, { transferRoute: { from: { x: 50, y: 0 }, to: { x: 75, y: 60 } } }, { inspectFleet: { request: 1, id: 9 } }]) {
    const changes: unknown[] = [];
    await withChart({ game, selected: 'home', inspecting: true, ...guard, viewport: { camera: { scale: 1, x: 0, y: 0 }, onChange: (next: unknown) => changes.push(next) } }, async renderer => {
      await act(async () => renderer.root.findByProps({ testID: 'belt-map' }).props.onLayout({ nativeEvent: { layout: { width: 393, height: 250 } } }));
      assert.deepEqual(changes, [], `no site reveal for ${JSON.stringify(guard)}`);
    });
  }
});

test('ending transfer planning does not undo a manual pan made during planning', async () => {
  const { BeltMap } = await loaded;
  const game = { ...fixture(), rules: { map: { width: 200, height: 80, topology: 'torus' } } };
  Object.assign(game.rocks[0]!, { x: 100, y: 40 });
  const changes: unknown[] = [];
  const props = { game, selected: 'home', inspecting: true, onSelect() {}, viewport: { camera: { scale: 4, x: 0, y: 0 }, onChange: (next: unknown) => changes.push(next) } };
  await withChart(props, async renderer => {
    const panned = { ...props.viewport, camera: { scale: 4, x: 140, y: 140 } };
    await act(async () => renderer.update(React.createElement(BeltMap, { ...props, destination: 'away', viewport: panned })));
    assert.deepEqual(changes, []);
    await act(async () => renderer.update(React.createElement(BeltMap, { ...props, viewport: panned })));
    assert.deepEqual(changes, [], 'clearing the destination is not a new inspection');
  });
});

test('zero-drone specialist haulers and docked specialists remain visible and inspect through their map assets', async () => {
  const selected: string[] = [];
  let inspections = 0;
  await withChart({ game: fixture(), onSelect: (r: any) => selected.push(r.id), onInspectFleet: () => inspections++ }, async renderer => {
    const icons = renderer.root.findAll((n: any) => n.type === 'SpecialistIcon');
    assert.deepEqual(icons.map((n: any) => n.props.kind).sort(), ['helmsman', 'queen']);
    const fleet = renderer.root.findAll((n: any) => n.type === 'Pressable' && /hauler,/.test(n.props.accessibilityLabel ?? ''))[0];
    assert.match(fleet.props.accessibilityLabel, /Thruster/);
    await act(async () => fleet.props.onPress());
    assert.equal(inspections, 1);
    assert.ok(renderer.root.findAllByProps({ testID: 'hauler-inspector' }).length);
    const site = renderer.root.findAll((n: any) => n.type === 'Pressable' && n.props.accessibilityLabel?.startsWith('Home,'))[0];
    await act(async () => site.props.onPress());
    assert.deepEqual(selected, ['home']);
    const crew = renderer.root.findAll((n: any) => n.type === 'Pressable' && n.props.accessibilityLabel?.startsWith('Inspect specialists aboard'))[0];
    assert.ok(crew, 'The floating insignia must be an inspection target outside the hauler body');
    await act(async () => crew.props.onPress());
    assert.equal(inspections, 2);
  });
});

test('crowded manifests display bounded badges and counts while the asset describes every observed specialist', async () => {
  const game = fixture();
  game.fleets[0]!.specialists = [
    { id: 'crew1', kind: 'queen', owner: 'you', captive: false },
    { id: 'crew2', kind: 'diplomat', owner: 'vesper', captive: true },
    { id: 'crew3', kind: 'diplomat', owner: 'vesper', captive: true },
    { id: 'crew4', kind: 'elder', owner: 'you', captive: false },
    { id: 'crew5', kind: 'foreman', owner: 'you', captive: false },
    { id: 'crew6', kind: 'foreman', owner: 'you', captive: false },
  ];
  await withChart({ game }, async renderer => {
    const fleet = renderer.root.findAll((n: any) => n.type === 'Pressable' && /hauler,/.test(n.props.accessibilityLabel ?? ''))[0];
    const crew = renderer.root.findAll((n: any) => n.type === 'Pressable' && n.props.accessibilityLabel?.startsWith('Inspect specialists aboard'))[0];
    assert.match(fleet.props.accessibilityLabel, /2 × Envoy \(vesper, captive\)/);
    assert.match(fleet.props.accessibilityLabel, /2 × Fabricator/);
    assert.equal(crew.findAll((n: any) => n.type === 'SpecialistIcon').length, 3);
    assert.equal(crew.findAll((n: any) => n.type === 'View' && n.props.testID === 'map-specialist-overflow').length, 1);
    const text = crew.findAll((n: any) => n.type === 'Text').map((n: any) => n.children.join(''));
    assert.ok(text.includes('2'), 'Matching captives retain their count');
    assert.ok(text.includes('+2'), 'Overflow shows remaining units');
    assert.equal(crew.findAll((n: any) => n.type === 'CaptiveLock').length, 1, 'Captives retain their lock indicator');
  });
});

test('hidden or destroyed sites supply no marker or accessible specialist identities', async () => {
  const game = fixture();
  Object.assign(game.rocks[0]!, { known: false, specialists: [{ id: 'secret', kind: 'engineer', owner: 'vesper' }] });
  Object.assign(game.rocks[1]!, { destroyed: true, specialists: [{ id: 'gone', kind: 'martyr', owner: 'vesper' }] });
  await withChart({ game }, async renderer => {
    const kinds = renderer.root.findAll((n: any) => n.type === 'SpecialistIcon').map((n: any) => n.props.kind);
    assert.deepEqual(kinds, ['helmsman']);
    const labels = renderer.root.findAll((n: any) => n.type === 'Pressable').map((n: any) => n.props.accessibilityLabel).join(' ');
    assert.doesNotMatch(labels, /Engineer|Fabricator|Martyr|Self-destruct|secret|gone/);
  });
});

test('large overflow stays compact across platforms without losing the actual manifest count', async () => {
  const game = fixture();
  game.fleets[0]!.specialists = [
    ...['queen', 'diplomat', 'elder'].map((kind, i) => ({ id: `crew-${i}`, kind, owner: 'you', captive: false })),
    ...Array.from({ length: 123 }, (_, i) => ({ id: `extra-${i}`, kind: 'foreman', owner: 'you', captive: false })),
  ];
  await withChart({ game }, async renderer => {
    const crew = renderer.root.findAll((n: any) => n.type === 'Pressable' && n.props.accessibilityLabel?.startsWith('Inspect specialists aboard'))[0];
    assert.match(crew.props.accessibilityLabel, /123 × Fabricator/);
    const overflow = crew.findAll((n: any) => n.type === 'View' && n.props.testID === 'map-specialist-overflow')[0];
    assert.equal(overflow.findAll((n: any) => n.type === 'Text')[0].children.join(''), '99+');
  });
});

test('hauler inspection explains every observed role, owner, and captive group without changing the game', async () => {
  const game = fixture();
  game.fleets[0]!.specialists = [
    { id: 'pilot', kind: 'helmsman', owner: 'you', captive: false },
    { id: 'active', kind: 'engineer', owner: 'you', captive: false },
    { id: 'prisoner1', kind: 'engineer', owner: 'vesper', captive: true },
    { id: 'prisoner2', kind: 'engineer', owner: 'vesper', captive: true },
    { id: 'fourth', kind: 'foreman', owner: 'you', captive: false },
  ];
  const before = structuredClone(game);
  let managed = 0;
  await withChart({ game, onManageFleet: () => managed++ }, async renderer => {
    const crew = renderer.root.findAll((n: any) => n.type === 'Pressable' && n.props.accessibilityLabel?.startsWith('Inspect specialists aboard'))[0];
    await act(async () => crew.props.onPress());
    const inspector = renderer.root.findAllByProps({ testID: 'hauler-inspector' })[0];
    const text = inspector.findAll((n: any) => n.type === 'Text').map((n: any) => n.children.join('')).join(' ');
    assert.match(text, /Specialists aboard/);
    for (const kind of ['helmsman', 'engineer', 'foreman'] as const) assert.ok(text.includes(SPECIALISTS[kind].description), `Missing ${kind} ability description`);
    assert.ok(text.includes(`2 × ${SPECIALISTS.engineer.name}`));
    assert.match(text, /Specialist owner: vesper/);
    assert.match(text, /Captive · abilities inactive/);
    assert.match(text, /Specialist owner: you/);
    assert.equal(managed, 0, 'reading abilities does not manage or issue an order');
    assert.deepEqual(game, before);
    await act(async () => renderer.root.findByProps({ testID: 'belt-map' }).props.onLayout({ nativeEvent: { layout: { width: 393, height: 300 } } }));
    const maxHeight = renderer.root.findAllByProps({ testID: 'hauler-inspector' })[0].props.style.at(-1).maxHeight;
    assert.ok(maxHeight > 0 && maxHeight <= 300 - 44, 'long role descriptions retain a bounded, scrollable inspector');
    await act(async () => inspector.findAll((n: any) => n.type === 'Pressable' && n.props.accessibilityLabel === 'Manage this hauler')[0].props.onPress());
    assert.equal(managed, 1, 'the existing order action remains separate');
  });
});

test('open hauler role details follow the current observation and disappear with the contact', async () => {
  const game = fixture();
  await withChart({ game }, async renderer => {
    const { BeltMap } = await loaded;
    const text = () => renderer.root.findAll((n: any) => n.type === 'Text').map((n: any) => n.children.join('')).join(' ');
    const hauler = renderer.root.findAll((n: any) => n.type === 'Pressable' && /hauler,/.test(n.props.accessibilityLabel ?? ''))[0];
    await act(async () => hauler.props.onPress());
    assert.ok(text().includes(SPECIALISTS.helmsman.description));
    const update = async (next: typeof game) => act(async () => renderer.update(React.createElement(BeltMap, { player: 'you', selected: '', onSelect() {}, game: next, viewport: { camera: { scale: 1, x: 0, y: 0 }, onChange() {} } })));
    const changed = structuredClone(game);
    changed.fleets[0]!.specialists = [{ id: 'observed-new', kind: 'foreman', owner: 'vesper', captive: true }];
    await update(changed);
    assert.ok(!text().includes(SPECIALISTS.helmsman.description), 'old observed cargo is not retained');
    assert.ok(text().includes(SPECIALISTS.foreman.description));
    assert.match(text(), /Captive · abilities inactive/);
    await update({ ...changed, fleets: [] });
    assert.equal(renderer.root.findAllByProps({ testID: 'hauler-inspector' }).length, 0);
    assert.ok(!text().includes(SPECIALISTS.foreman.description), 'a vanished contact leaves no stale role details');
  });
});
