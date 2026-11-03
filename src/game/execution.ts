/** Consume the same resumable rules synchronously for authoritative callers. */
export function finishSteps<T>(work: Generator<void, T, unknown>): T {
  let result = work.next();
  while (!result.done) result = work.next();
  return result.value;
}
