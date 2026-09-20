const { withGradleProperties } = require('@expo/config-plugins');

module.exports = function withAndroidReleaseOptimization(config) {
  return withGradleProperties(config, (mod) => {
    const properties = mod.modResults;
    const setProperty = (key, value) => {
      const existing = properties.find((property) => property.type === 'property' && property.key === key);
      if (existing) existing.value = value;
      else properties.push({ type: 'property', key, value });
    };

    // Ship a phone-sized APK by default. Emulator builds can override this with
    // -PreactNativeArchitectures=x86_64 when needed.
    setProperty('reactNativeArchitectures', 'arm64-v8a');
    setProperty('android.enableMinifyInReleaseBuilds', 'true');
    setProperty('android.enableShrinkResourcesInReleaseBuilds', 'true');
    setProperty('EX_DEV_CLIENT_NETWORK_INSPECTOR', 'false');

    return mod;
  });
};
