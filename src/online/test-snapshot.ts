import { createGame } from '../game/world';
import { playersIn, type Faction } from '../game/players';
import { observe } from '../game/visibility';
import type { Snapshot } from './protocol';

export function testSnapshot(id = 'operation', faction: Faction = 'you', game = createGame(0)): Snapshot {
  return {
    id, invite: 'a'.repeat(24), status: 'game.active', faction, host: faction === 'you',
    members: [...playersIn(game)], revision: 0, serverTime: 0,
    visibility: 'sensors.v1', game: observe(game, faction), messages: [],
  };
}
