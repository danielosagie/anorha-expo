import { AppState } from 'react-native'
import 'react-native-url-polyfill/auto'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { createClient } from '@supabase/supabase-js'
import Constants from 'expo-constants'
import { env } from '.env'

// Get the environment variables from Expo's manifest
const supabaseUrl = Constants.expoConfig?.extra?.supabaseUrl || 
                   'https://pqmxhoxffarcvaxeakwo.supabase.co'
const supabaseAnonKey = Constants.expoConfig?.extra?.supabaseAnonKey || 
                       'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBxbXhob3hmZmFyY3ZheGVha3dvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDQwNDk0OTIsImV4cCI6MjA1OTYyNTQ5Mn0.QKPCYWkvD9rlN1Nl_6pQMKpforqeta4NSedwHyWoeG0'

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
})

// Tells Supabase Auth to continuously refresh the session automatically
// if the app is in the foreground. When this is added, you will continue
// to receive `onAuthStateChange` events with the `TOKEN_REFRESHED` or
// `SIGNED_OUT` event if the user's session is terminated. This should
// only be registered once.
AppState.addEventListener('change', (state) => {
  if (state === 'active') {
    supabase.auth.startAutoRefresh()
  } else {
    supabase.auth.stopAutoRefresh()
  }
})