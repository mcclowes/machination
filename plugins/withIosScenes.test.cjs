const { test } = require('node:test');
const assert = require('node:assert/strict');
const { patchAppDelegate, sceneManifest } = require('./withIosScenes.cjs');
const source = `class AppDelegate: ExpoAppDelegate {
  var window: UIWindow?
  public override func application() -> Bool {
    reactNativeFactory = factory
#if os(iOS) || os(tvOS)
    window = UIWindow(frame: UIScreen.main.bounds)
    factory.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: launchOptions)
#endif
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }
}`;
test('scene migration moves window creation out of process launch and survives regeneration', () => {
  const patched = patchAppDelegate(source);
  assert.equal(patchAppDelegate(patched), patched);
  const processLaunch = patched.slice(0, patched.indexOf('class MachinationSceneDelegate'));
  assert.ok(!processLaunch.includes('UIWindow(frame:'));
  assert.ok(processLaunch.includes('reactNativeFactory = factory'));
  assert.ok(processLaunch.includes('super.application(application, didFinishLaunchingWithOptions: launchOptions)'));
  assert.ok(patched.includes('UIWindow(windowScene: windowScene)'));
  assert.ok(patched.includes('factory.startReactNative('));
  assert.ok(patched.includes('appDelegate.applicationDidEnterBackground(UIApplication.shared)'));
});
test('scene manifest registers the matching single-window delegate', () => {
  assert.equal(sceneManifest.UIApplicationSupportsMultipleScenes, false);
  assert.equal(sceneManifest.UISceneConfigurations.UIWindowSceneSessionRoleApplication[0].UISceneDelegateClassName, '$(PRODUCT_MODULE_NAME).MachinationSceneDelegate');
});
test('unsupported startup templates fail explicitly', () => {
  assert.throws(() => patchAppDelegate('class CustomAppDelegate {}'), /startup/);
});
