import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { build } from 'esbuild';
import { createConfiguredGame } from '../game/world';
import { observe } from '../game/visibility';
import { hireSpecialist, promoteSpecialist } from '../game/specialists';
import { releaseSpecialist } from '../game/specialist-travel';
import type { SpecialistPanelProps } from './SpecialistPanel';

const require = createRequire(import.meta.url);
const React = require('react');
const { create, act } = require('react-test-renderer');
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const loaded = build({
  stdin: { contents: `export {SpecialistPanel} from './src/components/SpecialistPanel'; export {SpecialistBay} from './src/components/SpecialistBay';`, resolveDir: process.cwd(), loader: 'ts' },
  bundle: true, write: false, format: 'esm', platform: 'node',
  plugins: [{ name: 'hosts', setup(b) {
    b.onResolve({ filter: /^react(?:\/.*)?$/ }, a => ({ path: pathToFileURL(require.resolve(a.path)).href, external: true }));
    b.onResolve({ filter: /^react-native$|\/(Artwork|SpecialistIcon)$/ }, a => ({ path: a.path, namespace: 'host' }));
    b.onLoad({ filter: /.*/, namespace: 'host' }, a => ({ contents: a.path === 'react-native' ? `export const View='View',Text='Text',Pressable='Pressable',StyleSheet={create:x=>x};` : `export const ArtworkImage='ArtworkImage',SpecialistIcon='SpecialistIcon';` }));
  } }],
}).then(async r => import(`data:text/javascript;base64,${Buffer.from(r.outputFiles[0]!.text).toString('base64')}`));
function fixture() {
  const game = createConfiguredGame({playerCount: 2, mode: 'mining'}, 0, 123);
  game.hour = 6;
  return game;
}
async function render(props: SpecialistPanelProps, component = 'SpecialistPanel') {
  const module = await loaded;
  let tree: any;
  await act(async () => { tree = create(React.createElement(module[component], props)); });
  return { tree, buttons: () => tree.root.findAll((n: any) => n.type === 'Pressable'), text: () => JSON.stringify(tree.toJSON()), close: async () => { await act(async () => tree.unmount()); } };
}
function props(game = observe(fixture(), 'you')): SpecialistPanelProps {
  return {game, owner:'you', enabled:true, onHire:()=>{}, onPromote:()=>{}, onRelease:()=>{}, onInspectSite:()=>{}, onInspectFleet:()=>{}};
}

test('global hire uses the engine core and inspection works without a selected site', async () => {
  let game = fixture();
  const core = game.rocks.find(r => r.specialists?.some(u=>u.kind==='queen' && u.owner==='you'))!;
  const inspected: string[] = [];
  const panel = await render({...props(observe(game,'you')), onHire: kind => { game = hireSpecialist(game,'you',kind); }, onInspectSite:id=>inspected.push(id)});
  const hire = panel.buttons().find((n:any)=>n.props.accessibilityLabel?.startsWith('Hire '));
  assert.equal(hire.props.disabled,false);
  await act(async()=>hire.props.onPress());
  assert.ok(game.rocks.find(r=>r.id===core.id)!.specialists!.length > core.specialists!.length);
  const location = panel.buttons().find((n:any)=>n.props.accessibilityLabel===`Inspect site ${core.name}`);
  await act(async()=>location.props.onPress());
  assert.deepEqual(inspected,[core.id]);
  await panel.close();
});

test('recruitment shows the cargo fee and disables hires when five cargo is unavailable', async () => {
  for (const cargo of [4, 5]) {
    const game = fixture();
    game.cargo.you = cargo;
    const panel = await render(props(observe(game, 'you')));
    const hires = panel.buttons().filter((n: any) => n.props.accessibilityLabel?.startsWith('Hire '));
    assert.equal(hires.length, 3);
    for (const hire of hires) {
      assert.match(hire.props.accessibilityLabel, /1 credit and 5 cargo/);
      assert.equal(hire.props.disabled, cargo < 5);
    }
    assert.match(panel.text(), /5 cargo/);
    await panel.close();
  }
});

test('hidden sites never supply roster identities or a hiring core, including malformed observations', async () => {
  const view = observe(fixture(),'you');
  for (const site of view.rocks) {
    if (site.known) site.specialists = [];
  }
  (view.rocks[0] as any) = {...view.rocks[0], known:false, specialists:[{id:'secret',kind:'queen',owner:'you'},{id:'secret-promote',kind:'foreman',owner:'you'}]};
  const panel = await render(props(view));
  assert.ok(!panel.text().includes('Fabricator'));
  assert.ok(!panel.text().includes('Inspect site'));
  assert.ok(panel.buttons().filter((n:any)=>n.props.accessibilityLabel?.startsWith('Hire ')).every((n:any)=>n.props.disabled));
  await panel.close();
});

