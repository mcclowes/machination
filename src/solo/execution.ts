/** @format */
/** Run private engine work in short batches; only the completed value may be published. */
const BATCH_MS = 16;
export function abortIfNeeded(signal?: { readonly aborted: boolean }): void {
  if (signal?.aborted) throw new Error('Operation canceled.');
}
export async function runSteps<T>(
  work: Generator<void, T, unknown>,
  signal?: { readonly aborted: boolean },
): Promise<T> {
  try {
    // A native timer crosses the host event loop; setImmediate is a microtask in React Native.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    for (;;) {
      abortIfNeeded(signal);
      const start = performance.now();
      let result: IteratorResult<void, T>;
      do {
        abortIfNeeded(signal);
        result = work.next();
        if (result.done) return result.value;
      } while (performance.now() - start < BATCH_MS);
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  } finally {
    work.return(undefined as never);
  }
}

/** One mutation at a time, with replacement/unmount invalidating pending publication. */
export class OperationExecution {
  private generation = 0;
  private controller?: AbortController;
  constructor(private readonly changed: (busy: boolean) => void) {}
  get busy(): boolean {
    return this.controller !== undefined;
  }
  cancel(notify = true): void {
    this.generation++;
    this.controller?.abort();
    this.controller = undefined;
    if (notify) this.changed(false);
  }
  async run<T>(
    task: (signal: AbortSignal) => Promise<T>,
    publish: (value: T) => void,
  ): Promise<boolean> {
    if (this.busy) throw new Error('Wait for the current operation to finish.');
    const generation = ++this.generation;
    const controller = new AbortController();
    this.controller = controller;
    this.changed(true);
    try {
      const value = await task(controller.signal);
      if (generation === this.generation) {
        publish(value);
        return true;
      }
      return false;
    } catch (error) {
      if (generation === this.generation) throw error;
      return false;
    } finally {
      if (generation === this.generation) {
        this.controller = undefined;
        this.changed(false);
      }
    }
  }
}
