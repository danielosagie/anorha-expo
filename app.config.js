export default {
  expo: {
    name: "sssync",
    slug: "sssync",
    android: {
      package: "com.sssync.app",
      permissions: [
        "android.permission.CAMERA",
        "android.permission.RECORD_AUDIO"
      ]
    },
    plugins: [
      [
        "react-native-vision-camera",
        {
          "cameraPermissionText": "sssync needs access to your Camera.",
          "enableMicrophonePermission": true,
          "microphonePermissionText": "sssync needs access to your Microphone."
        }
      ]
    ],
    extra: {
      supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL,
      supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
      eas: {
        projectId: "your-project-id"
      }
    }
  }
}; 