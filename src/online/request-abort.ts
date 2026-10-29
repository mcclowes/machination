function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? Object.assign(new Error('Request canceled.'), { name: 'AbortError' });
}

export function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortReason(signal);
}

/** Cancellation also bounds token retrieval, which doesn't accept an AbortSignal. */
export function abortable<T>(work: () => Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    throwIfAborted(signal);
    const cleanup = () => signal.removeEventListener('abort', stop);
    const stop = () => { cleanup(); reject(abortReason(signal)); };
    signal.addEventListener('abort', stop);
    try {
      work().then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
    } catch (error) { cleanup(); reject(error); }
  });
}
