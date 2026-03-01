import React, { useEffect, useState, useCallback } from 'react';
import { createStackNavigator, StackScreenProps } from '@react-navigation/stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import AsyncStorage from '@react-native-async-storage/async-storage';
import TabBar from '../components/TabBar';
import styles from '../styles/styles';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
// import { Camera } from 'lucide-react-native';
import { AppState, AppStateStatus, Platform } from 'react-native';
import { CommonActions } from '@react-navigation/native';
import { useAuth } from '@clerk/clerk-expo';
import { NavigationContainer, useNavigation } from '@react-navigation/native';
import { ActivityIndicator, View } from 'react-native';
import { Asset } from 'expo-asset';
import * as SplashScreen from 'expo-splash-screen';
import { useFonts } from 'expo-font';
import {
  PlusJakartaSans_400Regular,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_700Bold,
} from '@expo-google-fonts/plus-jakarta-sans';
// import { CirclePlus } from 'lucide-react-native';
import OnboardConnectionScreen from '../screens/OnboardConnectionScreen';
import { usePushNotifications } from '../hooks/usePushNotifications';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// Import the context from its new location
import { AuthContext, AuthContextType } from '../context/AuthContext';
import { supabase, stopClerkSupabaseBridge, ensureSupabaseJwt } from '../lib/supabase';
// Screens
import InitialScreen from '../screens/InitialScreen';
import OnboardingSlides from '../screens/OnboardingSlides';
import AuthScreen from '../screens/AuthScreen';
import DashboardScreen from '../screens/DashboardScreen';
import InventoryOrdersScreen from '../screens/InventoryOrdersScreen';
import MarketplaceScreen from '../screens/MarketplaceScreen';
import ProfileScreen from '../screens/ProfileScreen';
import NotificationSettingsScreen from '../screens/NotificationSettingsScreen';
import ProductDetailScreen from '../screens/ProductDetail';
import PhoneAuthScreen from '../screens/PhoneAuthScreen';
import CreateAccountScreen from '../screens/CreateAccountScreen';
import PastScansScreen from '../screens/PastScansScreen';
import TeamScreen from '../screens/TeamScreen';
import MappingReviewScreen from '../screens/MappingReviewScreen';
import SyncRulesScreen from '../screens/SyncRulesScreen';
import AddProductScreen from '../screens/AddProductScreen';
import LoadingScreen from '../screens/LoadingScreen';
import MatchSelectionScreen, { JobResponse } from '../screens/MatchSelectionScreen';
import GenerateDetailsScreen from '../screens/GenerateDetailsScreen';
import VerifyCodeScreen from '../screens/VerifyCodeScreen';
import MarketplaceChatScreen from '../screens/MarketplaceChatScreen';
import ActivityFeedScreen from '../screens/ActivityFeedScreen';
import PublishConfirmationScreen from '../screens/PublishConfirmationScreen';
import PartnerAcceptScreen from '../screens/PartnerAcceptScreen';
import PartnersScreen from '../screens/PartnersScreen';
import PartnershipDetailScreen from '../screens/PartnershipDetailScreen';
import { BackfillOptimizerScreen } from '../screens/BackfillOptimizerScreen';
import { CSVColumnMappingScreen } from '../screens/CSVColumnMappingScreen';
import PendingOrgInvitesScreen from '../screens/PendingOrgInvitesScreen';
import LiquidationCampaignScreen from '../screens/LiquidationCampaignScreen';
import BackupsScreen from '../screens/BackupsScreen';
import BillingScreen from '../screens/BillingScreen';
import DeleteAccountInfoScreen from '../screens/DeleteAccountInfoScreen';
import { isFeatureEnabled } from '../config/features';
import { SessionContext } from '../context/SessionContext';

