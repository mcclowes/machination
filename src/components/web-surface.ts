/**
 * ---
 * purpose: Make the browser build behave like an installed app rather than a document.
 * ---
 */

export const WEB_SURFACE_ID = 'machination-web-surface';

/**
 * Browser defaults that read as "web page": rubber-band page scroll, grey tap
 * flashes, long-press callouts, selectable interface text, double-tap zoom,
 * mouse-focus rings, and wide system scrollbars. Typed fields and text marked
 * `selectable` stay selectable.
 */
export const WEB_SURFACE_CSS = `
html, body, #root { height: 100%; overflow: hidden; overscroll-behavior: none; background: #080f0d; }
body {
  -webkit-tap-highlight-color: transparent;
  -webkit-touch-callout: none;
  -webkit-user-select: none;
  user-select: none;
  touch-action: manipulation;
  -webkit-font-smoothing: antialiased;
}
input, textarea, [contenteditable="true"] { -webkit-user-select: text; user-select: text; -webkit-touch-callout: default; }
img { -webkit-user-drag: none; }
:focus:not(:focus-visible) { outline: none; }
* { scrollbar-width: thin; scrollbar-color: #30454c transparent; }
::-webkit-scrollbar { width: 6px; height: 6px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: #30454c; border-radius: 3px; }
@media (prefers-reduced-motion: no-preference) {
  [role="button"]:not([aria-disabled="true"]):not([style*="transform"]),
  [role="tab"]:not([style*="transform"]) { transition: transform 110ms cubic-bezier(.2,.8,.2,1), filter 110ms ease-out; }
  [role="button"]:not([aria-disabled="true"]):not([style*="transform"]):active,
  [role="tab"]:not([style*="transform"]):active { transform: scale(0.96); filter: brightness(1.2); transition-duration: 40ms; }
}
`;

/** Installs the app surface once. Returns whether a stylesheet was added. */
export function installWebSurface(platform: string, doc: Pick<Document, 'getElementById' | 'createElement' | 'head'> | undefined = globalThis.document): boolean {
  if (platform !== 'web' || !doc?.head || doc.getElementById(WEB_SURFACE_ID)) return false;
  const style = doc.createElement('style');
  style.id = WEB_SURFACE_ID;
  style.textContent = WEB_SURFACE_CSS;
  doc.head.appendChild(style);
  return true;
}
