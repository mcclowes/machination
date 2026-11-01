/** Client boundary supporting legacy and packed files without expanding whole timelines. */
import { encodeSharedReplay, parseReplayJson, validateSharedReplay } from './codec';
import { encodePackedReplay, validatePackedReplay, seekPackedReplay, type PackedReplay } from './packed';
import { seekReplay } from './playback';
import type { SharedReplay } from './timeline';

export type ReplayArtifact = SharedReplay | PackedReplay;
export function decodeReplayArtifact(raw: string): ReplayArtifact {
  const value = parseReplayJson(raw);
  if (value && typeof value === 'object' && 'schemaVersion' in value && value.schemaVersion === 3) {
    validatePackedReplay(value); return value;
  }
  validateSharedReplay(value); return value;
}
export function encodeReplayArtifact(value: ReplayArtifact): string {
  const schema = Object.getOwnPropertyDescriptor(value, 'schemaVersion');
  // Dispatch without invoking a getter; the selected codec inspects every descriptor before reading data.
  return schema && 'value' in schema && schema.value === 3
    ? encodePackedReplay(value as PackedReplay)
    : encodeSharedReplay(value as SharedReplay);
}
export function seekReplayArtifact(value: ReplayArtifact, hour: number, ordinal?: number) {
  return value.schemaVersion === 3 ? seekPackedReplay(value, hour, ordinal) : seekReplay(value, hour, ordinal);
}
export function replayArtifactRules(value: ReplayArtifact) {
  return value.schemaVersion === 3 ? value.rules : value.groups[0]?.states[0]?.rules;
}
