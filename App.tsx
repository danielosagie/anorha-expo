import React, { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { NavigationContainer, NavigationContainerRef, CommonActions } from '@react-navigation/native';
import { AppState, AppStateStatus, StatusBar, Linking, Alert, ActivityIndicator, View, Pressable } from 'react-native';
import { ThemeProvider } from './src/context/ThemeContext';
import AppNavigator from './src/navigation/AppNavigator';
import { LogBox } from 'react-native';
import 'react-native-get-random-values';
import { ensureSupabaseJwt, forceRefreshSupabaseJwt, supabase } from './src/lib/supabase';
import { LegendStateContext } from './src/context/LegendStateContext';
import { LegendStateControlContext } from './src/context/LegendStateControlContext';
import { initializeFallbackLegendState, initializeLegendState, LegendStateObservables } from './src/utils/SupaLegend';
import { Session, AuthChangeEvent } from '@supabase/supabase-js';
import FlashMessage from 'react-native-flash-message';
import { PlatformConnectionsProvider, usePlatformConnections } from './src/context/PlatformConnectionsContext';
import { PlatformPickerOverlayProvider, usePlatformPickerOverlay } from './src/context/PlatformPickerOverlayContext';
import BottomNav from './src/components/BottomNav';
import { Text } from 'react-native';
import { ClerkProvider, useAuth } from '@clerk/expo';
import { tokenCache as clerkTokenCache } from '@clerk/expo/token-cache';
import * as SecureStore from 'expo-secure-store';
import { EnhancedSessionProvider } from './src/context/EnhancedSessionProvider';
import { SessionContext } from './src/context/SessionContext';
import ProcessResumptionModal from './src/components/ProcessResumptionModal';
import { useProcessResumption } from './src/hooks/useProcessState';
import { ProcessState, ProcessType } from './src/utils/ProcessPersistence';
import SafeErrorBoundary from './src/utils/SafeErrorBoundary';
import { OrgProvider } from './src/context/OrgContext';
import { JobsProvider } from './src/context/JobsContext';
import { SystemNotificationProvider } from './src/context/SystemNotificationContext';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { PostHogProvider, PostHogIdentify } from './src/providers/PostHogProvider';
import { ConvexProvider } from './src/providers/ConvexProvider';
import { BrowserJobsConvexProvider } from './src/providers/BrowserJobsConvexProvider';
import * as Sentry from '@sentry/react-native';
import * as WebBrowser from 'expo-web-browser';
import { init as initFlowLogger } from './src/lib/mobileFlowLogger';
import { LiveActivityProvider } from './src/context/LiveActivityContext';
import { AppDataProvider } from './src/context/AppDataContext';
import AppStartupShell from './src/components/AppStartupShell';
import SessionReconnectScreen from './src/components/SessionReconnectScreen';
import { purgeClerkAndAuthCaches } from './src/utils/authCleanup';
import {
  ActiveFlowCheckpoint,
  clearActiveFlowCheckpoint,
  loadActiveFlowCheckpoint,
  saveActiveFlowCheckpoint,
} from './src/utils/activeFlowPersistence';

// Crash visibility. Empty/missing DSN no-ops cleanly so dev builds are
// unaffected. Must run at module load, before the app renders.
const SENTRY_DSN = process.env.EXPO_PUBLIC_SENTRY_DSN;
if (SENTRY_DSN) {
  try {
    Sentry.init({
      dsn: SENTRY_DSN,
      enableNative: true,
      environment: process.env.EXPO_PUBLIC_ENV || 'development',
      tracesSampleRate: 0.1,
    });
  } catch (e) {
    console.warn('[Sentry] init failed:', e);
  }
}

// Complete any in-app browser auth session (e.g. OAuth redirect from Google Sign-In)
WebBrowser.maybeCompleteAuthSession();

// Initialize mobile flow logger (sessionId) early
initFlowLogger().catch(() => { });

// Feature flag to disable new functionality during debugging
const ENABLE_PROCESS_FEATURES = false;
const API_BASE_URL = process.env.EXPO_PUBLIC_SSSYNC_API_BASE_URL || 'https://api.sssync.app';


const App: React.FC = () => {
  // One-time cleanup of any existing cache conflicts
  useEffect(() => {
    const cleanupCache = async () => {
      try {
        await SecureStore.deleteItemAsync('__clerk_skip_cache');
        console.log('[App] Cleaned up any existing cache conflict flags');
      } catch { }
    };
    cleanupCache();
  }, []);

  // Use Clerk's official Expo SecureStore token cache
  const tokenCache = clerkTokenCache;

  // Authed app content (without NavigationContainer)
  const AuthedAppContent: React.FC<{ navigationRef: React.RefObject<NavigationContainerRef<any> | null> }> = ({ navigationRef }) => {
    const [legendStateModules, setLegendStateModules] = useState<LegendStateObservables | null>(null);
    const [showProcessModal, setShowProcessModal] = useState(false);
    const { isLoaded: clerkLoaded, isSignedIn, signOut: clerkSignOut } = useAuth();
    const session = useContext(SessionContext);

    // Fail-loud reconnect gating: when signed in but the live Supabase bridge isn't
    // up yet, show a brief "Connecting" shell, then (after a grace window) a loud,
    // recoverable reconnect screen — NEVER the app on a dead bridge (which silently
    // showed empty data on every page).
    const [bridgeGraceElapsed, setBridgeGraceElapsed] = useState(false);
    const [reconnecting, setReconnecting] = useState(false);
    useEffect(() => {
      if (!isSignedIn || session?.bridgeReady) {
        setBridgeGraceElapsed(false);
        return;
      }
      const t = setTimeout(() => setBridgeGraceElapsed(true), 12000);
      return () => clearTimeout(t);
    }, [isSignedIn, session?.bridgeReady]);
    const handleReconnect = useCallback(async () => {
      setReconnecting(true);
      try {
        await session?.refresh?.();
      } catch {
        /* failure surfaces via session.bootstrapError */
      } finally {
        setReconnecting(false);
      }
    }, [session]);
    const handleReconnectSignOut = useCallback(async () => {
      try {
        await clerkSignOut?.();
      } catch {
        /* ignore; purge below still runs */
      }
      try {
        await purgeClerkAndAuthCaches();
      } catch {
        /* best-effort */
      }
    }, [clerkSignOut]);

    // Call the hook unconditionally (rules-of-hooks); it has no side effects
    // until initializeProcessSystem() is invoked, so gating the *result* is safe.
    const processResumptionApi = useProcessResumption();
    const processResumption = ENABLE_PROCESS_FEATURES ? processResumptionApi : null;
    const hasAttemptedAutoResumeRef = useRef(false);

    const buildFallbackCompleteRoute = useCallback((processType: 'match' | 'generate' | 'match-and-generate', jobId: string) => {
      if (processType === 'generate') {
        return {
          screen: 'GenerateDetailsScreen',
          params: {
            jobId,
            status: 'processing',
            results: [],
            summary: [],
            completedAt: '',
          },
        };
      }

      return {
        screen: 'GenerateDetailsScreen',
        params: {
          jobId: '',
          status: 'processing',
          results: [],
          summary: [],
          completedAt: '',
          matchJobId: jobId,
          items: [],
          jobMap: {},
        },
      };
    }, []);

    const fetchLatestActiveFlowFromBackend = useCallback(async (): Promise<ActiveFlowCheckpoint | null> => {
      const token = await ensureSupabaseJwt();
      if (!token) return null;

      const headers = {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      };

      const fetchLatest = async (path: string) => {
        const processingRes = await fetch(`${API_BASE_URL}${path}?status=processing&limit=1`, { headers }).catch(() => null);
        const processingJson = processingRes && processingRes.ok ? await processingRes.json().catch(() => null) : null;
        const processingJob = Array.isArray(processingJson?.jobs) ? processingJson.jobs[0] : null;
        if (processingJob) return processingJob;

        const queuedRes = await fetch(`${API_BASE_URL}${path}?status=queued&limit=1`, { headers }).catch(() => null);
        const queuedJson = queuedRes && queuedRes.ok ? await queuedRes.json().catch(() => null) : null;
        return Array.isArray(queuedJson?.jobs) ? queuedJson.jobs[0] : null;
      };

      const [latestMatch, latestGenerate] = await Promise.all([
        fetchLatest('/api/products/match/jobs'),
        fetchLatest('/api/products/generate/jobs'),
      ]);

      if (!latestMatch && !latestGenerate) {
        return null;
      }

      const pickGenerate =
        !!latestGenerate &&
        (!latestMatch || (new Date(latestGenerate.createdAt).getTime() >= new Date(latestMatch.createdAt).getTime()));

      const picked = pickGenerate ? latestGenerate : latestMatch;
      const processType: 'match' | 'generate' = pickGenerate ? 'generate' : 'match';
      const jobId = String(picked?.jobId || '');
      if (!jobId.trim()) return null;

      return {
        version: 1,
        updatedAt: Date.now(),
        jobId,
        processType,
        status: picked?.currentStage === 'Waiting for user context' ? 'awaiting_user_input' : 'processing',
        currentStage: picked?.currentStage,
        payload: {
          jobId,
          firstPhotos: [],
          bulkItems: [],
        },
        onCompleteRoute: buildFallbackCompleteRoute(processType, jobId) as any,
      };
    }, [buildFallbackCompleteRoute]);

    // Deep Link Handling scoped to AuthedApp
    useEffect(() => {
      const handleDeepLink = (url: string) => {
        try {
          // Handle auth callback
          if (url.startsWith('anorhaapp://auth-callback') || url.startsWith('anorhaapp://auth/callback')) {
            const urlObject = new URL(url);
            const status = urlObject.searchParams.get('status');
            const platform = urlObject.searchParams.get('connection') || urlObject.searchParams.get('platform') || 'platform';
            const errorMessage = urlObject.searchParams.get('message');

            console.log(`[App] Auth callback received: platform=${platform}, status=${status}`);

            if (status === 'success') {
              // Show brief success message
              Alert.alert('Success', `${platform.charAt(0).toUpperCase() + platform.slice(1)} connected successfully!`);
              // Navigate to Profile with a unique refresh timestamp to trigger data reload
              navigationRef.current?.dispatch(
                CommonActions.reset({
                  index: 0,
                  routes: [{
                    name: 'AppStack',
                    state: {
                      routes: [{
                        name: 'TabNavigator',
                        state: {
                          routes: [{ name: 'Profile', params: { refresh: Date.now() } }],
                          index: 0
                        }
                      }]
                    }
                  }],
                })
              );
            } else if (status === 'error') {
              Alert.alert('Connection Failed', errorMessage || `Failed to connect ${platform}. Please try again.`);
              // Still navigate to Profile to show the connection attempt result
              navigationRef.current?.navigate('AppStack', { screen: 'TabNavigator', params: { screen: 'Profile' } });
            }
            return;
          }

          // Handle partner invite deep link
          if (url.startsWith('anorhaapp://partner/accept')) {
            const urlObject = new URL(url);
            const token = urlObject.searchParams.get('token');
            if (token) {
              console.log('[App] Partner invite deep link received, token:', token);
              navigationRef.current?.navigate('AppStack', {
                screen: 'PartnerAccept',
                params: { inviteCode: token }
              });
            }
            return;
          }
        } catch (e) {
          console.error('[App] Deep link handling error:', e);
        }
      };

      const handleInitialUrl = async () => {
        const initialUrl = await Linking.getInitialURL();
        if (initialUrl) {
          handleDeepLink(initialUrl);
        }
      };

      handleInitialUrl();

      const subscription = Linking.addEventListener('url', (event: { url: string }) => {
        handleDeepLink(event.url);
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

      // Wait until the Clerk→Supabase bridge is LIVE (not just cached-ready) — else the
      // observables get created with no valid token and every query returns empty.
      if (!session?.bridgeReady) return;

      const userId = session?.user?.id;
      if (!userId) {
        console.warn('[App] Session is ready but user id is missing, skipping Legend State init');
        return;
      }

      let cancelled = false;
      let fallbackTimer: ReturnType<typeof setTimeout> | null = null;

      const applyFallbackLegendState = (reason: 'timeout' | 'init_failed') => {
        if (cancelled) return;
        console.warn(`[App] Using fallback Legend State (${reason}) for user: ${userId}`);
        setLegendStateModules((current) => {
          if (current?.userId === userId && current.productVariants$) {
            return current;
          }
          return initializeFallbackLegendState(userId);
        });
      };

      (async () => {
        try {
          if (legendStateModules && legendStateModules.userId === userId) return;

          // Give the FIRST real fetch a generous window before unblocking the UI with
          // empty observables. A 4s cap fired before real data arrived on slow networks
          // / large catalogs, flashing "no data" on every page even with a LIVE bridge.
          // The "Preparing local data" shell shows during this window, and the real
          // modules replace the fallback as soon as init resolves.
          fallbackTimer = setTimeout(() => {
            applyFallbackLegendState('timeout');
          }, 12000);

          console.log(`[App] Initializing Legend State for user: ${userId}`);
          const initialized = await initializeLegendState(supabase, userId);
          if (cancelled) return;
          if (fallbackTimer) {
            clearTimeout(fallbackTimer);
            fallbackTimer = null;
          }
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
          if (fallbackTimer) {
            clearTimeout(fallbackTimer);
            fallbackTimer = null;
          }
          applyFallbackLegendState('init_failed');
        }
      })();

      return () => {
        cancelled = true;
        if (fallbackTimer) {
          clearTimeout(fallbackTimer);
        }
      };
    }, [clerkLoaded, isSignedIn, session?.bridgeReady, session?.user?.id]);

    useEffect(() => {
      if (!clerkLoaded || !isSignedIn || !session?.ready) return;
      const userId = session?.user?.id;
      if (!userId) return;

      const nav = navigationRef.current;
      if (!nav?.isReady?.()) return;
      if (hasAttemptedAutoResumeRef.current) return;
      hasAttemptedAutoResumeRef.current = true;

      let cancelled = false;

      (async () => {
        try {
          let checkpoint = await loadActiveFlowCheckpoint(userId);
          if (!checkpoint) {
            checkpoint = await fetchLatestActiveFlowFromBackend();
            if (checkpoint) {
              await saveActiveFlowCheckpoint(userId, checkpoint);
            }
          }

          if (cancelled || !checkpoint) return;
          if (checkpoint.status === 'completed') {
            await clearActiveFlowCheckpoint(userId);
            return;
          }

          const currentRouteName = navigationRef.current?.getCurrentRoute()?.name;
          if (currentRouteName === 'LoadingScreen' || currentRouteName === 'MatchSelectionScreen') {
            return;
          }

          const processType = checkpoint.processType;
          const payload = {
            ...(checkpoint.payload || {}),
            jobId: checkpoint.jobId,
            firstPhotos: Array.isArray(checkpoint.payload?.firstPhotos) ? checkpoint.payload.firstPhotos : [],
            bulkItems: Array.isArray(checkpoint.payload?.bulkItems) ? checkpoint.payload.bulkItems : [],
          };
          const onCompleteRoute = checkpoint.onCompleteRoute || buildFallbackCompleteRoute(processType, checkpoint.jobId);

          // Interstitial deprecated: don't auto-open the full-screen LoadingScreen on
          // resume. For a generate job, land directly on the results screen in its
          // processing state (it polls inline via useJobsState); for a match job, skip
          // auto-nav rather than show the interstitial — the seller re-engages from
          // wherever they already are. (Checkpoint state is still loaded above.)
          if (processType === 'generate' && onCompleteRoute?.screen === 'GenerateDetailsScreen') {
            (navigationRef.current as any)?.navigate('AppStack', {
              screen: 'GenerateDetailsScreen',
              params: { ...(onCompleteRoute.params || {}), jobId: checkpoint.jobId, status: 'processing' },
            });
          }
        } catch (error) {
          console.error('[App] Auto-resume failed:', error);
        }
      })();

      return () => {
        cancelled = true;
      };
    }, [
      buildFallbackCompleteRoute,
      clerkLoaded,
      fetchLatestActiveFlowFromBackend,
      isSignedIn,
      navigationRef,
      session?.ready,
      session?.user?.id,
    ]);

    useEffect(() => {
      if (!clerkLoaded || !isSignedIn || !session?.ready) return;
      const userId = session?.user?.id;
      if (!userId) return;

      let appState = AppState.currentState;
      const sub = AppState.addEventListener('change', (nextState: AppStateStatus) => {
        const wasBackgrounded = appState.match(/inactive|background/);
        appState = nextState;
        if (!(nextState === 'active' && wasBackgrounded)) return;

        // On resume, the OS may have suspended the bridge's refresh timer while
        // backgrounded, leaving an expired Supabase JWT. Force a re-exchange so
        // Realtime + API calls don't silently 401 before the next scheduled refresh.
        void forceRefreshSupabaseJwt();

        void (async () => {
          const checkpoint = await loadActiveFlowCheckpoint(userId);
          if (!checkpoint || checkpoint.status === 'completed') return;

          const routeName = navigationRef.current?.getCurrentRoute()?.name;
          if (routeName === 'LoadingScreen' || routeName === 'MatchSelectionScreen') return;

          const processType = checkpoint.processType;
          const payload = {
            ...(checkpoint.payload || {}),
            jobId: checkpoint.jobId,
            firstPhotos: Array.isArray(checkpoint.payload?.firstPhotos) ? checkpoint.payload.firstPhotos : [],
            bulkItems: Array.isArray(checkpoint.payload?.bulkItems) ? checkpoint.payload.bulkItems : [],
          };
          const onCompleteRoute = checkpoint.onCompleteRoute || buildFallbackCompleteRoute(processType, checkpoint.jobId);

          // Interstitial deprecated: don't auto-open the full-screen LoadingScreen on
          // resume. For a generate job, land directly on the results screen in its
          // processing state (it polls inline via useJobsState); for a match job, skip
          // auto-nav rather than show the interstitial — the seller re-engages from
          // wherever they already are. (Checkpoint state is still loaded above.)
          if (processType === 'generate' && onCompleteRoute?.screen === 'GenerateDetailsScreen') {
            (navigationRef.current as any)?.navigate('AppStack', {
              screen: 'GenerateDetailsScreen',
              params: { ...(onCompleteRoute.params || {}), jobId: checkpoint.jobId, status: 'processing' },
            });
          }
        })();
      });

      return () => {
        sub.remove();
      };
    }, [buildFallbackCompleteRoute, clerkLoaded, isSignedIn, navigationRef, session?.ready, session?.user?.id]);

    const resetLegendState = async () => {
      console.log('[App] Manually resetting Legend State by forcing re-initialization...');
      const userId = session?.user?.id;
      if (userId) {
        try {
          const reinitializedModules = await initializeLegendState(supabase, userId, { force: true });
          setLegendStateModules(reinitializedModules);
          console.log('[App] Legend State has been forcefully reset and re-initialized.');
        } catch (error) {
          console.error('[App] Error during forced Legend State re-initialization:', error);
          setLegendStateModules(initializeFallbackLegendState(userId));
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

      const counts: Record<string, number> = {};
      (connections || []).forEach((c: any) => {
        if ((c.Status || '').toLowerCase() === 'active') {
          counts[c.PlatformType] = (counts[c.PlatformType] || 0) + 1;
        }
      });

      if (!overlay.visible) {
        return null;
      }

      return (
        <View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, justifyContent: 'flex-end', zIndex: 9999 }} pointerEvents="box-none">
          <Pressable
            style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.6)' }}
            onPress={() => {
              overlay.hide();
            }}
          />
          <View style={{ flexDirection: "column", alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff', borderTopLeftRadius: 16, borderTopRightRadius: 16, paddingTop: 12, paddingBottom: 24, width: '100%' }}>
            <BottomNav
              state={'platformPicker'}
              selectedCount={0}
              selectedTemplate={null}
              selectedPlatforms={[]}
              isConnected={(p) => (connections || []).some((c: any) => c.PlatformType === p && (c.Status || '').toLowerCase() === 'active')}
              platformActiveCounts={counts}
              onShowSelection={() => { }}
              onShowPlatforms={() => { }}
              onShowTemplates={() => { }}
              onBackToEmpty={() => { overlay.hide(); }}
              onBackToSelection={() => { }}
              onOpenTemplateModal={() => { }}
              onTemplateSelect={() => { }}
              onPlatformToggle={() => { }}
              onGeneratePress={() => { }}
              onStartConnect={(platform) => {
                overlay.hide();
                overlay.onStartConnect?.(platform);
              }}
              // "See all platforms" → the full connect page. Wired here (root
              // owns the nav ref); pickers without navigation skip the row.
              onSeeAll={() => {
                overlay.hide();
                navigationRef.current?.navigate('AppStack', { screen: 'ConnectPlatforms' } as any);
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
              <AppStartupShell
                title="Starting up"
                message="Loading cached session state and checking service health."
              />
            ) : !isSignedIn ? (
              // If not signed in, don't wait for session/legend state
              <SafeErrorBoundary><AppNavigator /></SafeErrorBoundary>
            ) : (!session || session.bootstrapState === 'initializing') ? (
              <AppStartupShell
                title="Restoring your workspace"
                message={session?.bootstrapError || 'Checking your session and loading cached account data.'}
              />
            ) : !session.bridgeReady ? (
              // Signed in, but the live Supabase bridge isn't up — RLS queries would
              // return empty. NEVER render the app on a dead bridge (that silently
              // showed no data everywhere). Brief shell during the grace window, then a
              // loud, recoverable reconnect screen.
              bridgeGraceElapsed ? (
                <SessionReconnectScreen
                  message={session.bootstrapError || undefined}
                  reconnecting={reconnecting}
                  onRetry={handleReconnect}
                  onSignOut={handleReconnectSignOut}
                />
              ) : (
                <AppStartupShell
                  title="Connecting"
                  message="Securing your session and loading your data…"
                />
              )
            ) : !legendStateModules ? (
              <AppStartupShell
                title="Preparing local data"
                message="Reconnecting shared app state and restoring your last workspace."
              />
            ) : (
              <SafeErrorBoundary><AppNavigator /></SafeErrorBoundary>
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
    const { getToken, isSignedIn } = useAuth();
    const template = process.env.EXPO_PUBLIC_CLERK_JWT_TEMPLATE || 'mobile';
    // Native third-party auth (CLERK_NATIVE_AUTH=true): Supabase validates the
    // Clerk token directly and requires the SESSION token (which carries the
    // `role: authenticated` claim added by the Clerk↔Supabase integration). The
    // legacy custom "mobile" template lacks that claim, so Supabase 401s it.
    // Mint-bridge mode still uses the "mobile" template that /api/auth/exchange expects.
    const clerkNativeAuth = process.env.EXPO_PUBLIC_CLERK_NATIVE_AUTH === 'true';
    // Keep getClerkToken's IDENTITY STABLE across renders. Clerk's getToken can be a
    // fresh reference each render; if it leaks into this callback's deps, getClerkToken
    // changes → EnhancedSessionProvider's validateAuthIfNeeded/init effect re-runs every
    // render, which thrashed bridgeReady and bounced the app to the reconnect screen.
    // Read getToken through a ref so the callback never changes (deps are stable values).
    const getTokenRef = useRef(getToken);
    getTokenRef.current = getToken;
    const getClerkToken = useCallback(
      () =>
        clerkNativeAuth
          ? getTokenRef.current()
          : getTokenRef.current({ template }).catch(async () => getTokenRef.current()),
      [clerkNativeAuth, template],
    );

    return (
      <EnhancedSessionProvider getClerkToken={getClerkToken} isSignedIn={isSignedIn}>
        <PostHogIdentify />
        {children}
      </EnhancedSessionProvider>
    );
  };

  const DebugClerkState = () => {
    const { isLoaded, isSignedIn } = useAuth();
    const navigationRef = useRef<NavigationContainerRef<any>>(null);
    // NOTE: do NOT add a per-render console.log here. Core 3 / clerk-js v6 re-renders
    // every useAuth() consumer on every resource emit, so a log here floods hundreds of
    // lines per second and makes the (otherwise cheap) re-renders expensive.

    // Log only on actual auth-state transitions.
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
            // NOTE: intentionally NOT keyed on isSignedIn. Keying here remounted the entire
            // container on every auth toggle, destroying nav state and dropping in-flight deep
            // links. The signed-in/out trees below swap on their own; the container persists.
            ref={navigationRef}
            onReady={() => {
              console.log('[App] Navigation container ready, isSignedIn:', isSignedIn);
            }}
          >
            <>
              {/* Providers wrap the navigator in ALL auth states. AppNavigator does its own
                  auth gating (AuthStack vs AppStack) and can render app screens while Clerk is
                  momentarily signed-out (a stored session still resolves to the AppStack), so
                  Session/Org/AppData must always be mounted or those screens crash
                  ("useAppData must be used within an AppDataProvider"). AuthedAppContent already
                  handles the signed-out / not-ready states internally (and supplies its own
                  ThemeProvider, StatusBar and FlashMessage). */}
              <WithSessionProvider>
                <OrgProvider>
                  {/* 2nd Convex client (browserJobs deployment). Pure context
                      carrier — does NOT wrap a ConvexProvider, so it never
                      hijacks chat's useQuery (the top-level agent-chat
                      ConvexProvider stays authoritative). Mounted here so it has
                      SessionContext for the userId. */}
                  <BrowserJobsConvexProvider>
                    <AppDataProvider>
                      <LiveActivityProvider>
                        <JobsProvider>
                          <AuthedAppContent navigationRef={navigationRef} />
                        </JobsProvider>
                      </LiveActivityProvider>
                    </AppDataProvider>
                  </BrowserJobsConvexProvider>
                </OrgProvider>
              </WithSessionProvider>
            </>
          </NavigationContainer>
        </PlatformPickerOverlayProvider>
      </PlatformConnectionsProvider>
    );
  };

  return (
    <ClerkProvider publishableKey={process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY!} tokenCache={tokenCache}>
      {/* Convex (Clerk-authed) wraps the app so the chat can subscribe to live
          messages via useQuery. Inside ClerkProvider so it can read the session. */}
      <ConvexProvider>
        <PostHogProvider>
          <SafeAreaProvider>
            <SystemNotificationProvider>
              <DebugClerkState />
            </SystemNotificationProvider>
          </SafeAreaProvider>
        </PostHogProvider>
      </ConvexProvider>
    </ClerkProvider>
  );
};

export default Sentry.wrap(App);
