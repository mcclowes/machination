/** Attach the React window to a UIKit scene on iOS 15.1 and later. */
const { withAppDelegate, withInfoPlist } = require('expo/config-plugins');
const marker = '// machination-scene-lifecycle';
const startup = /#if os\(iOS\) \|\| os\(tvOS\)\s+window = UIWindow\(frame: UIScreen\.main\.bounds\)\s+factory\.startReactNative\(\s+withModuleName: "main",\s+in: window,\s+launchOptions: launchOptions\)\s+#endif/;
const sceneManifest = {
  UIApplicationSupportsMultipleScenes: false,
  UISceneConfigurations: {
    UIWindowSceneSessionRoleApplication: [{
      UISceneConfigurationName: 'Machination',
      UISceneDelegateClassName: '$(PRODUCT_MODULE_NAME).MachinationSceneDelegate',
    }],
  },
};
const sceneDelegate = `
${marker}
class MachinationSceneDelegate: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?

  private var appDelegate: AppDelegate {
    UIApplication.shared.delegate as! AppDelegate
  }

  func scene(
    _ scene: UIScene,
    willConnectTo session: UISceneSession,
    options connectionOptions: UIScene.ConnectionOptions
  ) {
    guard let windowScene = scene as? UIWindowScene,
          let factory = appDelegate.reactNativeFactory else { return }
    let window = UIWindow(windowScene: windowScene)
    self.window = window
    appDelegate.window = window
    var launchOptions = appDelegate.launchOptionsForScene ?? [:]
    if let context = connectionOptions.urlContexts.first {
      launchOptions[.url] = context.url
      launchOptions[.sourceApplication] = context.options.sourceApplication
    }
    if let activity = connectionOptions.userActivities.first {
      launchOptions[.userActivityDictionary] = [
        "UIApplicationLaunchOptionsUserActivityTypeKey": activity.activityType,
        "UIApplicationLaunchOptionsUserActivityKey": activity
      ]
    }
    factory.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: launchOptions)
  }

  func sceneDidBecomeActive(_ scene: UIScene) {
    appDelegate.applicationDidBecomeActive(UIApplication.shared)
  }

  func sceneWillResignActive(_ scene: UIScene) {
    appDelegate.applicationWillResignActive(UIApplication.shared)
  }

  func sceneWillEnterForeground(_ scene: UIScene) {
    appDelegate.applicationWillEnterForeground(UIApplication.shared)
  }

  func sceneDidEnterBackground(_ scene: UIScene) {
    appDelegate.applicationDidEnterBackground(UIApplication.shared)
  }

  func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
    for context in URLContexts {
      _ = appDelegate.application(UIApplication.shared, open: context.url, options: [
        .openInPlace: context.options.openInPlace,
        .sourceApplication: context.options.sourceApplication as Any
      ])
    }
  }

  func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
    _ = appDelegate.application(UIApplication.shared, continue: userActivity, restorationHandler: { _ in })
  }
}
`;
function patchAppDelegate(source) {
  if (source.includes(marker)) return source;
  if (!startup.test(source) || !source.includes('var window: UIWindow?')) throw new Error('Unsupported Expo startup template for Machination scene lifecycle.');
  return source.replace('var window: UIWindow?', 'var window: UIWindow?\n  var launchOptionsForScene: [UIApplication.LaunchOptionsKey: Any]?')
    .replace(startup, '    launchOptionsForScene = launchOptions') + sceneDelegate;
}
module.exports = config => {
  config = withInfoPlist(config, mod => {
    mod.modResults.UIApplicationSceneManifest = sceneManifest;
    return mod;
  });
  return withAppDelegate(config, mod => {
    if (mod.modResults.language !== 'swift') throw new Error('Machination scene lifecycle requires a Swift AppDelegate.');
    mod.modResults.contents = patchAppDelegate(mod.modResults.contents);
    return mod;
  });
};
module.exports.patchAppDelegate = patchAppDelegate;
module.exports.sceneManifest = sceneManifest;