test('traveling core disables hiring and transit/preparation specialists inspect fleets but cannot promote', async () => {
  for (const preparing of [false,true]) {
    const game = fixture();
    const core = game.rocks.find(r=>r.specialists?.some(u=>u.owner==='you' && u.kind==='queen'))!;
    const queen = core.specialists!.find(u=>u.kind==='queen')!;
    core.specialists = [];
    game.fleets.push({id:91,owner:'you',from:core.id,to:game.rocks[1]!.id,drones:1,departed:6,arrives:8,...(preparing?{preparing:true as const}:{}),specialists:[queen,{id:'travel',kind:'foreman',owner:'you'}]});
    const calls:number[]=[];
    const panel = await render({...props(observe(game,'you')),onInspectFleet:id=>calls.push(id)});
    assert.match(panel.text(), preparing ? /Preparing departure/ : /In transit/);
    assert.match(panel.text(), /requires docking/);
    assert.equal(panel.buttons().find((n:any)=>n.props.accessibilityLabel?.startsWith('Promote ')).props.disabled,true);
    assert.ok(panel.buttons().filter((n:any)=>n.props.accessibilityLabel?.startsWith('Hire ')).every((n:any)=>n.props.disabled===!preparing));
    await act(async()=>panel.buttons().find((n:any)=>n.props.accessibilityLabel?.startsWith('Inspect hauler')).props.onPress());
    assert.deepEqual(calls,[91]);
    await panel.close();
  }
});

test('scheduled promotion invokes engine authority and zero credits or read-only states disable commands', async () => {
  let game = fixture();
  const site = game.rocks.find(r=>r.owner==='you')!;
  site.specialists!.push({id:'promote-me',kind:'foreman',owner:'you'});
  const panel = await render({...props(observe(game,'you')),scheduledAt:7,onPromote:id=>{game=promoteSpecialist(game,'you',id);}});
  const button = panel.buttons().find((n:any)=>n.props.accessibilityLabel?.includes('Promote Fabricator'));
  assert.match(button.props.accessibilityLabel,/^Schedule at /);
  assert.equal(button.props.disabled,false);
  await act(async()=>button.props.onPress());
  assert.equal(game.rocks.find(r=>r.id===site.id)!.specialists!.find(u=>u.id==='promote-me')!.kind,'engineer');
  await panel.close();
  for (const variant of ['credits','history','winner','eliminated','draw']) {
    const view = observe(fixture(),'you');
    view.rocks.find(r=>r.known && r.owner==='you')!.specialists!.push({id:'p',kind:'foreman',owner:'you'});
    if(variant==='credits') view.recruitment!.you!.used=100;
    if(variant==='winner') view.winner='you';
    if(variant==='eliminated') view.eliminated=['you'];
    if(variant==='draw') view.draw=true;
    const readonly = await render({...props(view),enabled:variant!=='history'});
    const commands = readonly.buttons().filter((n:any)=>/^(Hire |Promote )/.test(n.props.accessibilityLabel));
    assert.ok(commands.length>0);
    assert.ok(commands.every((n:any)=>n.props.disabled),variant);
    assert.ok(readonly.buttons().some((n:any)=>n.props.accessibilityLabel?.startsWith('Inspect site') && !n.props.disabled));
    await readonly.close();
  }
});

test('captives can return to public territory outside sonar; rescued own captives cannot promote', async () => {
  let game = fixture();
  const custody = game.rocks.find(r=>r.owner==='you')!;
  custody.specialists!.push({id:'rescued',kind:'foreman',owner:'you',captive:true},{id:'foreign',kind:'smuggler',owner:'vesper',captive:true});
  const view = observe(game,'you');
  const site = view.rocks.find(r=>r.known && r.owner==='you')!;
  for(const rock of view.rocks) if(rock.owner==='vesper') (rock as any).known=false;
  const released:string[]=[];
  const panel=await render({...props(view),onRelease:id=>{ released.push(id); game=releaseSpecialist(game,'you',id); }});
  const buttons=panel.buttons().filter((n:any)=>n.props.accessibilityLabel?.startsWith('Release captive'));
  assert.equal(buttons.length,2);
  assert.equal(buttons[0].props.disabled,false);
  assert.equal(buttons[1].props.disabled,false, 'public return ownership is sufficient without private sonar detail');
  assert.ok(!panel.buttons().some((n:any)=>n.props.accessibilityLabel?.startsWith('Promote Fabricator')));
  await act(async()=>buttons[0].props.onPress());
  await act(async()=>buttons[1].props.onPress());
  assert.deepEqual(released,['rescued','foreign']);
  assert.ok(!game.rocks.find(r=>r.id===site.id)!.specialists!.some(unit=>unit.id==='foreign'));
  assert.ok(game.fleets.some(fleet=>fleet.specialists?.some(unit=>unit.id==='foreign')));
  await panel.close();
  if(site.known) site.destroyed=true;
  const destroyed=await render(props(view));
  assert.ok(!destroyed.buttons().some((n:any)=>n.props.accessibilityLabel?.startsWith('Release captive')));
  await destroyed.close();
});

