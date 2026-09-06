import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.vendrov.pintball',
  appName: 'Pintball Survivor',
  webDir: 'dist',
  android: {
    // Keeps the WebView from resizing (and re-laying out the canvas) when the
    // system keyboard or navigation bar animates.
    adjustMarginsForEdgeToEdge: 'auto',
    backgroundColor: '#07090f',
  },
  ios: {
    contentInset: 'never',
    backgroundColor: '#07090f',
    // The game handles its own safe-area padding via env(safe-area-inset-*).
    scrollEnabled: false,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 900,
      launchAutoHide: true,
      backgroundColor: '#07090f',
      androidScaleType: 'CENTER_CROP',
      showSpinner: false,
      splashFullScreen: true,
      splashImmersive: true,
    },
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#07090f',
      overlaysWebView: true,
    },
  },
};

export default config;
