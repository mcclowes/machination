import assert from 'node:assert/strict';
import { test } from 'node:test';
import { WEB_SURFACE_CSS, WEB_SURFACE_ID, installWebSurface } from './web-surface';

function fakeDocument() {
  const nodes = new Map<string, { id: string; textContent: string }>();
  const appended: { id: string; textContent: string }[] = [];
  return {
    appended,
    getElementById: (id: string) => nodes.get(id) ?? null,
    createElement: () => ({ id: '', textContent: '' }),
    head: { appendChild: (node: { id: string; textContent: string }) => { nodes.set(node.id, node); appended.push(node); return node; } },
  };
}

test('web surface installs once on web and never on native', () => {
  const doc = fakeDocument();
  assert.equal(installWebSurface('ios', doc as any), false);
  assert.equal(installWebSurface('web', doc as any), true);
  assert.equal(installWebSurface('web', doc as any), false, 'A second install is a no-op');
  assert.equal(doc.appended.length, 1);
  assert.equal(doc.appended[0]?.id, WEB_SURFACE_ID);
  assert.equal(installWebSurface('web', undefined), false, 'Server rendering without a document is safe');
});

test('web surface keeps typed fields selectable and press motion behind the reduced-motion query', () => {
  assert.match(WEB_SURFACE_CSS, /overscroll-behavior: none/);
  assert.match(WEB_SURFACE_CSS, /input, textarea[^{]*\{[^}]*user-select: text/);
  const motion = WEB_SURFACE_CSS.indexOf('@media (prefers-reduced-motion: no-preference)');
  assert.ok(motion > 0 && WEB_SURFACE_CSS.indexOf(':active') > motion, 'Press scaling only applies when motion is allowed');
  assert.match(WEB_SURFACE_CSS, /:not\(\[style\*="transform"\]\)/, 'Controls that position themselves with transforms are left alone');
});
