import React, { useEffect, useRef, useState, useContext } from 'react';
import { NavigationContainer, NavigationContainerRef, CommonActions } from '@react-navigation/native';
import { StatusBar, Linking, Alert, ActivityIndicator, View, Pressable } from 'react-native';
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
import { PlatformConnectionsProvider, usePlatformConnections } from './src/context/PlatformConnectionsContext';
import { PlatformPickerOverlayProvider, usePlatformPickerOverlay } from './src/context/PlatformPickerOverlayContext';
import BottomNav from './src/components/BottomNav';
import { Text } from 'react-native';
import { ClerkProvider, useAuth, SignedIn, SignedOut } from '@clerk/clerk-expo';
import { tokenCache as clerkTokenCache } from '@clerk/clerk-expo/token-cache';
import * as SecureStore from 'expo-secure-store';
import { SessionProvider } from './src/context/SessionProvider';
import { SessionContext } from './src/context/SessionContext';
import ProcessResumptionModal from './src/components/ProcessResumptionModal';
import { useProcessResumption } from './src/hooks/useProcessState';
import { ProcessState, ProcessType } from './src/utils/ProcessPersistence';
import SafeErrorBoundary from './src/utils/SafeErrorBoundary';

// Feature flag to disable new functionality during debugging
const ENABLE_PROCESS_FEATURES = false;


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
    const [showProcessModal, setShowProcessModal] = useState(false);
    const { isLoaded: clerkLoaded, isSignedIn } = useAuth();
    const session = useContext(SessionContext);
    
    // Use process resumption hook properly
    const processResumption = ENABLE_PROCESS_FEATURES ? useProcessResumption() : null;

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
          
          // Check for resumable processes after everything is ready
          if (ENABLE_PROCESS_FEATURES) {
            setTimeout(() => {
              try {
                const resumableProcesses = processResumption?.getResumableProcesses() || [];
                if (resumableProcesses.length > 0) {
                  console.log(`[App] Found ${resumableProcesses.length} resumable processes`);
                  setShowProcessModal(true);
                }
              } catch (error) {
                console.error('[App] Error checking resumable processes:', error);
              }
            }, 1000); // Small delay to ensure everything is initialized
          }
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

    const handleResumeProcess = (process: ProcessState) => {
      try {
        console.log('[App] Resuming process:', process.type, process.id);
        
        // Navigate to appropriate screen based on process type
        switch (process.type) {
          case ProcessType.AI_GENERATION:
            navigationRef.current?.navigate('AppStack', {
              screen: 'GenerateDetailsScreen',
              params: { resumeProcessId: process.id },
            });
            break;
          case ProcessType.LISTING_CREATION:
            navigationRef.current?.navigate('AppStack', {
              screen: 'AddListingScreen',
              params: { resumeProcessId: process.id },
            });
            break;
          default:
            console.warn('[App] Unknown process type for resumption:', process.type);
        }
      } catch (error) {
        console.error('[App] Error resuming process:', error);
      }
    };

  const GlobalPlatformPickerOverlay: React.FC = () => {
    const overlay = usePlatformPickerOverlay();
    const { connections } = usePlatformConnections();
    
    // DEBUG: Log overlay state
    console.log('[GlobalPlatformPickerOverlay] Rendering with overlay.visible:', overlay.visible);
    console.log('[GlobalPlatformPickerOverlay] Overlay onStartConnect exists:', !!overlay.onStartConnect);
    
    const counts: Record<string, number> = {};
    (connections || []).forEach((c: any) => {
      if ((c.Status || '').toLowerCase() === 'active') {
        counts[c.PlatformType] = (counts[c.PlatformType] || 0) + 1;
      }
    });
    
    if (!overlay.visible) {
      console.log('[GlobalPlatformPickerOverlay] Not visible, returning null');
      return null;
    }
    
    console.log('[GlobalPlatformPickerOverlay] Rendering overlay!');
      return (
        <View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, justifyContent: 'flex-end', zIndex: 9999 }} pointerEvents="box-none">
          <Pressable 
            style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.6)' }} 
            onPress={() => {
              console.log('[GlobalPlatformPickerOverlay] Backdrop pressed, hiding overlay');
              overlay.hide();
            }}
          />
          <View style={{ backgroundColor: '#fff', borderTopLeftRadius: 16, borderTopRightRadius: 16, paddingTop: 12, paddingBottom: 24, height: '40%' }}>
            <BottomNav
              state={'platformPicker'}
              selectedCount={0}
              selectedTemplate={null}
              selectedPlatforms={[]}
              isConnected={(p) => (connections || []).some((c: any) => c.PlatformType === p && (c.Status || '').toLowerCase() === 'active')}
              platformActiveCounts={counts}
              onShowSelection={() => {}}
              onShowTemplates={() => {}}
              onBackToEmpty={() => { overlay.hide(); }}
              onBackToSelection={() => {}}
              onOpenTemplateModal={() => {}}
              onTemplateSelect={() => {}}
              onPlatformToggle={() => {}}
              onGeneratePress={() => {}}
               onStartConnect={(platform) => {
                 console.log('[GlobalPlatformPickerOverlay] onStartConnect called with platform:', platform);
                 overlay.hide();
                 overlay.onStartConnect?.(platform);
               }}
            />
          </View>
        </View>
      );
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
            <GlobalPlatformPickerOverlay />
            
            {/* Only show process modal if everything is ready and features enabled */}
            {ENABLE_PROCESS_FEATURES && session?.ready && (
              <SafeErrorBoundary>
                <ProcessResumptionModal
                  visible={showProcessModal}
                  onClose={() => setShowProcessModal(false)}
                  onResumeProcess={handleResumeProcess}
                />
              </SafeErrorBoundary>
            )}
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
        <PlatformPickerOverlayProvider>
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
        </PlatformPickerOverlayProvider>
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