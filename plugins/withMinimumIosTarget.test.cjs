const { test } = require('node:test');
const assert = require('node:assert/strict');
const { patchPodfile } = require('./withMinimumIosTarget.cjs');
const podfile = 'target "Machination" do\n  post_install do |installer|\n    react_native_post_install(installer)\n  end\nend\n';
test('prebuild preserves the native post-install hook and is idempotent', () => {
  const once = patchPodfile(podfile);
  assert.equal(patchPodfile(once), once);
  assert.ok(once.includes('react_native_post_install(installer)'));
  assert.equal(once.match(/machination-minimum-ios-target/g).length, 1);
  assert.ok(once.includes('installer.pods_project.targets.each'));
});
test('an incompatible Podfile fails explicitly instead of silently omitting the fix', () => {
  assert.throws(() => patchPodfile('target "ChangedTemplate" do\nend'), /post_install/);
});
