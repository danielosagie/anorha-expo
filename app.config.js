export default {
  name: "Anorha",
  slug: "sssync", //DONT CHANGE AT ALL EVER - Need for production builds
  owner: process.env.EAS_BUILD ? "dosagie" : undefined,
  version: "1.0.3",
  scheme: "anorhaapp",
  // EAS Update (OTA): JS-only fixes can be pushed to installed builds via `eas update --channel
  // production` — no rebuild. fallbackToCacheTimeout:0 = never block launch on the update check
  // (use the embedded bundle immediately, fetch in the background for next launch). The
  // "fingerprint" runtimeVersion ties an update to the native fingerprint, so a JS update only
  // lands on builds with matching native code; adding a native dep changes the fingerprint and
  // correctly forces a new build instead of pushing incompatible JS.
  updates: {
    url: "https://u.expo.dev/b69b9883-c163-494e-aa0a-54b0e70feb3b",
    fallbackToCacheTimeout: 0,
  },
  runtimeVersion: { policy: "fingerprint" },
  icon: "./src/assets/1024_anorha.png",
  orientation: "portrait",
  android: {
    package: "anorha.alpha",
    versionCode: 1,
    orientation: "portrait",
    permissions: [
      "android.permission.CAMERA",
      "android.permission.RECORD_AUDIO"
    ],
    adaptiveIcon: {
      foregroundImage: "./src/assets/1024_anorha.png",
      backgroundColor: "#FFFFFF"
    }
  },
  ios: {
    bundleIdentifier: "anorha.alpha",
    supportsTablet: true,
    // Config-driven build number: with appVersionSource "local", BOTH the app and the
    // expo-widgets ExpoWidgetsTarget read this same value, so their CFBundleVersions match
    // (remote autoIncrement only stamped the app target → widget stayed at "2" → ITMS-90473).
    // Bump this each App Store submission. (Was on remote autoIncrement at build 55.)
    buildNumber: "58",
    icon: "./src/assets/1024_anorha.png",
    infoPlist: {
      ITSAppUsesNonExemptEncryption: false,
      NSLocationWhenInUseUsageDescription: "Anorha may access your location to provide enhanced features through third-party services. Location access is optional and can be disabled in your device settings."
    }
  },
  assetBundlePatterns: [
    "**/*.{ttf,png,jpg,jpeg,gif,webp,svg}"
  ],
  plugins: [
    [
      "@sentry/react-native/expo",
      {
        // Source-map / debug-symbol upload target. Auth token is supplied at
        // build time via the SENTRY_AUTH_TOKEN env var (never committed).
        // NOTE: org slug per Sentry's wizard command was "dosagie" — change to
        // "inirha" here if that's actually your org.
        organization: "inirha",
        project: "anorha-expo"
      }
    ],
    [
      "expo-camera",
      {
        cameraPermission: "Allow Anorha to access your camera",
        microphonePermission: "Allow Anorha to access your microphone",
        recordAudioAndroid: true
      }
    ],
    [
      "expo-splash-screen",
      {
        backgroundColor: "#FFF9EB",
        image: "./src/assets/anorha_logo.png",
        resizeMode: "contain",
        imageWidth: 200,
        dark: {
          image: "./src/assets/anorha_logo.png"
        }
      }
    ],
    "expo-asset",
    "expo-audio",
    "expo-font",
    "expo-localization",
    "expo-sharing",
    "expo-web-browser",
    "expo-secure-store",
    [
      "expo-widgets",
      {
        enablePushNotifications: true,
        widgets: [
          {
            name: "BulkJobActivity",
            displayName: "Bulk Job Activity",
            description: "Shows progress for bulk match and generate jobs.",
            supportedFamilies: [
              "systemSmall"
            ]
          }
        ]
      }
    ]
  ],
  extra: {
    supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL,
    supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
    eas: { projectId: "b69b9883-c163-494e-aa0a-54b0e70feb3b" }
  }
};
