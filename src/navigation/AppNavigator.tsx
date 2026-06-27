import React, { useEffect, useState, useCallback, useRef } from 'react';
import { CardStyleInterpolators, createStackNavigator, StackScreenProps } from '@react-navigation/stack';
import { withSwipeBack } from '../components/withSwipeBack';
import { SwipeBackProvider } from '../components/SwipeBackContext';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { purgeClerkAndAuthCaches } from '../utils/authCleanup';
import TabBar from '../components/TabBar';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
// import { Camera } from 'lucide-react-native';
import { AppState, AppStateStatus } from 'react-native';
import { CommonActions } from '@react-navigation/native';
import { useAuth, useClerk } from '@clerk/clerk-expo';
import { NavigationContainer, useNavigation } from '@react-navigation/native';
import { ActivityIndicator, View, Text, StyleSheet } from 'react-native';
import { Asset } from 'expo-asset';
import * as SplashScreen from 'expo-splash-screen';
import { useFonts } from 'expo-font';
import AppStartupShell from '../components/AppStartupShell';
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  Inter_800ExtraBold,
} from '@expo-google-fonts/inter';
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
import GlobalSearchScreen from '../screens/GlobalSearchScreen';
import InventoryOrdersScreen from '../screens/InventoryOrdersScreen';
import ImportProgressBanner from '../components/ImportProgressBanner';
import ProfileScreen from '../screens/ProfileScreen';
import SettingsScreen from '../screens/SettingsScreen';
import ConnectionsScreen from '../screens/ConnectionsScreen';
import PrivacySecurityScreen from '../screens/PrivacySecurityScreen';
import AccountLoginScreen from '../screens/AccountLoginScreen';
import PoolDetailScreen from '../screens/PoolDetailScreen';
import NotificationSettingsScreen from '../screens/NotificationSettingsScreen';
import ProductDetailScreen from '../screens/ProductDetail';
import CreateAccountScreen from '../screens/CreateAccountScreen';
import AccountSyncIssueScreen from '../screens/AccountSyncIssueScreen';
// NOTE: PhoneAuthScreen was removed — phone verification now goes through VerifyCodeScreen.
import PastScansScreen from '../screens/PastScansScreen';
import TeamScreen from '../screens/TeamScreen';
import MappingReviewScreen from '../screens/MappingReviewScreen';
import SyncRulesScreen from '../screens/SyncRulesScreen';
import AddProductScreen from '../screens/AddProductScreen';
// LoadingScreen + MatchSelectionScreen were deprecated and deleted. Their param
// SHAPES are retained in AppStackParamList below (the LoadingScreen entry is the
// canonical "active flow" payload used by activeFlowPersistence; no route is
// registered, so nothing can navigate to either).
// Relocated from the deleted MatchSelectionScreen — the match-job submit response
// shape, still referenced by the param types below.
export interface JobResponse {
  jobId: string;
  status?: string;
  estimatedTimeMinutes?: number;
  totalProducts?: number;
  message?: string;
}
import GenerateDetailsScreen from '../screens/GenerateDetailsScreen';
import VerifyCodeScreen from '../screens/VerifyCodeScreen';
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
import CampaignSettingsScreen from '../screens/CampaignSettingsScreen';
import CampaignInventorySelectScreen from '../screens/CampaignInventorySelectScreen';
import SproutHomeScreen from '../screens/SproutHomeScreen';
import CampaignThreadScreen from '../screens/CampaignThreadScreen';
import BackupsScreen from '../screens/BackupsScreen';
import BillingScreen from '../screens/BillingScreen';
import BillingSupportScreen from '../screens/BillingSupportScreen';
import DeleteAccountInfoScreen from '../screens/DeleteAccountInfoScreen';
import { SessionContext } from '../context/SessionContext';
import { createLogger } from '../utils/logger';
const log = createLogger('AppNavigator');


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
      /**
       * ID-BASED handoff (canonical going forward): cart$ item ids this run covers.
       * Prefer resolving item data from the cart store by id over the index-coupled
       * bulkItems/resultIndexMap fields below (kept for un-migrated consumers).
       */
      itemIds?: string[];
      bulkItems?: any[];
      confirmedQuickMatchByItemId?: Record<string, {
        matchRows: any[];
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
  AccountSettings: { refresh?: number } | undefined;
  Connections: undefined;
  PrivacySecurity: undefined;
  AccountLogin: undefined;
  PoolDetail: { poolId: string; name?: string; isPartnerPool?: boolean };
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
          matchRows: Array<{
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
            matchMs: number;
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
    /** ID-BASED handoff (canonical): the screen resolves items/jobs from cart$ by id. */
    itemIds?: string[],
    focusItemId?: string,
    /** Optional pre-fetched results (the screen also polls by jobId). */
    results?: Array<{
      productIndex: number,
      platforms: any[],
      scrapedData: any[],
      originalSelection: any[],
    }>,
    summary?: any[],
    completedAt?: string,
    initialData?: Array<{}>,
    /** Legacy index-shaped fallbacks — emitted by buildGenerateDetailsLaunch (src/features/cart/flowPayloads.ts). */
    items?: Array<{ index: number; title?: string; thumb?: string; matchesCount?: number; matchJobId?: string }>,
    /** Missing index = no generate job for that item. */
    jobMap?: Record<number, { jobId: string; status?: string }>,
    userImagesByIndex?: Record<number, string[]>,
    matchJobId?: string,
    focusIndex?: number,
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
    connectionId?: string;
    platformName?: string;
  } | undefined;
  CSVColumnMapping: {
    csvHeaders: string[];
    csvData: any[];
    sampleRow: Record<string, string>;
  };
  Backups: undefined;
  LiquidationCampaignScreen: { campaignId: string; entryPoint?: 'tab' | 'detail' } | undefined;
  CampaignSettings: { campaignId: string; title?: string } | undefined;
  CampaignInventorySelect: { campaignId: string; title?: string } | undefined;
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
      } else if ((data?.type === 'sprout_insight' || data?.type === 'sprout_reply') && data?.campaignId) {
        // A Sprout ping (a reply, sale, needs-you, or digest) → open that campaign's
        // thread so the freshly posted message is right there.
        setTimeout(() => {
          navigation.navigate('CampaignThreadScreen', { campaignId: String(data.campaignId) });
        }, 500);
      } else if (data?.type === 'job_complete' || data?.type === 'listing_ready') {
        // Import / sync / listing-generation finished — deep-link the user to their
        // inventory so they can pick up where they left off (review + publish).
        setTimeout(() => {
          navigation.navigate('Inventory');
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
    <>
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: tabBarContainerStyle,
      }}

      tabBar={(props: any) => {
        // Capture screen is full-bleed camera chrome (Shop-style): no navigator row.
        // Its own bottom controls carry Back / shutter / mode + the cart CTA.
        const focusedRouteName = props.state?.routes?.[props.state?.index]?.name;
        if (focusedRouteName === 'AddProduct') return null;
        // A screen can hand its bottom spot to a floating action pill (e.g. home's
        // multi-select bar) by setting tabBarStyle: { display: 'none' }.
        const focusedKey = props.state?.routes?.[props.state?.index]?.key;
        const tbStyle = focusedKey ? props.descriptors?.[focusedKey]?.options?.tabBarStyle : undefined;
        const tabBarHidden = Array.isArray(tbStyle)
          ? tbStyle.some((s: any) => s && s.display === 'none')
          : tbStyle?.display === 'none';
        if (tabBarHidden) return null;
        return (
          <TabBar
            {...props}
            containerStyle={tabBarContainerStyle}
            surfaceStyle={tabBarSurfaceStyle}
            bottomInset={tabBarBottom}
            rowHeight={TAB_ROW_HEIGHT}
          />
        );
      }}
      initialRouteName="Clearouts"
    >
      {/* Sprout home is the leftmost tab and the landing screen. */}
      <Tab.Screen
        name="Clearouts"
        component={SproutHomeScreen}
        options={{
          tabBarLabel: 'Home',
          tabBarAccessibilityLabel: 'Home',
          tabBarIcon: ({ color, size }: { color: string; size: number }) => (
            <Icon name="home-variant-outline" color={color} size={size} />
          ),
        }}
      />
      <Tab.Screen
        name="Inventory"
        component={InventoryOrdersScreen}
        options={{
          tabBarLabel: 'Inventory',
          tabBarAccessibilityLabel: 'Inventory',
          tabBarIcon: ({ color, size }: { color: string; size: number }) => (
            <Icon name="package-variant" color={color} size={size} />
          ),
        }}
      />
      <Tab.Screen
        name="Profile"
        component={SettingsScreen}
        options={{
          tabBarLabel: 'Profile',
          tabBarAccessibilityLabel: 'Profile',
          tabBarIcon: ({ color, size }: { color: string; size: number }) => (
            <Icon name="account-outline" color={color} size={size} />
          ),
        }}
      />
      <Tab.Screen
        name="AddProduct"
        // Black camera screen with its own sheet/vertical gestures: PIN mode (no page
        // translate — that was eating the sheets' swipe-down) draws the ring around the real
        // 44×44 back button. It also calls useSuppressSwipeBackWhen(isAnySheetVisible).
        // The ring anchors to the back button's MEASURED window rect (publishBackButtonRect
        // in AddProductScreen), so it tracks the real 44×44 button on any device. pinTop/
        // pinLeft are only a pre-measure fallback, never seen (the ring is invisible at rest).
        // onBack mirrors the real back button exactly (goBack, else Inventory) so the swipe
        // works on every revisit, not just the first.
        component={sb(AddProductScreen, {
          mode: 'pin', size: 44, pinLeft: 16, accent: '#FFFFFF',
          // Deterministic back: pop the current navigator if it can, else pop the parent
          // stack (returns to the camera/chat that pushed us), else land on Home. Always
          // navigates somewhere — previously a tab-level goBack could no-op (swipe ring
          // filled but the screen never moved).
          onBack: (nav: any) => {
            if (nav.canGoBack?.()) { nav.goBack(); return; }
            const parent = nav.getParent?.();
            if (parent?.canGoBack?.()) { parent.goBack(); return; }
            nav.navigate('Clearouts');
          },
        })}
        options={{
          tabBarButton: () => null,
          tabBarItemStyle: { display: 'none' },
        }}
      />
    </Tab.Navigator>
    <ImportProgressBanner />
    </>
  );
};

