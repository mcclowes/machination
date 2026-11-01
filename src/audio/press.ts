/**
 * ---
 * purpose: Choose a control's press cue from its label and role, and route it to whichever player is installed.
 * ---
 */
import type { SoundCue } from './sound-cues';

export type PressCue = Extract<SoundCue, 'tap' | 'select' | 'back' | 'confirm' | 'time'>;
export type PressDescription = {
  accessibilityLabel?: string;
  accessibilityRole?: string;
  accessibilityState?: { selected?: boolean; checked?: boolean | 'mixed' };
  children?: unknown;
};

const BACK = /^(‹|←|cancel|close|dismiss|back|exit|keep|hide|withdraw|leave|discard|collapse|done|not now|all exercises|×|✕)(?!\w)/i;
const TIME = /^(now|beginning|end|history start|previous state|next state|seek|advance|rewind|play|pause|[+−-]\s?\d+\s?[hm])(?!\w)/i;
const CONFIRM = /\b(launch|schedule|plan transfer|prepare|resolve|replace|start|send|transmit|recruit|hire|promote|confirm|resign|vote|nominate|submit|sign in|create|join|gift|fund|build|construct|install|apply|save|report|block|accept|deploy|detonate)\b/i;
const CHOICE_ROLES = new Set(['tab', 'radio', 'checkbox', 'switch', 'togglebutton', 'menuitem']);

/** The visible text of a control, so unlabeled buttons are still classified by what they say. */
export function pressText(node: unknown, depth = 0): string {
  if (depth > 6 || node == null || typeof node === 'boolean' || typeof node === 'function') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(child => pressText(child, depth + 1)).join('');
  if (typeof node === 'object' && 'props' in node) return pressText((node as { props?: { children?: unknown } }).props?.children, depth + 1);
  return '';
}

export function pressCueFor({ accessibilityLabel, accessibilityRole, accessibilityState, children }: PressDescription): PressCue {
  const label = (accessibilityLabel ?? pressText(children)).trim();
  if (BACK.test(label)) return 'back';
  if (TIME.test(label)) return 'time';
  if ((accessibilityRole && CHOICE_ROLES.has(accessibilityRole)) || accessibilityState?.selected !== undefined || accessibilityState?.checked !== undefined) return 'select';
  if (CONFIRM.test(label)) return 'confirm';
  return 'tap';
}

// Controls stay free of the native audio stack; the live app installs a player at startup.
let player: ((cue: SoundCue) => void) | null = null;
export function setPressPlayer(next: ((cue: SoundCue) => void) | null) { player = next; }
export function pressFeedback(cue: SoundCue | null) { if (cue) player?.(cue); }
