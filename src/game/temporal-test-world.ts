/** Small fixed chart for temporal engine, server, and replay scenarios. */
import type { Game } from './simulation';
import { createConfiguredGame } from './world';

export function temporalWorld(): Game {
  const game = createConfiguredGame({ playerCount: 2, mode: 'mining' }, 0, 19);
  game.hour = 24;
  game.rules!.map = { generator: 'balanced.v1', seed: 19, width: 500, height: 500 };
  for (const [i, rock] of game.rocks.entries()) {
    rock.x = 200 + i * 5; rock.y = 200;
    rock.owner = null; rock.specialists = []; delete rock.coreOf;
    rock.kind = 'generator'; rock.shield = 0; rock.shieldMax = 10; rock.shieldsDisabled = true;
    rock.shieldAt = 1000; rock.productionAt = 1000; delete rock.drift;
  }
  Object.assign(game.rocks[0]!, { x: 0, y: 0, drones: 40, owner: 'you', coreOf: 'you', specialists: [{ id: 'core-you', kind: 'queen', owner: 'you' }] });
  Object.assign(game.rocks[1]!, { x: 100, y: 0, drones: 40, owner: 'you' });
  Object.assign(game.rocks[10]!, { x: 50, y: 80, drones: 40, owner: 'vesper', coreOf: 'vesper', specialists: [{ id: 'core-vesper', kind: 'queen', owner: 'vesper' }] });
  game.rocks[2]!.owner = 'you';
  delete game.rivalPolicy;
  return game;
}
