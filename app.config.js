export default {
  name: "Anorha",
  slug: "sssync", //DONT CHANGE AT ALL EVER - Need for production builds
  owner: "anorha",
  version: "1.0.2",
  scheme: "anorhaapp",
  android: {
    package: "anorha.alpha",
    permissions: [
      "android.permission.CAMERA",
      "android.permission.RECORD_AUDIO"
    ]
  },
  ios: {
    bundleIdentifier: "anorha.alpha",
    supportsTablet: true,
    buildNumber: "2",
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
      "expo-camera",
      {
        cameraPermission: "Allow Anorha to access your camera",
        microphonePermission: "Allow Anorha to access your microphone",
        recordAudioAndroid: true
      }
    ],
    [
      "react-native-vision-camera",
      {
        enableCodeScanner: true
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
    "expo-font",
    "expo-web-browser",
    "expo-secure-store"
  ],
  extra: {
    supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL,
    supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
    eas: {
      projectId: "b69b9883-c163-494e-aa0a-54b0e70feb3b"
    }
  }
};