const AuthStack = ({ showOnboarding }: { showOnboarding: boolean }) => (
  <AuthStackNav.Navigator screenOptions={{ headerShown: false, animationEnabled: false }}>
    {showOnboarding ? (
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

// Apply the left-swipe-back ring to every app-stack screen by default. Cache by component
// so each screen wraps exactly once (stable identity → no remount on AppStack re-render).
const sbCache = new Map<React.ComponentType<any>, React.ComponentType<any>>();
const sb = (C: React.ComponentType<any>, opts?: { surface?: string; mode?: 'slide' | 'pin'; size?: number; pinTop?: number; pinLeft?: number; accent?: string; armed?: string; onBack?: (navigation: any) => void }) => {
  let w = sbCache.get(C);
  if (!w) { w = withSwipeBack(C, opts); sbCache.set(C, w); }
  return w;
};

const AppStack = ({ initialScreenName }: { initialScreenName: 'CreateAccountScreen' | 'AccountSyncIssueScreen' | 'TabNavigator' }) => (
  <AppStackNav.Navigator
    // gestureEnabled:false kills react-navigation's native edge-swipe (the peek). SwipeBackRing
    // (via sb()/withSwipeBack on each screen) owns the back gesture now. Per-screen options can
    // still re-enable it (e.g. GlobalSearch's vertical dismiss).
    screenOptions={{ headerShown: false, gestureEnabled: false }}
    initialRouteName={initialScreenName}
  >
    <AppStackNav.Screen name="PendingOrgInvitesScreen" component={sb(PendingOrgInvitesScreen)} />
    <AppStackNav.Screen name="CreateAccountScreen" component={sb(CreateAccountScreen)} />
    <AppStackNav.Screen name="AccountSyncIssueScreen" component={sb(AccountSyncIssueScreen)} />
    <AppStackNav.Screen name="Partners" component={sb(PartnersScreen)} />
    <AppStackNav.Screen name="LiquidationCampaignScreen" component={sb(LiquidationCampaignScreen)} options={{ headerTitle: 'Inventory', animationEnabled: false }} />
    <AppStackNav.Screen name="CampaignSettings" component={sb(CampaignSettingsScreen)} options={{ headerShown: false }} />
    <AppStackNav.Screen name="CampaignInventorySelect" component={sb(CampaignInventorySelectScreen)} options={{ headerShown: false }} />
    <AppStackNav.Screen name="SproutHomeScreen" component={sb(SproutHomeScreen)} options={{ headerTitle: 'Sprout' }} />
    <AppStackNav.Screen name="TabNavigator" component={TabNavigator} />
    <AppStackNav.Screen name="ProductDetail" component={sb(ProductDetailScreen)} />
    <AppStackNav.Screen name="PastScans" component={sb(PastScansScreen)} />
    <AppStackNav.Screen name="MappingReview" component={sb(MappingReviewScreen)} />
    <AppStackNav.Screen name="SyncRules" component={sb(SyncRulesScreen)} />
    {/* Legacy account/profile mega-screen. Registered ONLY as 'AccountSettings' —
        a stack route also named 'Profile' collided with the Profile TAB and made
        navigate('Profile') push this legacy screen over the tabs. */}
    <AppStackNav.Screen name="AccountSettings" component={sb(ProfileScreen)} />
    <AppStackNav.Screen name="Connections" component={sb(ConnectionsScreen)} options={{ headerShown: false }} />
    <AppStackNav.Screen name="PrivacySecurity" component={sb(PrivacySecurityScreen)} options={{ headerShown: false }} />
    <AppStackNav.Screen name="AccountLogin" component={sb(AccountLoginScreen)} options={{ headerShown: false }} />
    <AppStackNav.Screen name="PoolDetail" component={sb(PoolDetailScreen)} options={{ headerShown: false }} />
    <AppStackNav.Screen name="DeleteAccountInfo" component={sb(DeleteAccountInfoScreen)} />
    <AppStackNav.Screen name="NotificationSettings" component={sb(NotificationSettingsScreen)} />
    <AppStackNav.Screen name="Team" component={sb(TeamScreen)} />
    <AppStackNav.Screen name="Billing" component={sb(BillingScreen)} />
    <AppStackNav.Screen name="BillingSupport" component={sb(BillingSupportScreen)} />
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
    {/* LoadingScreen + MatchSelectionScreen deprecated and removed — no routes registered. */}
    <AppStackNav.Screen
      name="GenerateDetailsScreen"
      component={sb(GenerateDetailsScreen)}
      options={{
        // Kill react-navigation's interactive swipe-back (the card-slide that peeks the
        // screen below). The in-screen SwipeBackRing owns the back gesture now; fade the
        // pop so goBack() never reveals the previous screen horizontally either.
        gestureEnabled: false,
        cardStyleInterpolator: CardStyleInterpolators.forFadeFromBottomAndroid,
      }}
    />
    <AppStackNav.Screen name="PublishConfirmation" component={sb(PublishConfirmationScreen)} />
    <AppStackNav.Screen name="OnboardConnectionScreen" component={sb(OnboardConnectionScreen)} />
    <AppStackNav.Screen name="PartnerAccept" component={sb(PartnerAcceptScreen)} />
    <AppStackNav.Screen name="PartnershipDetail" component={sb(PartnershipDetailScreen)} />
    <AppStackNav.Screen name="BackfillOptimizer" component={sb(BackfillOptimizerScreen)} />
    <AppStackNav.Screen name="ImportOverview" component={sb(ImportOverviewScreen)} />
    <AppStackNav.Screen name="CSVColumnMapping" component={sb(CSVColumnMappingScreen)} />
    <AppStackNav.Screen name="ActivityFeed" component={sb(ActivityFeedScreen)} />
    <AppStackNav.Screen name="Backups" component={sb(BackupsScreen)} />
    {/* NOT wrapped: the chat uses the left swipe for its thread list. */}
    <AppStackNav.Screen name="CampaignThreadScreen" component={CampaignThreadScreen} options={{ headerTitle: 'Campaign Thread', animationEnabled: false }} />
  </AppStackNav.Navigator>
);

// Prevent auto-hiding of splash screen
SplashScreen.preventAutoHideAsync();

const AppNavigator = () => {
  const { isLoaded: clerkLoaded, isSignedIn, signOut: clerkSignOut } = useAuth();
  const clerk = useClerk();
  const session = React.useContext(SessionContext);
  const insets = useSafeAreaInsets();
  const [isLoading, setIsLoading] = useState(true);
  const [userToken, setUserToken] = useState<string | null>(null);
  const [isFirstLaunch, setIsFirstLaunch] = useState<boolean | null>(null);
  const [appIsReady, setAppIsReady] = useState(false);
  const [initialStackName, setInitialStackName] = useState<'AuthStack' | 'AppStack' | null>(null);
  const [initialAppScreen, setInitialAppScreen] = useState<'CreateAccountScreen' | 'AccountSyncIssueScreen' | 'TabNavigator' | null>(null);
  // The landing screen is resolved ONCE per signed-in user. Without this, every Clerk
  // token-refresh that toggled session.bridgeReady (10-min interval, app-foreground) re-ran
  // the onboarding check, churned `initialAppScreen`, and — because that value is in the root
  // Stack.Navigator key below — REMOUNTED the whole navigator, snapping the user back to Home.
  const onboardingResolvedForUserRef = useRef<string | null>(null);
  // Once the signed-in navigator is live, later session/token churn must NOT swap it for
  // the startup shell or change the navigator key (either one snapped you back to Home).
  // hasLiveTreeRef is robust to session.user.id briefly going null during a bridge
  // re-init — it keys off "the tree is already up", not the (churning) user id. Reset on
  // sign-out so the next sign-in re-resolves the landing normally.
  const hasLiveTreeRef = useRef(false);
  const [navBooted, setNavBooted] = useState(false);
  // An explicit retry (AccountSyncIssue retry button / onboarding completion) bumps
  // retryOnboardingTrigger and MUST always re-resolve, bypassing the one-shot guard.
  const lastRetryTriggerRef = useRef(0);
  const [retryOnboardingTrigger, setRetryOnboardingTrigger] = useState(0);
  const [lastOnboardingDebugInfo, setLastOnboardingDebugInfo] = useState('');

  // Dev tools to test onboarding flow
  // ── FTUX / session dev toggles ─────────────────────────────────────────────
  // Master switch for the onboarding slide deck. FALSE = every user (new + returning)
  // goes straight to login, no slides. Flip to TRUE when the onboarding deck is ready.
  const [devShowOnboarding] = useState(false);
  const [devExpireSession, setDevExpireSession] = useState(false); // Set true to make you have to login new each time you leave/after session expires

  const [fontsLoaded] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    Inter_800ExtraBold,
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
        log.warn(e);
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
        log.debug(e);
      }
    },
    // Make signOut effectively synchronous for state update, but return Promise for type compatibility
    signOut: async () => {
      log.debug("[AuthContext] signOut called, clearing tokens and Clerk session.")
      setUserToken(null);
      AsyncStorage.removeItem('userToken').catch(() => { });
      try {
        if (clerkSignOut) {
          try {
            await clerkSignOut();
          } catch (e: any) {
            // Handle common Clerk sign-out errors gracefully
            // - "You are signed out" means we're already signed out
            // - "Cannot read property 'origin'" is a web-specific error on React Native
            const errorMsg = e?.message || String(e);
            if (errorMsg.includes('signed out') || errorMsg.includes('origin')) {
              log.debug('[AuthContext] Sign out completed (expected error on React Native)');
            } else {
              log.error('[AuthContext] Sign out error:', e);
            }
          }
          // The benign "origin" error can RESOLVE signOut() without actually clearing
          // the in-memory session — so `isSignedIn` stays true and the app stays on the
          // home tree instead of returning to auth (no restart needed to reproduce).
          // If a session survived, force it: retry signOut(), then fall back to
          // setActive({session:null}), which nulls the active session DIRECTLY and flips
          // isSignedIn false without the redirect path that throws "origin".
          const sessionSurvives = () =>
            !!clerk?.session || (clerk?.client?.sessions?.length ?? 0) > 0;
          try {
            if (sessionSurvives()) {
              log.debug('[AuthContext] Clerk session survived signOut; retrying signOut()');
              try { await clerk.signOut(); } catch { /* fall through to setActive */ }
            }
            if (sessionSurvives() && typeof (clerk as any)?.setActive === 'function') {
              log.debug('[AuthContext] Session still present; clearing via setActive({session:null})');
              await (clerk as any).setActive({ session: null });
            }
          } catch (verifyErr: any) {
            const vMsg = verifyErr?.message || String(verifyErr);
            if (!vMsg.includes('signed out') && !vMsg.includes('origin')) {
              log.error('[AuthContext] Forced session clear failed:', verifyErr);
            }
          }
        }
      } finally {
        // Tear down the Supabase bridge AFTER attempting Clerk sign-out so we don't
        // clear the bridge while Clerk still holds a session. `finally` guarantees the
        // bridge (token + refresh timer) is always cleared, even if clerkSignOut throws.
        try { stopClerkSupabaseBridge(); } catch { }

        // Purge persisted Clerk + AuthPersistence caches so the signed-out session
        // can't re-hydrate on the next launch (Clerk's RN "origin" error otherwise
        // leaves the session in SecureStore; AuthPersistence's 30-min window otherwise
        // restores the cached user). Single shared cleanup — see authCleanup.ts.
        await purgeClerkAndAuthCaches();
      }
      return Promise.resolve();
    },
    signUp: async (token: string) => {
      // Don't set isLoading false here
      setUserToken(token);
      try {
        await AsyncStorage.setItem('userToken', token);
      } catch (e) {
        log.debug(e);
      }
    }
  }), [clerkSignOut, clerk]); // Remove navigation dependency

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
        log.debug('Initial launch check error:', e);
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
      const uid = session?.user?.id ?? null;
      const retryChanged = lastRetryTriggerRef.current !== retryOnboardingTrigger;
      lastRetryTriggerRef.current = retryOnboardingTrigger;
      // Tree already live for this signed-in session → ignore bridgeReady/token/uid churn
      // outright. This catches the case the check below misses: when `uid` momentarily
      // goes null during a session bridge re-init (which otherwise fell through, flipped
      // isLoading, and remounted the navigator to Home). An explicit retry still re-runs.
      if (hasLiveTreeRef.current && !retryChanged) {
        setIsLoading(false);
        return;
      }
      // Already resolved a stable landing for THIS user → do not re-run on later
      // bridgeReady/token-refresh toggles (that churned the key and bounced to Home).
      // An explicit retry (retryOnboardingTrigger bump) always re-resolves.
      if (uid && onboardingResolvedForUserRef.current === uid && !retryChanged) {
        setIsLoading(false);
        return;
      }
      // Default to TabNavigator to avoid blank UI, then refine after check
      setInitialAppScreen('TabNavigator');
      if (!session?.bridgeReady) {
        setIsLoading(false);
        return;
      }
      setIsLoading(true);
      checkOnboardingAndNavigate();
    } else {
      onboardingResolvedForUserRef.current = null;
      hasLiveTreeRef.current = false;
      setNavBooted(false);
      setInitialAppScreen(null);
      setIsLoading(false);
    }
  }, [clerkLoaded, isSignedIn, session?.bridgeReady, session?.user?.id, retryOnboardingTrigger]);

  // Mark the signed-in navigator "live" once a landing screen is resolved. After this the
  // gate below stops swapping in the full-screen startup shell on re-checks (which
  // unmounted the tree and lost your place) and shows a small inline pill instead.
  useEffect(() => {
    if (isSignedIn && initialAppScreen && !navBooted) {
      hasLiveTreeRef.current = true;
      setNavBooted(true);
    }
  }, [isSignedIn, initialAppScreen, navBooted]);

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
        log.warn('[Onboarding Check] Supabase token unavailable. Keeping existing signed-in user on TabNavigator.');
        setInitialAppScreen('TabNavigator');
        return;
      }

      // Resolve canonical user id from me view (JWT sub) — not stale session.user.id
      const { user: me } = await getUserLike();
      const userId = me?.id;
      if (!userId) {
        const debug = `me=null | session.user.id=${session?.user?.id ?? 'null'}`;
        setLastOnboardingDebugInfo(debug);
        log.warn('[Onboarding Check] me view returned no user (JWT sub mismatch or no row). Showing AccountSyncIssue.');
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
        log.error("[Onboarding Check] DB fetch error:", dbError);
        setInitialAppScreen('AccountSyncIssueScreen');
      } else if (!dbUser) {
        const debug = `no Users row | userId=${userId} | me.id=${me?.id}`;
        setLastOnboardingDebugInfo(debug);
        log.debug(`[Onboarding Check] No Users row found for ${userId}. Showing AccountSyncIssue (ambiguous).`);
        setInitialAppScreen('AccountSyncIssueScreen');
      } else if (dbUser?.isOnboardingComplete) {
        log.debug(`[Onboarding Check] User ID: ${userId} - Onboarding complete. Going to TabNavigator`);
        setInitialAppScreen('TabNavigator');
        onboardingResolvedForUserRef.current = userId; // stable landing → don't re-resolve on token-refresh churn
      } else {
        log.debug(`[Onboarding Check] User ID: ${userId} - Onboarding INCOMPLETE in DB. Going to CreateAccountScreen`);
        setInitialAppScreen('CreateAccountScreen');
        onboardingResolvedForUserRef.current = userId; // stable landing → don't re-resolve on token-refresh churn
      }

    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      setLastOnboardingDebugInfo(`catch: ${errMsg}`);
      log.error("Error during onboarding check:", error);
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

  // Only take over the screen with the full startup shell on the FIRST boot. Once the
  // signed-in tree is live (navBooted), a re-check keeps you exactly where you are and
  // surfaces a small inline "Reconnecting…" pill instead (rendered below).
  if (!navBooted && (isLoading || !clerkLoaded || (isSignedIn && !initialAppScreen))) {
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
      <SwipeBackProvider>
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
            {(props: any) => <AuthStack {...props} showOnboarding={devShowOnboarding} />}
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
      </SwipeBackProvider>
      {/* Non-disruptive re-check indicator: the tree stays mounted underneath so you keep
          your place, instead of the old full-screen "Restoring navigation" takeover. */}
      {navBooted && isSignedIn && isLoading ? (
        <View pointerEvents="none" style={[reconnectStyles.pillWrap, { top: insets.top + 8 }]}>
          <View style={reconnectStyles.pill}>
            <ActivityIndicator size="small" color="#FFFFFF" />
            <Text style={reconnectStyles.pillText}>Reconnecting…</Text>
          </View>
        </View>
      ) : null}
    </View>
  );
};

const reconnectStyles = StyleSheet.create({
  pillWrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center', zIndex: 50 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 999,
    backgroundColor: 'rgba(17,17,19,0.92)',
  },
  pillText: { color: '#FFFFFF', fontSize: 13, fontFamily: 'Inter_500Medium' },
});

export default AppNavigator;