// --- Define Param Lists for Type Safety --- //
export type AuthStackParamList = {
  InitialScreen: undefined;
  OnboardingSlides: undefined;
  Auth: undefined;
  VerifyCode: { contactLabel?: string; mode?: 'signup' | 'signin' | 'reset' } | undefined;
  // PhoneAuthScreen: { phoneNumber: string } | undefined; // Commented out
  OnboardConnectionScreen: undefined;
  CreateAccountScreen: undefined;
};

// Export the type
export type AppStackParamList = {
  PendingOrgInvitesScreen: undefined;
  CreateAccountScreen: undefined;
  TabNavigator: undefined;
  AddListing?: { // The entire params object for AddListing is optional
    initialData?: {
      title: string;
      description: string;
      price: number;
      sku: string;
      barcode: string;
      images: string[];
      platformDetails: any;
      status: 'draft' | 'active' | 'archived';
      initialStage?: string;
      productId?: string;
      variantId?: string;
      uploadedImageUrls?: string[];
    };
  };
  LoadingScreen: {
    processType: 'match' | 'generate' | 'match-and-generate';
    payload: {
      jobId?: string;
      firstPhotos: any[];
      bulkItems?: any[];
      userAssistDecisions?: Record<number, {
        confirmedCandidateIndex?: number;
        deniedCandidateIndices?: number[];
        refineText?: string;
        generateBestGuess?: boolean;
        state?: 'pending' | 'submitted' | 'failed';
      }>;
      // When true, LoadingScreen will NOT early-navigate to MatchSelectionScreen.
      // It will wait for the job to complete so it can respect skipToGenerate/autoGenerateJobId.
      skipMatchSelection?: boolean;
      autoGenerateAllPlatforms?: boolean;
    };
    onCompleteRoute: {
      screen: keyof AppStackParamList;
      params?: any;
    };
  };
  ProductDetail: { productId: string };
  PastScans: undefined;
  MappingReview: { connectionId: string; platformName: string; jobId?: string; importedProducts?: any[]; isCSVImport?: boolean; isScanning?: boolean; scanStartTime?: number; };
  SyncRules: { connectionId: string };
  Profile: { refresh?: number };
  DeleteAccountInfo: undefined;
  NotificationSettings: undefined;
  Team: undefined;
  Billing: undefined;
  AddProduct: {
    firstPhotos?: any[];
    bulkItems?: any[];
    sessionId?: string;
  } | undefined;
  MatchSelectionScreen: {
    jobResponse?: JobResponse;
    jobId?: string;
    focusIndex?: number;
    items?: Array<{ index: number; title?: string; thumb?: string; matchesCount?: number; matchJobId?: string }>;
    jobMap?: Record<number, { jobId: string; status?: string }>;
    preResolvedSelections?: Record<number, number[]>;
    preDeniedSelections?: Record<number, number[]>;
    preRefineTextByIndex?: Record<number, string>;
    bestGuessByIndex?: Record<number, boolean>;
    response: {
      jobId?: string;
      bulkItems?: any[];
      firstPhotos?: any[];
      jobResults?: any[];
      analysis?: {
        jobId: string;
        userId: string;
        status: string;
        currentStage: string;
        progress: {
          totalProducts: number;
          completedProducts: number;
          currentProductIndex: number;
          failedProducts: number;
          stagePercentage: number;
        };
        results: Array<{
          productIndex: number;
          productId: string;
          variantId: string;
          serpApiData: Array<{
            position?: number;
            title?: string;
            link?: string;
            source?: string;
            source_icon?: string;
            thumbnail?: string;
            thumbnail_width?: number;
            thumbnail_height?: number;
            image?: string;
            image_width?: number;
            image_height?: number;
            rating?: number;
            reviews?: number;
            price?: {
              value?: string;
              extracted_value?: number;
              currency?: string;
            };
            condition?: string;
            in_stock?: boolean;
          }>;
          rerankedResults: Array<{
            position?: number;
            title?: string;
            link?: string;
            source?: string;
            source_icon?: string;
            thumbnail?: string;
            thumbnail_width?: number;
            thumbnail_height?: number;
            image?: string;
            image_width?: number;
            image_height?: number;
            rank?: number;
            score?: number;
            rating?: number;
            reviews?: number;
            price?: {
              value?: string;
              extracted_value?: number;
              currency?: string;
            };
            condition?: string;
            in_stock?: boolean;
          }>;
          confidence: string; // Changed from number to string based on the JSON example
          matchDecision?: 'matched' | 'classified' | 'needs_user_input';
          userAssist?: {
            required: boolean;
            prompt: string;
            requestedFields?: string[];
            allowedActions?: Array<'confirm' | 'deny' | 'refine' | 'retake' | 'best_guess'>;
            requestId?: string;
          };
          autoMatchMeta?: {
            score?: number;
            margin?: number;
            blockedByRules?: string[];
            stageUsed?: string;
          };
          vectorSearchFoundResults: boolean;
          originalTargetImage: string;
          timing: {
            quickScanMs: number;
            serpApiMs: number;
            embeddingMs: number;
            vectorSearchMs: number;
            rerankingMs: number;
            totalMs: number;
          };
        }>;
        startedAt: string;
        updatedAt: string;
        summary: {
          highConfidenceCount: number;
          mediumConfidenceCount: number;
          lowConfidenceCount: number;
          totalEmbeddingsStored: number | null;
          averageProcessingTimeMs: number | null;
        };
        completedAt: string;
      }
    }
  };
  GenerateDetailsScreen: {
    jobId: string,
    status: string,
    results: Array<{
      productIndex: number,
      platforms: any[],
      scrapedData: any[],
      originalSelection: any[],
    }>,
    summary: any[],
    completedAt: string,
    initialData?: Array<{}>,
    items?: Array<{ index: number; title?: string; thumb?: string; matchesCount?: number; matchJobId?: string }>,
    jobMap?: Record<number, { jobId: string; status?: string }>,
    matchJobId?: string,
    focusIndex?: number,
  };
  GenerateJobOverviewScreen: {
    /** @deprecated Use GenerateDetailsScreen directly. */
    jobId: string;
    matchJobId?: string;
    items?: Array<{ index: number; title?: string; thumb?: string; matchesCount?: number; matchJobId?: string }>;
    jobMap?: Record<number, { jobId: string; status?: string }>;
  };
  PhotoUpload: {
    onDone: (uris: string[]) => void;
  };
  PublishConfirmation: {
    productId?: string;
    variantId?: string;
    title?: string;
    description?: string;
    price?: number;
    imageUrl?: string;
    platforms?: string[];
    quantityByPlatform?: Record<string, number>;
  }
  OnboardConnectionScreen: {

  };
  ActivityFeed: undefined;
  PartnerAccept: {
    inviteCode?: string;
    inviteId?: string;
    initialDetails?: any;
  };
  PartnershipDetail: {
    partnership: any;
  };
  BackfillOptimizer: {
    newlyImportedIds?: string[];
    source?: string;
  } | undefined;
  CSVColumnMapping: {
    csvHeaders: string[];
    csvData: any[];
    sampleRow: Record<string, string>;
  };
  Backups: undefined;
  LiquidationCampaignScreen: { campaignId?: string; entryPoint?: 'tab' | 'detail' } | undefined;
  Partners: undefined;
};