test('local cargo mode retains explicit manifest selection without recruitment controls', async () => {
  const game=fixture();
  const rock=game.rocks.find(r=>r.owner==='you')!;
  rock.specialists=[{id:'load',kind:'foreman',owner:'you'},{id:'captive',kind:'smuggler',owner:'you',captive:true}];
  let selected:string[]=[];
  const module=await loaded;
  let tree:any;
  await act(async()=>{tree=create(React.createElement(module.SpecialistBay,{...props(observe(game,'you')),game,rock,mode:'cargo',enabled:false,selectionEnabled:true,selected,onSelect:(ids:string[])=>{selected=ids;}}));});
  const buttons=tree.root.findAll((n:any)=>n.type==='Pressable');
  assert.equal(buttons.length,1);
  assert.equal(buttons[0].props.accessibilityRole,'checkbox');
  assert.equal(buttons[0].props.disabled,false);
  await act(async()=>buttons[0].props.onPress());
  assert.deepEqual(selected,['load']);
  assert.ok(!JSON.stringify(tree.toJSON()).includes('Next recruitment'));
  await act(async()=>tree.unmount());
});

test('forecasts preserve scheduled hire labels and never invent unknown replacement offers', async () => {
  const view=observe(fixture(),'you');
  const panel=await render({...props(view),scheduledAt:8});
  assert.ok(panel.buttons().some((n:any)=>/^Schedule at .*Hire /.test(n.props.accessibilityLabel)));
  await panel.close();
  view.recruitmentUncertain=true;
  view.recruitment!.you!.offers=[];
  const uncertain=await render({...props(view),scheduledAt:8});
  assert.equal(uncertain.buttons().filter((n:any)=>n.props.accessibilityLabel?.includes('Hire ')).length,0);
  assert.match(uncertain.text(),/Subsequent offers are unknown/);
  await uncertain.close();
});

test('local all mode still gates recruitment to the core site and selected cargo can unload', async () => {
  const game=fixture();
  const sites=game.rocks.filter(r=>r.owner==='you');
  const core=sites.find(r=>r.specialists?.some(u=>u.kind==='queen'))!;
  const other=sites.find(r=>r.id!==core.id)!;
  const module=await loaded;
  for(const rock of [core,other]) {
    let tree:any;
    await act(async()=>{tree=create(React.createElement(module.SpecialistBay,{...props(),game,rock,selected:[],onSelect:()=>{}}));});
    const hires=tree.root.findAll((n:any)=>n.type==='Pressable' && n.props.accessibilityLabel?.startsWith('Hire '));
    assert.ok(hires.length>0);
    assert.ok(hires.every((n:any)=>n.props.disabled===(rock!==core)));
    await act(async()=>tree.unmount());
  }
  let selected=['core-you'];
  core.specialists=[{id:'core-you',kind:'queen',owner:'you'}];
  let tree:any;
  await act(async()=>{tree=create(React.createElement(module.SpecialistBay,{...props(),game,rock:core,mode:'cargo',selected,onSelect:(ids:string[])=>{selected=ids;}}));});
  const checkbox=tree.root.findAll((n:any)=>n.type==='Pressable')[0];
  assert.equal(checkbox.props.accessibilityState.checked,true);
  await act(async()=>checkbox.props.onPress());
  assert.deepEqual(selected,[]);
  await act(async()=>tree.unmount());
});

test('temporal controls activate docked units and retain visible cooldown and repayment costs', async () => {
  const game = fixture();
  const site = game.rocks.find(r => r.owner === 'you' && r.kind === 'factory')!;
  site.specialists!.push({ id: 'ui-anchor', kind: 'anchor', owner: 'you' }, { id: 'ui-overclock', kind: 'overclock', owner: 'you' });
  const activated: string[] = [];
  const panel = await render({ ...props(observe(game, 'you')), onActivate: id => activated.push(id) });
  for (const name of ['Activate stasis · 2h', 'Overclock · 4h boost, 4h repayment']) {
    const button = panel.buttons().find((n: any) => n.props.accessibilityLabel === name);
    assert.equal(button.props.disabled, false);
    await act(async () => button.props.onPress());
  }
  assert.deepEqual(activated, ['ui-anchor', 'ui-overclock']);
  await panel.close();
  site.overclock = { boostUntil: 10, debtUntil: 14 };
  const repaying = await render({ ...props(observe(game, 'you')), onActivate: () => {} });
  assert.equal(repaying.buttons().find((n: any) => n.props.accessibilityLabel === 'Overclock · 4h boost, 4h repayment').props.disabled, true);
  assert.match(repaying.text(), /Double production until/);
  await repaying.close();
  const historical = await render({ ...props(observe(game, 'you')), enabled: false, onActivate: () => {} });
  assert.equal(historical.buttons().find((n: any) => n.props.accessibilityLabel === 'Activate stasis · 2h').props.disabled, true);
  await historical.close();
});
