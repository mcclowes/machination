/** Offline recovery codes contain an operation locator and a single-use secret. */
export function parseRecoveryCode(value: string): { id: string; secret: string } {
  const match = value.replace(/\s/g, '').match(/^([a-f0-9]{24})\.([a-f0-9]{64})$/);
  if (!match) throw new Error('Paste the complete recovery code saved for this operation.');
  return { id: match[1]!, secret: match[2]! };
}
export function formatRecoveryCode(id: string, secret: string): string {
  const code = `${id}.${secret}`;
  parseRecoveryCode(code);
  return code;
}