type RootStackParamList = {
  AuthStack: { screen?: keyof AuthStackParamList };
  AppStack: { screen?: keyof AppStackParamList, params?: { initialScreenName: 'CreateAccountScreen' | 'TabNavigator' } }; // Allow passing initial screen for AppStack
  // Add other root-level screens/stacks
  // PhoneAuthScreen: { phoneNumber: string } | undefined; // Removed
};

// --- Use Param Lists in Navigator Definitions --- //
const Stack = createStackNavigator<RootStackParamList>();
const AuthStackNav = createStackNavigator<AuthStackParamList>();
const AppStackNav = createStackNavigator<AppStackParamList>();
const Tab = createBottomTabNavigator();

// Define TabNavigator separately - this fixes the "MainTabs doesn't exist" error
const TabNavigator = () => {
  const { lastNotificationResponse } = usePushNotifications();
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (lastNotificationResponse) {
      const data = lastNotificationResponse.notification.request.content.data;
      if (data?.type === 'inventory_shared') {
        // Navigate to Partners screen
        // We use a small timeout to ensure navigation is ready if coming from cold start
        setTimeout(() => {
          navigation.navigate('Partners');
        }, 500);
      }
    }
  }, [lastNotificationResponse]);

  // Create a custom tab bar style with rounded corners and horizontal padding
  const customTabBarStyle = {
    ...styles.tabBar,
    borderRadius: 30,
    marginHorizontal: 0,
    marginBottom: 16,
    overflow: 'hidden' as const,
    paddingHorizontal: 16,
    backgroundColor: '#ffffff',
    borderColor: "rgba(0, 0, 0, 0.07)",
    borderWidth: 2,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOpacity: 0.15,
        shadowRadius: 20,
        shadowOffset: { width: 0, height: 10 },
      },
      android: {
        elevation: 4,
      },
      default: {},
    }),
    position: 'absolute' as const,
    left: 12,
    right: 12,
    bottom: 18, //+ insets.bottom
    height: 84,
  };

  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: customTabBarStyle,
      }}

      tabBar={(props: any) => <TabBar {...props} style={customTabBarStyle} />}
      initialRouteName="Dashboard"
    >
      <Tab.Screen
        name="Dashboard"
        component={DashboardScreen}
        options={{
          tabBarLabel: 'Home',
          tabBarIcon: ({ color, size }: { color: string; size: number }) => (
            <Icon name="view-dashboard-outline" color={color} size={size} />
          ),
        }}
      />
      <Tab.Screen
        name="Inventory"
        component={InventoryOrdersScreen}
        options={{
          tabBarLabel: 'Inventory',
          tabBarIcon: ({ color, size }: { color: string; size: number }) => (
            <Icon name="package-variant" color={color} size={size} />
          ),
        }}
      />
      <Tab.Screen
        name="AddProduct"
        component={AddProductScreen}
        options={{
          tabBarLabel: 'Add Products',
          tabBarIcon: ({ color, size }: { color: string; size: number }) => (
            <Icon name="plus-circle-outline" color={color} size={size} />
          ),
        }}
      />
  

      <Tab.Screen
        name="Clearouts"
        component={LiquidationCampaignScreen}
        initialParams={{ entryPoint: 'tab' }}
        options={{
          tabBarLabel: 'Clearouts',
          tabBarIcon: ({ color, size, focused }: { color: string; size: number; focused: boolean }) => (
            <Icon
              name="cash-fast"
              color={focused ? "#FF9900" : color}
              size={size}
            />
          ),
        }}
      />
      <Tab.Screen
        name="Profile"
        component={ProfileScreen}
        options={{
          tabBarLabel: 'Settings',
          tabBarIcon: ({ color, size }: { color: string; size: number }) => (
            <Icon name="cog-outline" color={color} size={size} />
          ),
        }}
      />
    </Tab.Navigator>
  );
};

