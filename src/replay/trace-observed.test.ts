import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { temporalWorld } from '../game/temporal-test-world';
import { createArchive, applyCommand } from '../game/replay';
import { advance } from '../game/simulation';
import { generateSharedReplay } from './generate';
import { generatePackedReplay } from './generate-packed';
import { encodeReplayArtifact, seekReplayArtifact } from './artifact';

function threatenedHistory() {
  const game=temporalWorld();
  game.rocks[0]!.specialists!.push({id:'foresight',kind:'foresight',owner:'you'},{id:'hindsight',kind:'hindsight',owner:'you'});
  Object.assign(game.rocks[1]!,{x:16,y:0});game.rocks[1]!.specialists!.push({id:'victim',kind:'foreman',owner:'you'});
  Object.assign(game.rocks[10]!,{x:50,y:0});game.rocks[10]!.specialists!.push({id:'assassin',kind:'assassin',owner:'vesper'});
  let operation={game,archive:createArchive(game,{rivals:false})};
  const plan={id:'golden-threat-0001',from:game.rocks[10]!.id,to:game.rocks[1]!.id,drones:1,specialists:['assassin'],executeAt:25};
  operation=applyCommand(operation.archive,{type:'schedule',owner:'vesper',plan},{rivals:false,knownThrough:24});
  operation=applyCommand(operation.archive,{type:'cancel-schedule',owner:'vesper',id:plan.id},{rivals:false,knownThrough:24.5});
  operation=applyCommand(operation.archive,{type:'schedule',owner:'vesper',plan:{...plan,id:'golden-threat-0002',executeAt:25.25}},{rivals:false,knownThrough:24.5});
  operation={...operation,game:advance(operation.game,31,{rivals:false})};
  return operation;
}

// Frozen integrated #200 source before export optimization; equal-hour causal states must survive.
for (const [schema, generate, expected] of [
  [1, generateSharedReplay, 'e1e1c42461cad62d5ade159a450f33b4a73ab0dd3e7a4ac151a6727bcbe2fcc0'],
  [3, generatePackedReplay, '0f31d42951851b13efa64f3ecf93a8693247bf6546ff9bc41969c9d3acd30547'],
] as const) test(`schema ${schema} retains exact warning, discovery, and equal-hour command history`, () => {
  const operation = threatenedHistory(), before = structuredClone(operation.game);
  const artifact = generate(operation, 'you', 24, 31), raw = encodeReplayArtifact(artifact);
  assert.equal(createHash('sha256').update(raw).digest('hex'), expected);
  assert.equal(artifact.groups.find(group => group.hour === 24.5)!.states.length, 3);
  assert.equal(seekReplayArtifact(artifact, 31).hour, 31);
  assert.deepEqual(operation.game, before);
});

test('replay recorders publish no artifact when the supplied frontier is noncanonical', () => {
  const operation = threatenedHistory();
  operation.game.cargo.you! += 1;
  for (const generate of [generateSharedReplay, generatePackedReplay]) {
    assert.throws(() => generate(operation, 'you', 24, 31), /damaged or does not match/);
  }
});
