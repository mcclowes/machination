import { installWebSurface } from './web-surface';

/** Metro resolves this file for the browser build only. */
export function installPlatformSurface(): void {
  installWebSurface('web');
}