const AuthStack = ({ isFirstLaunch, devForceOnboarding }: { isFirstLaunch: boolean, devForceOnboarding: boolean }) => (
  <AuthStackNav.Navigator screenOptions={{ headerShown: false, animationEnabled: false }}>
    {(isFirstLaunch || devForceOnboarding) ? (
      <>
        <AuthStackNav.Screen name="InitialScreen" component={InitialScreen} />
        <AuthStackNav.Screen name="OnboardingSlides" component={OnboardingSlides} />
      </>
    ) : null}
    <AuthStackNav.Screen name="Auth" component={AuthScreen} />
    <AuthStackNav.Screen name="VerifyCode" component={VerifyCodeScreen} />
    <AppStackNav.Screen name="CreateAccountScreen" component={CreateAccountScreen} />
  </AuthStackNav.Navigator>
);

const AppStack = ({ initialScreenName }: { initialScreenName: 'CreateAccountScreen' | 'TabNavigator' }) => (
  <AppStackNav.Navigator
    screenOptions={{ headerShown: false }}
    initialRouteName={initialScreenName}
  >
    <AppStackNav.Screen name="PendingOrgInvitesScreen" component={PendingOrgInvitesScreen} />
    <AppStackNav.Screen name="CreateAccountScreen" component={CreateAccountScreen} />
    <AppStackNav.Screen name="Partners" component={PartnersScreen} />
    <AppStackNav.Screen name="LiquidationCampaignScreen" component={LiquidationCampaignScreen} options={{ headerTitle: 'Liquidation Campaign' }} />
    <AppStackNav.Screen name="TabNavigator" component={TabNavigator} />
    <AppStackNav.Screen name="ProductDetail" component={ProductDetailScreen} />
    <AppStackNav.Screen name="PastScans" component={PastScansScreen} />
    <AppStackNav.Screen name="MappingReview" component={MappingReviewScreen} />
    <AppStackNav.Screen name="SyncRules" component={SyncRulesScreen} />
    <AppStackNav.Screen name="Profile" component={ProfileScreen} />
    <AppStackNav.Screen name="DeleteAccountInfo" component={DeleteAccountInfoScreen} />
    <AppStackNav.Screen name="NotificationSettings" component={NotificationSettingsScreen} />
    <AppStackNav.Screen name="Team" component={TeamScreen} />
    <AppStackNav.Screen name="Billing" component={BillingScreen} />
    <AppStackNav.Screen name="AddProduct" component={AddProductScreen} />
    <AppStackNav.Screen name="LoadingScreen" component={LoadingScreen} />
    <AppStackNav.Screen name="MatchSelectionScreen" component={MatchSelectionScreen} />
    <AppStackNav.Screen name="GenerateDetailsScreen" component={GenerateDetailsScreen} />
    <AppStackNav.Screen name="PublishConfirmation" component={PublishConfirmationScreen} />
    <AppStackNav.Screen name="OnboardConnectionScreen" component={OnboardConnectionScreen} />
    <AppStackNav.Screen name="PartnerAccept" component={PartnerAcceptScreen} />
    <AppStackNav.Screen name="PartnershipDetail" component={PartnershipDetailScreen} />
    <AppStackNav.Screen name="BackfillOptimizer" component={BackfillOptimizerScreen} />
    <AppStackNav.Screen name="CSVColumnMapping" component={CSVColumnMappingScreen} />
    <AppStackNav.Screen name="ActivityFeed" component={ActivityFeedScreen} />
    <AppStackNav.Screen name="Backups" component={BackupsScreen} />
  </AppStackNav.Navigator>
);

