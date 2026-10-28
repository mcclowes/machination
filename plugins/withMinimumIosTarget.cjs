/** Keep dependency resource bundles compatible with Xcode's supported iOS targets. */
const { withPodfile } = require('expo/config-plugins');
const marker = '# machination-minimum-ios-target';
const hook = /^([ \t]*)post_install do \|installer\|[ \t]*$/m;
function patchPodfile(source) {
  if (source.includes(marker)) return source;
  if (!hook.test(source)) throw new Error('Machination requires a Podfile post_install hook to set minimum iOS targets.');
  return source.replace(hook, (line, indent) => line + '\n' + [
    marker,
    "minimum_ios_target = Gem::Version.new(podfile_properties.fetch('ios.deploymentTarget', '15.1'))",
    'installer.pods_project.targets.each do |target|',
    '  target.build_configurations.each do |build_configuration|',
    "    current_target = build_configuration.build_settings['IPHONEOS_DEPLOYMENT_TARGET']",
    '    if current_target.nil? || Gem::Version.new(current_target) < minimum_ios_target',
    "      build_configuration.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = minimum_ios_target.to_s",
    '    end',
    '  end',
    'end',
  ].map(text => indent + '  ' + text).join('\n'));
}
module.exports = config => withPodfile(config, mod => {
  mod.modResults.contents = patchPodfile(mod.modResults.contents);
  return mod;
});
module.exports.patchPodfile = patchPodfile;
