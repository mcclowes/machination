import * as DocumentPicker from 'expo-document-picker';
import { Directory, File, Paths } from 'expo-file-system';
import { randomUUID } from 'expo-crypto';
import * as Sharing from 'expo-sharing';
import { checkReplayFileSize, checkReplayText, ReplayFileError, replayFileFailure, replayFileName } from './file-errors';

export { ReplayFileError } from './file-errors';

/** Explicit action only. Expo cannot distinguish dismissal from completed sharing. */
export async function saveSharedReplay(raw: string, name: string): Promise<'saved' | 'cancelled'> {
  let directory: Directory | undefined;
  let failure: ReplayFileError | undefined;
  try {
    checkReplayText(raw);
    if (!await Sharing.isAvailableAsync()) throw new ReplayFileError('unavailable');
    directory = new Directory(Paths.cache, `replay-${randomUUID()}`);
    directory.create();
    const file = new File(directory, replayFileName(name));
    file.create();
    file.write(raw);
    await Sharing.shareAsync(file.uri, { mimeType: 'application/json', UTI: 'public.json' });
  } catch (error) {
    failure = replayFileFailure(error);
  } finally {
    try { if (directory?.exists) directory.delete(); }
    catch { failure ??= new ReplayFileError('io'); }
  }
  if (failure) throw failure;
  return 'saved';
}

/** Reads only a user-selected local cache copy; format validation belongs to codec.ts. */
export async function pickSharedReplay(): Promise<string | null> {
  let file: File | undefined;
  let failure: ReplayFileError | undefined;
  let raw: string | null = null;
  try {
    const result = await DocumentPicker.getDocumentAsync({ type: '*/*', multiple: false, copyToCacheDirectory: true });
    if (result.canceled) return null;
    const asset = result.assets[0];
    if (!asset) throw new ReplayFileError('io');
    // Never read URLs, provider originals, or paths outside the picker cache copy.
    const cache = `${Paths.cache.uri.replace(/\/$/, '')}/`;
    if (!asset.uri.startsWith(cache) || /(?:^|\/)\.\.(?:\/|$)|%2e|%2f|%5c/i.test(asset.uri.slice(cache.length))) throw new ReplayFileError('io');
    file = new File(asset.uri);
    if (asset.size !== undefined) checkReplayFileSize(asset.size);
    if (!file.exists) throw new ReplayFileError('io');
    checkReplayFileSize(file.size);
    raw = await file.text();
    checkReplayFileSize(file.size);
    checkReplayText(raw);
  } catch (error) {
    failure = replayFileFailure(error);
  } finally {
    try { if (file?.exists) file.delete(); }
    catch { failure ??= new ReplayFileError('io'); }
  }
  if (failure) throw failure;
  return raw;
}