// Prevent auto-hiding of splash screen
SplashScreen.preventAutoHideAsync();

const AppNavigator = () => {
  const { isLoaded: clerkLoaded, isSignedIn, signOut: clerkSignOut } = useAuth();
  const session = React.useContext(SessionContext);
  const [isLoading, setIsLoading] = useState(true);
  const [userToken, setUserToken] = useState<string | null>(null);
  const [isFirstLaunch, setIsFirstLaunch] = useState<boolean | null>(null);
  const [appIsReady, setAppIsReady] = useState(false);
  const [initialStackName, setInitialStackName] = useState<'AuthStack' | 'AppStack' | null>(null);
  const [initialAppScreen, setInitialAppScreen] = useState<'CreateAccountScreen' | 'TabNavigator' | null>(null);

  // Dev tools to test onboarding flow
  const [devForceOnboarding] = useState(false); // Set this to true only when testing onboarding - FTUX
  const [devExpireSession, setDevExpireSession] = useState(false); // Set true to make you have to login new each time you leave/after session expires

  const [fontsLoaded] = useFonts({
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_700Bold,
  });

  // Preload images
  useEffect(() => {
    async function prepare() {
      try {
        await Asset.loadAsync([
          require('../assets/scanner.png'),
          require('../assets/orbit.png'),
          require('../assets/SellEverywhere.png'),
          require('../assets/rounded_sssync.png'),
        ]);
      } catch (e) {
        console.warn(e);
      } finally {
        setAppIsReady(true);
      }
    }
    prepare();
  }, []);

  // Hide splash screen when everything is ready
  const onLayoutRootView = useCallback(async () => {
    if (appIsReady) {
      await SplashScreen.hideAsync();
    }
  }, [appIsReady]);

  // Fallback: force-hide splash after 2s in case onLayout isn't triggered
  useEffect(() => {
    const timer = setTimeout(() => {
      SplashScreen.hideAsync().catch(() => { });
    }, 2000);
    return () => clearTimeout(timer);
  }, []);

  // Log render state changes for debugging without injecting void into JSX
  useEffect(() => {
    console.log('[AppNavigator] render', { initialStackName, initialAppScreen, isLoading, clerkLoaded });
  }, [initialStackName, initialAppScreen, isLoading, clerkLoaded]);

  // Create authentication functions (Update signOut slightly)
  const authContext = React.useMemo((): AuthContextType => ({
    signIn: async (token: string) => {
      // Don't set isLoading false here, let the useEffect handle it
      setUserToken(token);
      try {
        await AsyncStorage.setItem('userToken', token);
      } catch (e) {
        console.log(e);
      }
    },
    // Make signOut effectively synchronous for state update, but return Promise for type compatibility
    signOut: async () => {
      console.log("[AuthContext] signOut called, clearing tokens and Clerk session.")
      setUserToken(null);
      AsyncStorage.removeItem('userToken').catch(() => { });
      try { stopClerkSupabaseBridge(); } catch { }
      if (clerkSignOut) {
        try {
          await clerkSignOut();
        } catch (e: any) {
          // Handle common Clerk sign-out errors gracefully
          // - "You are signed out" means we're already signed out
          // - "Cannot read property 'origin'" is a web-specific error on React Native
          const errorMsg = e?.message || String(e);
          if (errorMsg.includes('signed out') || errorMsg.includes('origin')) {
            console.log('[AuthContext] Sign out completed (expected error on React Native)');
          } else {
            console.error('[AuthContext] Sign out error:', e);
          }
        }
      }
      return Promise.resolve();
    },
    signUp: async (token: string) => {
      // Don't set isLoading false here
      setUserToken(token);
      try {
        await AsyncStorage.setItem('userToken', token);
      } catch (e) {
        console.log(e);
      }
    }
  }), [clerkSignOut]); // Remove navigation dependency

  // Initial launch check: only determine onboarding slides visibility; don't infer auth from legacy tokens
  useEffect(() => {
    (async () => {
      try {
        const alreadyLaunched = await AsyncStorage.getItem('alreadyLaunched');
        const firstLaunch = alreadyLaunched === null;
        if (firstLaunch) await AsyncStorage.setItem('alreadyLaunched', 'true');
        setIsFirstLaunch(firstLaunch);
      } catch (e) {
        console.log('Initial launch check error:', e);
        setIsFirstLaunch(true);
      }
    })();
  }, []);

  // Note: Clerk team sync is now handled automatically via backend webhooks
  // The sync-clerk-teams endpoint was removed - orgs are synced on login

  // Simplified: just determine which stack to show based on auth state
  useEffect(() => {
    if (!clerkLoaded) return;
    const next = isSignedIn ? 'AppStack' : 'AuthStack';
    setInitialStackName(next);
    if (isSignedIn) {
      // Default to TabNavigator to avoid blank UI, then refine after check
      setInitialAppScreen('TabNavigator');
      setIsLoading(true);
      checkOnboardingAndNavigate();
    } else {
      setInitialAppScreen(null);
      setIsLoading(false);
    }
  }, [clerkLoaded, isSignedIn]);

  // Add AppState listener for session expiry
  useEffect(() => {
    const handleAppStateChange = (nextAppState: AppStateStatus) => {
      if (devExpireSession && nextAppState === 'background') {
        // Clear session when app backgrounds
        AsyncStorage.removeItem('userToken');
      }
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);
    return () => subscription.remove();
  }, [devExpireSession]);

  const checkOnboardingAndNavigate = async () => {
    try {
      // Ensure Supabase is ready
      await ensureSupabaseJwt();

      // We use the shimmed getUser which returns DB user data
      const { data: { user }, error: getUserError } = await supabase.auth.getUser();

      // If they are signed into Clerk but we can't find them in the DB,
      // it means they haven't finished the onboarding form yet.
      if (!user) {
        console.log("[Onboarding Check] Clerk authenticated but no DB user found. Going to CreateAccountScreen");
        setInitialAppScreen('CreateAccountScreen');
        setIsLoading(false);
        return;
      }

      // If we DID find them, check if they finished the onboarding steps
      // Note: The 'me' view might already imply some consistency, but let's check the flag
      const { data: dbUser, error: dbError } = await supabase
        .from('Users')
        .select('isOnboardingComplete')
        .eq('Id', user.id)
        .maybeSingle();

      if (dbError) {
        console.error("[Onboarding Check] DB fetch error:", dbError);
        setInitialAppScreen('TabNavigator');
      } else if (dbUser?.isOnboardingComplete) {
        console.log(`[Onboarding Check] User ID: ${user.id} - Onboarding complete. Going to TabNavigator`);
        setInitialAppScreen('TabNavigator');
      } else {
        console.log(`[Onboarding Check] User ID: ${user.id} - Onboarding INCOMPLETE in DB. Going to CreateAccountScreen`);
        setInitialAppScreen('CreateAccountScreen');
      }

    } catch (error) {
      console.error("Error during onboarding check:", error);
      setInitialAppScreen('TabNavigator');
    } finally {
      setIsLoading(false);
    }
  };

  // Keep UI hidden only until assets are ready (avoid full blank on auth state transitions)
  if (!appIsReady) {
    return null;
  }

  if (isLoading || !clerkLoaded || (isSignedIn && !initialAppScreen)) {
    return null; // Or show a SplashScreen component
  }
  return (
    <View style={{ flex: 1 }} onLayout={onLayoutRootView}>
      <AuthContext.Provider value={authContext}>
        <Stack.Navigator
          key={`${initialStackName}-${isSignedIn}-${initialAppScreen ?? 'none'}`}
          initialRouteName={initialStackName ?? (isSignedIn ? 'AppStack' : 'AuthStack')}
          screenOptions={{
            headerShown: false,
            headerShadowVisible: false,
            headerBackTitleVisible: false,
            headerTitle: () => null
          }}
        >
          <Stack.Screen name="AuthStack">
            {(props: any) => <AuthStack {...props} isFirstLaunch={isFirstLaunch ?? true} devForceOnboarding={devForceOnboarding} />}
          </Stack.Screen>

          <Stack.Screen name="AppStack">
            {(props: any) => {
              // Check both navigation params and local state for initial screen
              const navInitialScreen = props?.route?.params?.initialScreenName;
              const effectiveInitialScreen = navInitialScreen || initialAppScreen || 'TabNavigator';
              console.log('[AppNavigator] AppStack render - navInitialScreen:', navInitialScreen, 'localInitialScreen:', initialAppScreen, 'effective:', effectiveInitialScreen);

              return <AppStack initialScreenName={effectiveInitialScreen} />;
            }}
          </Stack.Screen>

        </Stack.Navigator>
      </AuthContext.Provider>
    </View>
  );
};

export default AppNavigator; 
