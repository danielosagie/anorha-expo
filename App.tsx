import React, { useEffect, useRef, useState, useContext } from 'react';
import { NavigationContainer, NavigationContainerRef, CommonActions } from '@react-navigation/native';
import { StatusBar, Linking, Alert, ActivityIndicator, View } from 'react-native';
import { ThemeProvider } from './src/context/ThemeContext';
import AppNavigator from './src/navigation/AppNavigator';
import { LogBox } from 'react-native';
import 'react-native-get-random-values';
import { supabase } from './src/lib/supabase';
import { LegendStateContext } from './src/context/LegendStateContext';
import { LegendStateControlContext } from './src/context/LegendStateControlContext';
import { initializeLegendState, LegendStateObservables } from './src/utils/SupaLegend';
import { Session, AuthChangeEvent } from '@supabase/supabase-js';
import FlashMessage from 'react-native-flash-message';
import { PlatformConnectionsProvider } from './src/context/PlatformConnectionsContext';
import { ClerkProvider, useAuth, SignedIn, SignedOut } from '@clerk/clerk-expo';
import { tokenCache as clerkTokenCache } from '@clerk/clerk-expo/token-cache';
import * as SecureStore from 'expo-secure-store';
import { SessionProvider } from './src/context/SessionProvider';
import { SessionContext } from './src/context/SessionContext';


