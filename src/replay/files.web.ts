import { checkReplayFileSize, checkReplayText, ReplayFileError, replayFileFailure, replayFileName } from './file-errors';

export { ReplayFileError } from './file-errors';

/** Call directly from a user gesture. Saved means a download was requested. */
export async function saveSharedReplay(raw: string, name: string): Promise<'saved' | 'cancelled'> {
  checkReplayText(raw);
  if (typeof document === 'undefined' || typeof URL.createObjectURL !== 'function') throw new ReplayFileError('unavailable');
  let url: string | undefined;
  let anchor: HTMLAnchorElement | undefined;
  try {
    url = URL.createObjectURL(new Blob([raw], { type: 'application/json' }));
    anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = replayFileName(name);
    document.body.appendChild(anchor);
    anchor.click();
    return 'saved';
  } catch (error) {
    throw replayFileFailure(error);
  } finally {
    anchor?.remove();
    // Let the browser consume the download before releasing the object URL.
    if (url) { const released = url; setTimeout(() => URL.revokeObjectURL(released), 0); }
  }
}

/** Call directly from a user gesture; no URL import or network read is supported. */
export function pickSharedReplay(): Promise<string | null> {
  if (typeof document === 'undefined') return Promise.reject(new ReplayFileError('unavailable'));
  return new Promise((resolve, reject) => {
    let input: HTMLInputElement;
    const cleanup = () => input?.remove();
    try {
      input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json,application/json';
      input.multiple = false;
      input.hidden = true;
      input.oncancel = () => { cleanup(); resolve(null); };
      input.onchange = async () => {
        try {
          const file = input.files?.[0];
          if (!file) { resolve(null); return; }
          checkReplayFileSize(file.size);
          const raw = await file.text();
          checkReplayText(raw);
          resolve(raw);
        } catch (error) { reject(replayFileFailure(error)); }
        finally { cleanup(); }
      };
      document.body.appendChild(input);
      input.click();
    } catch (error) { cleanup(); reject(replayFileFailure(error)); }
  });
}
