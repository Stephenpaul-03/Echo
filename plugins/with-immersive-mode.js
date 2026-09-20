const { withAndroidManifest, withMainActivity } = require('@expo/config-plugins');

module.exports = function withImmersiveMode(config) {
  config = withAndroidManifest(config, (mod) => {
    const mainActivity = mod.modResults.manifest.application?.[0]?.activity?.find((activity) => activity.$['android:name'] === '.MainActivity');
    return mod;
  });
  return withMainActivity(config, (mod) => {
    if (mod.modResults.language !== 'kt') return mod;

    let source = mod.modResults.contents;
    if (!source.includes('import android.view.WindowInsetsController')) {
      source = source.replace(
        'import android.os.Bundle',
        `import android.os.Bundle
import android.view.View
import android.view.WindowInsets
import android.view.WindowInsetsController`,
      );
    }

    if (!source.includes('private fun hideSystemBars()')) {
      source = source.replace(
        '  override fun getMainComponentName()',
        `  override fun onWindowFocusChanged(hasFocus: Boolean) {
    super.onWindowFocusChanged(hasFocus)
    if (hasFocus) hideSystemBars()
  }

  @Suppress("DEPRECATION")
  private fun hideSystemBars() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      window.insetsController?.apply {
        hide(WindowInsets.Type.statusBars() or WindowInsets.Type.navigationBars())
        systemBarsBehavior = WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
      }
    } else {
      window.decorView.systemUiVisibility =
        View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY or
        View.SYSTEM_UI_FLAG_FULLSCREEN or
        View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or
        View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN or
        View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION or
        View.SYSTEM_UI_FLAG_LAYOUT_STABLE
    }

  }

  override fun getMainComponentName()`,
      );
    }

    if (!source.includes('override fun onResume()')) {
      source = source.replace(
        '  override fun onWindowFocusChanged(hasFocus: Boolean)',
        `  override fun onResume() {
    super.onResume()
    hideSystemBars()
  }

  override fun onWindowFocusChanged(hasFocus: Boolean)`,
      );
    }

    mod.modResults.contents = source;
    return mod;
  });
};
