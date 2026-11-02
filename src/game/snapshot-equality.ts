/** Exact value comparison for trusted plain engine snapshots, including numeric sentinels. */
export function sameSnapshot(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object') return false;
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  if (Array.isArray(left) && left.length !== (right as unknown[]).length) return false;
  const a = left as Record<string, unknown>, b = right as Record<string, unknown>;
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  for (const key of keys) if (!Object.hasOwn(b, key) || !sameSnapshot(a[key], b[key])) return false;
  return true;
}
