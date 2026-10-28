/** Keep secure and ordinary iOS fields from sharing a recycled native text-input view. */
const { withXcodeProject, IOSConfig } = require('expo/config-plugins');
const { readFileSync, writeFileSync } = require('node:fs');
const path = require('node:path');
const filename = 'MachinationTextInputIdentity.mm';
function assertCompatible(factory, input) {
  if (!/\.shouldBeRecycled\s*=\s*\[viewClass respondsToSelector:@selector\(shouldBeRecycled\)\]/.test(factory)
    || !/@implementation RCTTextInputComponentView\b/.test(input)
    || /^\+\s*\([^\n]+\)\s*shouldBeRecycled\b/m.test(input)) {
    throw new Error('Review the Machination iOS input-identity plugin against this React Native recycling implementation.');
  }
}
module.exports = config => withXcodeProject(config, mod => {
  const reactNative = path.dirname(require.resolve('react-native/package.json', { paths: [mod.modRequest.projectRoot] }));
  const mounting = path.join(reactNative, 'React/Fabric/Mounting');
  assertCompatible(readFileSync(path.join(mounting, 'RCTComponentViewFactory.mm'), 'utf8'),
    readFileSync(path.join(mounting, 'ComponentViews/TextInput/RCTTextInputComponentView.mm'), 'utf8'));
  const projectName = IOSConfig.XcodeUtils.getProjectName(mod.modRequest.projectRoot);
  writeFileSync(path.join(mod.modRequest.platformProjectRoot, projectName, filename), readFileSync(path.join(__dirname, 'ios', filename)));
  const filepath = `${projectName}/${filename}`;
  IOSConfig.XcodeUtils.addBuildSourceFileToGroup({ filepath, groupName: projectName, project: mod.modResults });
  const reference = Object.values(mod.modResults.pbxFileReferenceSection()).find(value => value && typeof value.path === 'string' && IOSConfig.XcodeUtils.unquote(value.path) === filepath);
  if (!reference) throw new Error('The Machination native input source was not registered.');
  // Expo's Xcode helper does not infer Objective-C++ for .mm files.
  reference.lastKnownFileType = 'sourcecode.cpp.objcpp';
  reference.includeInIndex = 1;
  delete reference.fileEncoding;
  delete reference.explicitFileType;
  return mod;
});
module.exports.assertCompatible = assertCompatible;
