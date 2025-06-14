import React, { useEffect, useRef, useState } from 'react';
import { NavigationContainer, NavigationContainerRef } from '@react-navigation/native';
import { StatusBar, Linking, Alert } from 'react-native';
import { ThemeProvider } from './src/context/ThemeContext';
import AppNavigator from './src/navigation/AppNavigator';
import { LogBox } from 'react-native';
import 'react-native-get-random-values';
import { supabase } from './lib/supabase';
import { LegendStateContext } from './src/context/LegendStateContext';
import { LegendStateControlContext } from './src/context/LegendStateControlContext';
import { initializeLegendState, LegendStateObservables } from './src/utils/SupaLegend';
import { Session, AuthChangeEvent } from '@supabase/supabase-js';
import FlashMessage from 'react-native-flash-message';

const App: React.FC = () => {
  const navigationRef = useRef<NavigationContainerRef<any>>(null);
  const [legendStateModules, setLegendStateModules] = useState<LegendStateObservables | null>(null);

  // --- Deep Link Handling ---
  useEffect(() => {
    // Handle initial URL (app opened from a stopped state)
    const handleInitialUrl = async () => {
      const initialUrl = await Linking.getInitialURL();
      if (initialUrl) {
        handleDeepLink(initialUrl);
      }
    };

    handleInitialUrl();

    // Handle URL received while app is running
    const subscription = Linking.addEventListener('url', (event) => {
      handleDeepLink(event.url);
    });

    // Clean up listener on unmount
    return () => {
      subscription.remove();
    };
  }, []);

  const handleDeepLink = (url: string) => {
    console.log("[App.tsx] Received deep link URL:", url);
    
    // Check if it's our auth callback
    if (url.startsWith('sssyncapp://auth-callback')) {
      // Parse URL parameters
      const urlObject = new URL(url); // Use URL API for robust parsing
      const params = urlObject.searchParams;
      
      const status = params.get('status');
      const platform = params.get('platform');
      const message = params.get('message');
      
      console.log("[App.tsx] Auth Callback Parsed Params:", { status, platform, message });

      if (status === 'success') {
        // Navigate to Profile screen with a refresh param
        console.log("[App.tsx] Navigating to Profile with refresh param");
        navigationRef.current?.navigate('MainTabs', { 
          screen: 'Profile', 
          params: { refresh: Date.now() } // Use timestamp to force update
        }); 
        // Optional: Show a briefer success message or remove alert
        Alert.alert(
          'Connection Successful',
          `Successfully connected ${platform || 'platform'}!`
        );
      } else if (status === 'error') {
        // TODO: Handle error state appropriately
        Alert.alert(
          'Connection Failed',
          `Failed to connect ${platform || 'platform'}. ${message ? `Reason: ${message}` : 'Please try again.'}`
        );
      } else {
        console.warn("[App.tsx] Received auth callback with unknown status:", status);
      }
    }
    // Add handling for other deep links if needed
  };
  // --- End Deep Link Handling ---

  useEffect(() => {
    console.log("[App] Auth listener effect mounted.");

    const setupLegendStateForSession = async (session: Session | null) => {
        if (session && session.user) {
            if (!legendStateModules || legendStateModules.userId !== session.user.id) {
                console.log(`[App] Valid session for ${session.user.id}. Initializing/Re-initializing Legend State...`);
                try {
                    const initializedModules = await initializeLegendState(supabase, session.user.id);
                    setLegendStateModules(initializedModules);
                    console.log("[App] Legend State ready for user:", session.user.id);
                } catch (error) {
                    console.error("[App] Error initializing Legend State:", error);
                    setLegendStateModules(null);
                }
            } else {
                console.log("[App] Legend State already initialized for user:", session.user.id);
            }
        } else {
            if (legendStateModules) {
                console.log("[App] No session/user signed out. Resetting Legend State.");
                setLegendStateModules(null);
            }
        }
    };

    const { data: authListener } = supabase.auth.onAuthStateChange(async (event: AuthChangeEvent, session: Session | null) => {
        console.log(`[App] Auth event: ${event}`);
        await setupLegendStateForSession(session);
    });

    const checkInitialSession = async () => {
        console.log("[App] Checking initial session...");
        const { data: { session } } = await supabase.auth.getSession();
        await setupLegendStateForSession(session);
    };

    checkInitialSession();

    return () => {
        if (authListener && authListener.subscription) {
            authListener.subscription.unsubscribe();
            console.log("[App] Unsubscribed from auth state changes.");
        }
    };
  }, [legendStateModules, setLegendStateModules]);

  const resetLegendState = async () => {
    console.log('[App] Manually resetting Legend State by forcing re-initialization...');
    const { data: { session } } = await supabase.auth.getSession();
    if (session && session.user) {
        try {
            const reinitializedModules = await initializeLegendState(supabase, session.user.id, { force: true });
            setLegendStateModules(reinitializedModules);
            console.log("[App] Legend State has been forcefully reset and re-initialized.");
        } catch (error) {
            console.error("[App] Error during forced Legend State re-initialization:", error);
        }
    } else {
        console.warn("[App] Could not reset Legend State: No active session.");
    }
  };

  return (
    <LegendStateControlContext.Provider value={{ resetLegendState }}>
      <LegendStateContext.Provider value={legendStateModules}>
        <ThemeProvider>
          <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" />
          <NavigationContainer ref={navigationRef}>
            <AppNavigator />
          </NavigationContainer>
          <FlashMessage position="top" />
        </ThemeProvider>
      </LegendStateContext.Provider>
    </LegendStateControlContext.Provider>
  );
};

export default App; 