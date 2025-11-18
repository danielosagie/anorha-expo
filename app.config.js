export default {
  name: "Anorha",
  slug: "sssync",
  owner: "anorha",
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
    buildNumber: "1",
    icon: "./src/assets/anorha_logo.png",
    infoPlist: {
      ITSAppUsesNonExemptEncryption: false
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
      "@react-native-google-signin/google-signin",
      { iosUrlScheme: "com.googleusercontent.apps._some_id_here_" }
    ],
    [
      "expo-splash-screen",
      {
        backgroundColor: "#200030",
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