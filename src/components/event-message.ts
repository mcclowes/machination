/** Display telemetry without changing canonical saved event history. */
import type { GameView } from '../game/visibility';
import { playersIn } from '../game/players';
import { FACTIONS } from '../game/simulation';
import { displaySpecialistNames } from '../game/specialist-catalog';

export function eventMessage(view: Pick<GameView, 'hour' | 'winner' | 'eliminated' | 'rules'>, event: { hour: number; message: string }): string {
  const message = displaySpecialistNames(event.message);
  if (!view.winner || event.hour !== view.hour) return message;
  const active = playersIn(view).filter(owner => !view.eliminated.includes(owner));
  if (active.length !== 1 || active[0] !== view.winner) return message;
  const name = FACTIONS[view.winner].name;
  const victoryMessages = ['corporate quota secured', 'domination target secured'].map(claim => `${name}: ${claim}. Contract complete.`);
  // Existing archives retain their original mode-based victory prose.
  if (victoryMessages.includes(event.message)) return `${name}: last intelligence active. Contract complete.`;
  return message;
}
