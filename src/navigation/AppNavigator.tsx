import React, { useEffect, useState, useCallback } from 'react';
import { CardStyleInterpolators, createStackNavigator, StackScreenProps } from '@react-navigation/stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import AsyncStorage from '@react-native-async-storage/async-storage';
import TabBar from '../components/TabBar';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
// import { Camera } from 'lucide-react-native';
import { AppState, AppStateStatus } from 'react-native';
import { CommonActions } from '@react-navigation/native';
import { useAuth } from '@clerk/clerk-expo';
import { NavigationContainer, useNavigation } from '@react-navigation/native';
import { ActivityIndicator, View } from 'react-native';
import { Asset } from 'expo-asset';
import * as SplashScreen from 'expo-splash-screen';
import { useFonts } from 'expo-font';
import AppStartupShell from '../components/AppStartupShell';
import {
  PlusJakartaSans_400Regular,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
  PlusJakartaSans_800ExtraBold,
} from '@expo-google-fonts/plus-jakarta-sans';
// import { CirclePlus } from 'lucide-react-native';
import OnboardConnectionScreen from '../screens/OnboardConnectionScreen';
import { usePushNotifications } from '../hooks/usePushNotifications';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// Import the context from its new location
import { AuthContext, AuthContextType } from '../context/AuthContext';
import { OnboardingCheckContext } from '../context/OnboardingCheckContext';
import { supabase, stopClerkSupabaseBridge, ensureSupabaseJwt, getUserLike } from '../lib/supabase';
// Screens
import InitialScreen from '../screens/InitialScreen';
import OnboardingSlides from '../screens/OnboardingSlides';
import AuthScreen from '../screens/AuthScreen';
import DashboardScreen from '../screens/DashboardScreen';
import GlobalSearchScreen from '../screens/GlobalSearchScreen';
import InventoryOrdersScreen from '../screens/InventoryOrdersScreen';
import MarketplaceScreen from '../screens/MarketplaceScreen';
import ProfileScreen from '../screens/ProfileScreen';
import NotificationSettingsScreen from '../screens/NotificationSettingsScreen';
import ProductDetailScreen from '../screens/ProductDetail';
import PhoneAuthScreen from '../screens/PhoneAuthScreen';
import CreateAccountScreen from '../screens/CreateAccountScreen';
import AccountSyncIssueScreen from '../screens/AccountSyncIssueScreen';
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
import ImportOverviewScreen from '../screens/ImportOverviewScreen';
import PendingOrgInvitesScreen from '../screens/PendingOrgInvitesScreen';
import LiquidationCampaignScreen from '../screens/LiquidationCampaignScreen';
import SproutHomeScreen from '../screens/SproutHomeScreen';
import CampaignThreadScreen from '../screens/CampaignThreadScreen';
import BackupsScreen from '../screens/BackupsScreen';
import BillingScreen from '../screens/BillingScreen';
import BillingSupportScreen from '../screens/BillingSupportScreen';
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
  AccountSyncIssueScreen: undefined;
  TabNavigator: undefined;
  Dashboard: undefined;
  GlobalSearch: undefined;
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
      confirmedQuickMatchByItemId?: Record<string, {
        serpApiData: any[];
        preSelectedIndices: number[];
        source?: 'quick_scan_auto' | 'quick_scan_confirmed';
        confidence?: number;
        reasoning?: string;
      }>;
      userAssistDecisions?: Record<number, {
        confirmedCandidateIndex?: number;
        deniedCandidateIndices?: number[];
        refineText?: string;
        generateBestGuess?: boolean;
        state?: 'pending' | 'submitted' | 'failed';
      }>;
      assistTransitionToken?: string;
      assistSourceItemIndex?: number;
      resumeFromAssist?: boolean;
      // When true, LoadingScreen will NOT early-navigate to MatchSelectionScreen.
      // It will wait for the job to complete so it can respect skipToGenerate/autoGenerateJobId.
      skipMatchSelection?: boolean;
      autoGenerateAllPlatforms?: boolean;
      resultIndexMap?: Record<number, number>;
    };
    onCompleteRoute: {
      screen: keyof AppStackParamList;
      params?: any;
    };
  };
  ProductDetail: { productId: string };
  PastScans: undefined;
  ImportOverview: { connectionId: string; platformName: string; jobId?: string; };
  MappingReview: { connectionId: string; platformName: string; jobId?: string; importedProducts?: any[]; isCSVImport?: boolean; isScanning?: boolean; scanStartTime?: number; };
  SyncRules: { connectionId: string };
  Profile: { refresh?: number };
  DeleteAccountInfo: undefined;
  NotificationSettings: undefined;
  Team: undefined;
  Billing: undefined;
  BillingSupport: {
    context?: {
      planName?: string;
      subscriptionStatus?: string;
      aiAllowanceCents?: number;
      aiUsedCents?: number;
    };
  } | undefined;
  AddProduct: {
    firstPhotos?: any[];
    bulkItems?: any[];
    sessionId?: string;
  } | undefined;
  MatchSelectionScreen: {
    jobResponse?: JobResponse;
    jobId?: string;
    focusIndex?: number;
    overrideFocusIndex?: number;
    overrideResults?: any[];
    isNewScan?: boolean;
    items?: Array<{ index: number; title?: string; thumb?: string; matchesCount?: number; matchJobId?: string }>;
    jobMap?: Record<number, { jobId: string; status?: string }>;
    preResolvedSelections?: Record<number, number[]>;
    preDeniedSelections?: Record<number, number[]>;
    preRefineTextByIndex?: Record<number, string>;
    bestGuessByIndex?: Record<number, boolean>;
    returnToLoading?: AppStackParamList['LoadingScreen'];
    response?: {
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
  LiquidationCampaignScreen: { campaignId: string; entryPoint?: 'tab' | 'detail' } | undefined;
  CampaignThreadScreen: { campaignId: string; title?: string } | undefined;
  SproutHomeScreen: undefined;
  Partners: undefined;
};

type RootStackParamList = {
  AuthStack: { screen?: keyof AuthStackParamList };
  AppStack: { screen?: keyof AppStackParamList, params?: { initialScreenName: 'CreateAccountScreen' | 'AccountSyncIssueScreen' | 'TabNavigator' } }; // Allow passing initial screen for AppStack
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

  const tabBarBottom = Math.max(18, insets.bottom);
  const TAB_ROW_HEIGHT = 64;
  const TAB_FADE_HEIGHT = 36;
  const tabBarContainerStyle = {
    position: 'absolute' as const,
    left: 0,
    right: 0,
    bottom: 0,
    height: TAB_ROW_HEIGHT + tabBarBottom + TAB_FADE_HEIGHT,
    backgroundColor: 'transparent',
    overflow: 'visible' as const,
  };
  const tabBarSurfaceStyle = {
    borderRadius: 32,
    paddingHorizontal: 6,
    backgroundColor: '#ffffff',
    borderColor: 'rgba(0, 0, 0, 0.07)',
    borderWidth: 1.5,
    height: TAB_ROW_HEIGHT,
  };

  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: tabBarContainerStyle,
      }}

      tabBar={(props: any) => (
        <TabBar
          {...props}
          containerStyle={tabBarContainerStyle}
          surfaceStyle={tabBarSurfaceStyle}
          bottomInset={tabBarBottom}
          rowHeight={TAB_ROW_HEIGHT}
        />
      )}
      initialRouteName="Inventory"
    >
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
        name="Clearouts"
        component={SproutHomeScreen}
        options={{
          tabBarLabel: 'Sprout',
          tabBarIcon: ({ color, size }: { color: string; size: number }) => (
            <Icon name="emoticon-outline" color={color} size={size} />
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
      <Tab.Screen
        name="AddProduct"
        component={AddProductScreen}
        options={{
          tabBarButton: () => null,
          tabBarItemStyle: { display: 'none' },
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

const AppStack = ({ initialScreenName }: { initialScreenName: 'CreateAccountScreen' | 'AccountSyncIssueScreen' | 'TabNavigator' }) => (
  <AppStackNav.Navigator
    screenOptions={{ headerShown: false }}
    initialRouteName={initialScreenName}
  >
    <AppStackNav.Screen name="PendingOrgInvitesScreen" component={PendingOrgInvitesScreen} />
    <AppStackNav.Screen name="CreateAccountScreen" component={CreateAccountScreen} />
    <AppStackNav.Screen name="AccountSyncIssueScreen" component={AccountSyncIssueScreen} />
    <AppStackNav.Screen name="Partners" component={PartnersScreen} />
    <AppStackNav.Screen name="LiquidationCampaignScreen" component={LiquidationCampaignScreen} options={{ headerTitle: 'Campaign Items', animationEnabled: false }} />
    <AppStackNav.Screen name="SproutHomeScreen" component={SproutHomeScreen} options={{ headerTitle: 'Sprout' }} />
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
    <AppStackNav.Screen name="BillingSupport" component={BillingSupportScreen} />
    <AppStackNav.Screen name="Dashboard" component={DashboardScreen} />
    <AppStackNav.Screen
      name="GlobalSearch"
      component={GlobalSearchScreen}
      options={{
        animationEnabled: true,
        gestureEnabled: true,
        gestureDirection: 'vertical',
        cardStyleInterpolator: CardStyleInterpolators.forVerticalIOS,
        cardStyle: { backgroundColor: '#000000' },
      }}
    />
    <AppStackNav.Screen name="LoadingScreen" component={LoadingScreen} />
    <AppStackNav.Screen
      name="MatchSelectionScreen"
      component={MatchSelectionScreen}
      options={{
        cardStyleInterpolator: CardStyleInterpolators.forFadeFromBottomAndroid,
      }}
    />
    <AppStackNav.Screen name="GenerateDetailsScreen" component={GenerateDetailsScreen} />
    <AppStackNav.Screen name="PublishConfirmation" component={PublishConfirmationScreen} />
    <AppStackNav.Screen name="OnboardConnectionScreen" component={OnboardConnectionScreen} />
    <AppStackNav.Screen name="PartnerAccept" component={PartnerAcceptScreen} />
    <AppStackNav.Screen name="PartnershipDetail" component={PartnershipDetailScreen} />
    <AppStackNav.Screen name="BackfillOptimizer" component={BackfillOptimizerScreen} />
    <AppStackNav.Screen name="ImportOverview" component={ImportOverviewScreen} />
    <AppStackNav.Screen name="CSVColumnMapping" component={CSVColumnMappingScreen} />
    <AppStackNav.Screen name="ActivityFeed" component={ActivityFeedScreen} />
    <AppStackNav.Screen name="Backups" component={BackupsScreen} />
    <AppStackNav.Screen name="CampaignThreadScreen" component={CampaignThreadScreen} options={{ headerTitle: 'Campaign Thread', animationEnabled: false }} />
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
  const [initialAppScreen, setInitialAppScreen] = useState<'CreateAccountScreen' | 'AccountSyncIssueScreen' | 'TabNavigator' | null>(null);
  const [retryOnboardingTrigger, setRetryOnboardingTrigger] = useState(0);
  const [lastOnboardingDebugInfo, setLastOnboardingDebugInfo] = useState('');

  // Dev tools to test onboarding flow
  const [devForceOnboarding] = useState(false); // Set this to true only when testing onboarding - FTUX
  const [devExpireSession, setDevExpireSession] = useState(false); // Set true to make you have to login new each time you leave/after session expires

  const [fontsLoaded] = useFonts({
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
    PlusJakartaSans_800ExtraBold,
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

  const onboardingCheckContextValue = React.useMemo(() => ({
    retryOnboardingCheck: () => {
      setIsLoading(true);
      setRetryOnboardingTrigger(t => t + 1);
    },
    debugInfo: lastOnboardingDebugInfo,
  }), [lastOnboardingDebugInfo]);

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
      if (!session?.bridgeReady) {
        setIsLoading(false);
        return;
      }
      setIsLoading(true);
      checkOnboardingAndNavigate();
    } else {
      setInitialAppScreen(null);
      setIsLoading(false);
    }
  }, [clerkLoaded, isSignedIn, session?.bridgeReady, session?.user?.id, retryOnboardingTrigger]);

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
      let token: string | null = null;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        token = await ensureSupabaseJwt();
        if (token) {
          break;
        }

        if (attempt < 2) {
          await new Promise((resolve) => setTimeout(resolve, 300));
        }
      }

      if (!token) {
        console.warn('[Onboarding Check] Supabase token unavailable. Keeping existing signed-in user on TabNavigator.');
        setInitialAppScreen('TabNavigator');
        return;
      }

      // Resolve canonical user id from me view (JWT sub) — not stale session.user.id
      const { user: me } = await getUserLike();
      const userId = me?.id;
      if (!userId) {
        const debug = `me=null | session.user.id=${session?.user?.id ?? 'null'}`;
        setLastOnboardingDebugInfo(debug);
        console.warn('[Onboarding Check] me view returned no user (JWT sub mismatch or no row). Showing AccountSyncIssue.');
        setInitialAppScreen('AccountSyncIssueScreen');
        return;
      }

      const { data: dbUser, error: dbError } = await supabase
        .from('Users')
        .select('isOnboardingComplete')
        .eq('Id', userId)
        .maybeSingle();

      if (dbError) {
        const debug = `dbError=${dbError.message} | userId=${userId}`;
        setLastOnboardingDebugInfo(debug);
        console.error("[Onboarding Check] DB fetch error:", dbError);
        setInitialAppScreen('AccountSyncIssueScreen');
      } else if (!dbUser) {
        const debug = `no Users row | userId=${userId} | me.id=${me?.id}`;
        setLastOnboardingDebugInfo(debug);
        console.log(`[Onboarding Check] No Users row found for ${userId}. Showing AccountSyncIssue (ambiguous).`);
        setInitialAppScreen('AccountSyncIssueScreen');
      } else if (dbUser?.isOnboardingComplete) {
        console.log(`[Onboarding Check] User ID: ${userId} - Onboarding complete. Going to TabNavigator`);
        setInitialAppScreen('TabNavigator');
      } else {
        console.log(`[Onboarding Check] User ID: ${userId} - Onboarding INCOMPLETE in DB. Going to CreateAccountScreen`);
        setInitialAppScreen('CreateAccountScreen');
      }

    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      setLastOnboardingDebugInfo(`catch: ${errMsg}`);
      console.error("Error during onboarding check:", error);
      setInitialAppScreen('AccountSyncIssueScreen');
    } finally {
      setIsLoading(false);
    }
  };

  // Keep UI hidden only until assets are ready (avoid full blank on auth state transitions)
  if (!appIsReady) {
    return (
      <AppStartupShell
        title="Loading app shell"
        message="Preparing local assets so the app can stay usable even if services are degraded."
      />
    );
  }

  if (isLoading || !clerkLoaded || (isSignedIn && !initialAppScreen)) {
    return (
      <AppStartupShell
        title="Restoring navigation"
        message={
          session?.bootstrapError ||
          'Checking sign-in state and rebuilding your last known workspace.'
        }
      />
    );
  }
  return (
    <View style={{ flex: 1 }} onLayout={onLayoutRootView}>
      <AuthContext.Provider value={authContext}>
        <OnboardingCheckContext.Provider value={onboardingCheckContextValue}>
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
              const effectiveInitialScreen = (navInitialScreen || initialAppScreen || 'TabNavigator') as 'CreateAccountScreen' | 'AccountSyncIssueScreen' | 'TabNavigator';
              return <AppStack initialScreenName={effectiveInitialScreen} />;
            }}
          </Stack.Screen>

        </Stack.Navigator>
        </OnboardingCheckContext.Provider>
      </AuthContext.Provider>
    </View>
  );
};

export default AppNavigator; 
