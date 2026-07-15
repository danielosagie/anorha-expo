export default {
  name: "Anorha",
  slug: "sssync", //DONT CHANGE AT ALL EVER - Need for production builds
  owner: process.env.EAS_BUILD ? "dosagie" : undefined,
  version: "1.0.3",
  scheme: "anorhaapp",
  // EAS Update (OTA): JS-only fixes ship to installed builds via `eas update --channel production`
  // — no rebuild. fallbackToCacheTimeout:0 = never block launch on the update check (embedded
  // bundle now, fetch in background for next launch).
  // runtimeVersion uses the "appVersion" policy (= the marketing `version`, "1.0.3") instead of
  // "fingerprint": fingerprint is computed twice with `eas build --local` (local CLI vs the build's
  // copied file set) and the two diverge → "Runtime version calculated on local machine not equal
  // to ... during build" build failure. appVersion is deterministic everywhere. CAVEAT: an OTA then
  // targets ALL builds of this marketing version, so if you ADD/CHANGE A NATIVE DEPENDENCY you MUST
  // bump `version` (new runtime) before publishing an OTA, or the JS update could land on a build
  // without the native module. JS-only fixes are always safe to OTA.
  updates: {
    url: "https://u.expo.dev/b69b9883-c163-494e-aa0a-54b0e70feb3b",
    fallbackToCacheTimeout: 0,
  },
  runtimeVersion: { policy: "appVersion" },
  icon: "./src/assets/1024_anorha.png",
  orientation: "portrait",
  android: {
    package: "anorha.alpha",
    versionCode: 10,
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
    buildNumber: "67",
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
    // Clerk native: its config plugin raises the iOS deployment target to 17.0 so the
    // ClerkExpo pod (Clerk iOS SDK, requires iOS 17) actually installs. Without this in the
    // plugins array the target stays at 15.1, CocoaPods skips ClerkExpo, and the autolinked
    // `import ClerkExpo` fails to compile ("no such module 'ClerkExpo'").
    "@clerk/expo",
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
    [
      "expo-audio",
      {
        enableBackgroundPlayback: true,
        enableBackgroundRecording: false
      }
    ],
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