const App: React.FC = () => {
  // One-time cleanup of any existing cache conflicts
  useEffect(() => {
    const cleanupCache = async () => {
      try {
        await SecureStore.deleteItemAsync('__clerk_skip_cache');
        console.log('[App] Cleaned up any existing cache conflict flags');
      } catch {}
    };
    cleanupCache();
  }, []);

  // Use Clerk's official Expo SecureStore token cache
  const tokenCache = clerkTokenCache;

  // Authed app content (without NavigationContainer)
  const AuthedAppContent: React.FC<{ navigationRef: React.RefObject<NavigationContainerRef<any> | null> }> = ({ navigationRef }) => {
    const [legendStateModules, setLegendStateModules] = useState<LegendStateObservables | null>(null);
    const { isLoaded: clerkLoaded, isSignedIn } = useAuth();
    const session = useContext(SessionContext);

    // Deep Link Handling scoped to AuthedApp
    useEffect(() => {
      const handleInitialUrl = async () => {
        const initialUrl = await Linking.getInitialURL();
        if (!initialUrl) return;
        if (!initialUrl.startsWith('sssyncapp://auth-callback')) return;
        try {
          const urlObject = new URL(initialUrl);
          const status = urlObject.searchParams.get('status');
          const platform = urlObject.searchParams.get('platform');
          const message = urlObject.searchParams.get('message');
          if (status === 'success') {
            navigationRef.current?.navigate('AppStack', { screen: 'TabNavigator', params: { screen: 'Profile', params: { refresh: Date.now() } } });
            Alert.alert('Connection Successful', `Successfully connected ${platform || 'platform'}!`);
          } else if (status === 'error') {
            Alert.alert('Connection Failed', `Failed to connect ${platform || 'platform'}. ${message ? `Reason: ${message}` : 'Please try again.'}`);
          }
        } catch {}
      };
      handleInitialUrl();
      const subscription = Linking.addEventListener('url', (event: { url: string }) => {
        const url = event.url;
        if (!url.startsWith('sssyncapp://auth-callback')) return;
        try {
          const urlObject = new URL(url);
          const status = urlObject.searchParams.get('status');
          const platform = urlObject.searchParams.get('platform');
          const message = urlObject.searchParams.get('message');
          if (status === 'success') {
            navigationRef.current?.navigate('AppStack', { screen: 'TabNavigator', params: { screen: 'Profile', params: { refresh: Date.now() } } });
            Alert.alert('Connection Successful', `Successfully connected ${platform || 'platform'}!`);
          } else if (status === 'error') {
            Alert.alert('Connection Failed', `Failed to connect ${platform || 'platform'}. ${message ? `Reason: ${message}` : 'Please try again.'}`);
          }
        } catch {}
      });
      return () => subscription.remove();
    }, []);

    // Initialize LegendState when Clerk is signed in, cleanup when signed out
    useEffect(() => {
      if (!clerkLoaded) return;
      
      if (!isSignedIn) {
        console.log('[App] User signed out, clearing Legend State');
        setLegendStateModules(null);
        return;
      }
      
      // Wait until the Clerk→Supabase bridge has been configured
      if (!session?.ready) return;
      
      (async () => {
        try {
          const { data: { user } } = await supabase.auth.getUser();
          if (!user?.id) return;
          if (legendStateModules && legendStateModules.userId === user.id) return;
          console.log(`[App] Initializing Legend State for user: ${user.id}`);
          const initialized = await initializeLegendState(supabase, user.id);
          setLegendStateModules(initialized);
          console.log('[App] Legend State ready');
        } catch (e) {
          console.error('[App] Legend State init failed:', e);
          setLegendStateModules(null);
        }
      })();
    }, [clerkLoaded, isSignedIn, session?.ready]);

    const resetLegendState = async () => {
      console.log('[App] Manually resetting Legend State by forcing re-initialization...');
      const { data: { session } } = await supabase.auth.getSession();
      if (session && session.user) {
          try {
              const reinitializedModules = await initializeLegendState(supabase, session.user.id, { force: true });
              setLegendStateModules(reinitializedModules);
              console.log('[App] Legend State has been forcefully reset and re-initialized.');
          } catch (error) {
              console.error('[App] Error during forced Legend State re-initialization:', error);
          }
      } else {
          console.warn('[App] Could not reset Legend State: No active session.');
      }
    };

    return (
      <LegendStateControlContext.Provider value={{ resetLegendState }}>
        <LegendStateContext.Provider value={legendStateModules}>
          <ThemeProvider>
            <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" />
            {!clerkLoaded ? (
              <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                <ActivityIndicator />
              </View>
            ) : !isSignedIn ? (
              // If not signed in, don't wait for session/legend state
              <AppNavigator />
            ) : !session?.ready || !legendStateModules ? (
              <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                <ActivityIndicator />
              </View>
            ) : (
              <AppNavigator />
            )}
            <FlashMessage position="top" />
          </ThemeProvider>
        </LegendStateContext.Provider>
      </LegendStateControlContext.Provider>
    );
  };

  const WithSessionProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const { getToken } = useAuth();
    const template = process.env.EXPO_PUBLIC_CLERK_JWT_TEMPLATE || 'mobile';
    return (
      <SessionProvider getClerkToken={() => getToken({ template }).catch(async () => getToken())}>
        {children}
      </SessionProvider>
    );
  };

  const DebugClerkState = () => {
    const { isLoaded, isSignedIn } = useAuth();
    const navigationRef = useRef<NavigationContainerRef<any>>(null);
    const [navigationReady, setNavigationReady] = useState(false);
    const [forceRefresh, setForceRefresh] = useState(0);
    const navKey = `navigation-${isSignedIn ? 'signed-in' : 'signed-out'}-${forceRefresh}`;
    console.log('[App] Clerk state:', { isLoaded, isSignedIn, navKey });
    
    // Debug what happens when isSignedIn changes
    useEffect(() => {
      if (isLoaded) {
        console.log('[App] ✓ isSignedIn changed to:', isSignedIn);
        if (isSignedIn) {
          console.log('[App] ✓ User is signed in, will render WithSessionProvider');
        } else {
          console.log('[App] ✓ User is not signed in, will render AppNavigator');
        }
      }
    }, [isLoaded, isSignedIn]);
    


    // Reset navigationReady when auth state changes to ensure proper re-initialization
    useEffect(() => {
      if (!isLoaded) return;
      console.log('[App] Auth state changed, resetting navigation ready state');
      setNavigationReady(false);
    }, [isLoaded, isSignedIn]);
    
    if (!isLoaded) {
      return (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <ActivityIndicator />
        </View>
      );
    }
    
    return (
      <PlatformConnectionsProvider>
        <NavigationContainer 
          key={navKey}
          ref={navigationRef}
          onReady={() => {
            console.log('[App] Navigation container ready, key:', navKey, 'isSignedIn:', isSignedIn);
            setNavigationReady(true);
          }}
        >
          {isSignedIn ? (
            <WithSessionProvider>
              <AuthedAppContent navigationRef={navigationRef} />
            </WithSessionProvider>
          ) : (
            <ThemeProvider>
              <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" />
              <AppNavigator />
              <FlashMessage position="top" />
            </ThemeProvider>
          )}
        </NavigationContainer>
      </PlatformConnectionsProvider>
    );
  };

  return (
    <ClerkProvider publishableKey={process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY!} tokenCache={tokenCache}>
      <DebugClerkState />
    </ClerkProvider>
  );
};

export default App; 