/** Scheduled effects must not run ahead of the selected boundary in revision 5. */
import { mechanicsVersion, type GameRules } from './rules';
export function isDue(game: { hour: number; rules?: GameRules }, due: number): boolean {
  return due <= game.hour + (mechanicsVersion(game) >= 5 ? 0 : 1e-9);
}
