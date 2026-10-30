import { DIPLOMACY_LIMITS, type ObjectReference } from '../contracts/protocol';

// Canonical JS numbers need at most 24 characters; leave room for the fixed fields.
const MAX_TOKEN_LENGTH = 160;
const TOKEN = /^\[\[machination:v1:([0-9a-f]{24}):(outpost|hauler):([0-9a-f]{64}):([^\]\s]{1,24})\]\]$/;

export function parseObjectReference(text: string): ObjectReference | undefined {
  if (text.length > MAX_TOKEN_LENGTH) return undefined;
  const match = TOKEN.exec(text);
  if (!match || match[0] !== text) return undefined;
  const hour = Number(match[4]);
  if (!Number.isFinite(hour) || hour < 0 || String(hour) !== match[4]) return undefined;
  return { version: 1, gameId: match[1]!, kind: match[2] as ObjectReference['kind'], ref: match[3]!, hour };
}

export function encodeObjectReference(reference: ObjectReference): string {
  if (!reference || reference.version !== 1 || typeof reference.gameId !== 'string' || typeof reference.ref !== 'string' || typeof reference.kind !== 'string' || typeof reference.hour !== 'number' || Object.is(reference.hour, -0)) throw new Error('Invalid object reference');
  const text = `[[machination:v1:${reference.gameId}:${reference.kind}:${reference.ref}:${reference.hour}]]`;
  if (!parseObjectReference(text)) throw new Error('Invalid object reference');
  return text;
}

export function splitObjectReferences(text: string): { text: string; reference?: ObjectReference }[] {
  if (text.length > DIPLOMACY_LIMITS.text) return [{ text }];
  const parts: { text: string; reference?: ObjectReference }[] = [];
  let plainStart = 0;
  let candidateStart = -1;
  for (let index = 0; index < text.length - 1; index++) {
    if (candidateStart < 0) {
      if (text[index] === '[' && text[index + 1] === '[') { candidateStart = index; index++; }
    } else if (text[index] === ']' && text[index + 1] === ']') {
      const end = index + 2;
      if (end - candidateStart <= MAX_TOKEN_LENGTH) {
        const token = text.slice(candidateStart, end);
        const reference = parseObjectReference(token);
        if (reference) {
          if (candidateStart > plainStart) parts.push({ text: text.slice(plainStart, candidateStart) });
          parts.push({ text: token, reference });
          plainStart = end;
        }
      }
      candidateStart = -1;
      index++;
    }
  }
  if (plainStart < text.length || parts.length === 0) parts.push({ text: text.slice(plainStart) });
  return parts;
}
