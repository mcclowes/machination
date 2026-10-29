import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
const React = require('react');
const { create, act } = require('react-test-renderer');
const loaded = build({
  entryPoints: [new URL('./BeltMap.tsx', import.meta.url).pathname], bundle: true, write: false, format: 'esm', platform: 'node',
  plugins: [{ name: 'specialist-chart-host', setup(builder) {
    builder.onResolve({ filter: /^react(?:\/.*)?$/ }, args => ({ path: pathToFileURL(require.resolve(args.path)).href, external: true }));
    builder.onResolve({ filter: /\.png$/ }, () => ({ path: 'image', namespace: 'image-host' }));
    builder.onLoad({ filter: /.*/, namespace: 'image-host' }, () => ({ contents: `export default 'chart-image';` }));
    builder.onResolve({ filter: /^react-native$/ }, () => ({ path: 'native', namespace: 'native-host' }));
    builder.onLoad({ filter: /.*/, namespace: 'native-host' }, () => ({ contents: `export const View='View',Text='Text',Pressable='Pressable',ScrollView='ScrollView',Image='Image',StyleSheet={create:x=>x,absoluteFillObject:{position:'absolute',left:0,right:0,top:0,bottom:0}},Platform={OS:'ios'},PanResponder={create:x=>({panHandlers:x})};` }));
    builder.onResolve({ filter: /^react-native-svg$/ }, () => ({ path: 'svg', namespace: 'svg-host' }));
    builder.onLoad({ filter: /.*/, namespace: 'svg-host' }, () => ({ contents: `export default 'Svg';export const Circle='Circle',G='G',Line='Line',Path='Path';` }));
    builder.onResolve({ filter: /\/(Artwork|PlayerIdentity|SpaceBackground|DriftCourse|CopyObjectReference|HaulerCombat)$/ }, args => ({ path: args.path.split('/').at(-1)!, namespace: 'chart-host' }));
    builder.onLoad({ filter: /.*/, namespace: 'chart-host' }, args => ({ contents: args.path === 'Artwork' ? `export const SpecialistIcon='SpecialistIcon';` : args.path === 'PlayerIdentity' ? `export const PlayerIdentity='PlayerIdentity';export const usePlayerRoster=()=>f=>({name:f,color:'#abc'});` : `export const ${args.path}=()=>null;` }));
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

test('zero-drone specialist haulers and docked specialists remain visible and inspect through their map assets', async () => {
  const selected: string[] = [];
  let inspections = 0;
  await withChart({ game: fixture(), onSelect: (r: any) => selected.push(r.id), onInspectFleet: () => inspections++ }, async renderer => {
    const icons = renderer.root.findAll((n: any) => n.type === 'SpecialistIcon');
    assert.deepEqual(icons.map((n: any) => n.props.kind).sort(), ['helmsman', 'queen']);
    const fleet = renderer.root.findAll((n: any) => n.type === 'Pressable' && /hauler,/.test(n.props.accessibilityLabel ?? ''))[0];
    assert.match(fleet.props.accessibilityLabel, /Routing daemon/);
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
    assert.match(fleet.props.accessibilityLabel, /2 × Envoy protocol \(vesper, captive\)/);
    assert.match(fleet.props.accessibilityLabel, /2 × Assembler daemon/);
    assert.equal(crew.findAll((n: any) => n.type === 'SpecialistIcon').length, 3);
    assert.equal(crew.findAll((n: any) => n.type === 'View' && n.props.testID === 'map-specialist-overflow').length, 1);
    const text = crew.findAll((n: any) => n.type === 'Text').map((n: any) => n.children.join(''));
    assert.ok(text.includes('2'), 'Matching captives retain their count');
    assert.ok(text.includes('+2'), 'Overflow shows remaining units');
    assert.ok(text.includes('🔒'), 'Captives are visibly marked');
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
