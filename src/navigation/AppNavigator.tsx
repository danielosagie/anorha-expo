import React, { useEffect, useState, useCallback } from 'react';
import { createStackNavigator, StackScreenProps } from '@react-navigation/stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import AsyncStorage from '@react-native-async-storage/async-storage';
import TabBar from '../components/TabBar';
import styles from '../styles/styles';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { Camera } from 'lucide-react';
import { AppState, AppStateStatus } from 'react-native';
import { CommonActions } from '@react-navigation/native';
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

// Import the context from its new location
import { AuthContext, AuthContextType } from '../context/AuthContext';
import { supabase } from '../../lib/supabase';

// Screens
import InitialScreen from '../screens/InitialScreen';
import OnboardingSlides from '../screens/OnboardingSlides';
import AuthScreen from '../screens/AuthScreen';
import DashboardScreen from '../screens/DashboardScreen';
import InventoryOrdersScreen from '../screens/InventoryOrdersScreen';
import MarketplaceScreen from '../screens/MarketplaceScreen';
import AddListingScreen from '../screens/AddListingScreen';
import ProfileScreen from '../screens/ProfileScreen';
import ProductDetailScreen from '../screens/ProductDetail';
import PhoneAuthScreen from '../screens/PhoneAuthScreen';
import CreateAccountScreen from '../screens/CreateAccountScreen';

// --- Define Param Lists for Type Safety --- //
type AuthStackParamList = {
  InitialScreen: undefined;
  OnboardingSlides: undefined;
  Auth: undefined;
  // PhoneAuthScreen: { phoneNumber: string } | undefined; // Commented out
};

type AppStackParamList = {
  CreateAccountScreen: undefined; // Screen after phone verification
  TabNavigator: undefined; // Your main tab navigator
  ProductDetail: { productId: string }; // Example param for ProductDetail
  // Add other App related screens here
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
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: styles.tabBar,
      }}
      tabBar={(props) => <TabBar {...props} />}
      initialRouteName="OrdersTab"
    >
      <Tab.Screen 
        name="Dashboard" 
        component={DashboardScreen}
        options={{
          tabBarLabel: 'Dashboard',
          tabBarIcon: ({ color, size }) => (
            <Icon name="view-dashboard-outline" color={color} size={size} />
          ),
        }}
      />
      <Tab.Screen 
        name="Inventory" 
        component={InventoryOrdersScreen}
        options={{
          tabBarLabel: 'Inventory',
          tabBarIcon: ({ color, size }) => (
            <Icon name="package-variant-closed" color={color} size={size} />
          ),
        }}
      />
      <Tab.Screen 
        name="AddListing" 
        component={AddListingScreen as React.ComponentType<any>}
        options={{
          tabBarLabel: 'Add',
          tabBarIcon: ({ color, size }) => (
            <Icon name="plus-circle-outline" color={color} size={size} />
          ),
        }}
      />
      <Tab.Screen 
        name="Marketplace" 
        component={MarketplaceScreen}
        options={{
          tabBarLabel: 'Marketplace',
          tabBarIcon: ({ color, size }) => (
            <Icon name="store-outline" color={color} size={size} />
          ),
        }}
      />
      <Tab.Screen 
        name="Profile" 
        component={ProfileScreen}
        options={{
          tabBarLabel: 'Settings',
          tabBarIcon: ({ color, size }) => (
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
    {/* Comment out PhoneAuthScreen */}
    {/* <AuthStackNav.Screen name="PhoneAuthScreen" component={PhoneAuthScreen} /> */}
  </AuthStackNav.Navigator>
);

const AppStack = ({ initialScreenName }: { initialScreenName: 'CreateAccountScreen' | 'TabNavigator' }) => (
  <AppStackNav.Navigator
    screenOptions={{ headerShown: false }}
    initialRouteName={initialScreenName}
  >
    <AppStackNav.Screen name="CreateAccountScreen" component={CreateAccountScreen} />
    <AppStackNav.Screen name="TabNavigator" component={TabNavigator} />
    <AppStackNav.Screen name="ProductDetail" component={ProductDetailScreen} />
  </AppStackNav.Navigator>
);

// Prevent auto-hiding of splash screen
SplashScreen.preventAutoHideAsync();

const AppNavigator = () => {
  const navigation = useNavigation<StackScreenProps<RootStackParamList>['navigation']>();
  const [isLoading, setIsLoading] = useState(true);
  const [userToken, setUserToken] = useState<string | null>(null);
  const [isFirstLaunch, setIsFirstLaunch] = useState<boolean | null>(null);
  const [appIsReady, setAppIsReady] = useState(false);
  const [initialStackName, setInitialStackName] = useState<'AuthStack' | 'AppStack' | null>(null);
  const [initialAppScreen, setInitialAppScreen] = useState<'CreateAccountScreen' | 'TabNavigator' | null>(null);
  
  // Dev tools to test onboarding flow
  const [devForceOnboarding] = useState(false); // Set this to true only when testing onboarding
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
    signOut: async () => {
      // --- SIMPLIFIED: Only clear token state and storage --- 
      setUserToken(null);
      setInitialAppScreen(null); // Clear specific app screen state too
      try {
        await AsyncStorage.removeItem('userToken');
      } catch (e) {
        console.log(e);
      }
      // isLoading and initialStackName are handled by the useEffect hook watching userToken
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
  }), []); // Remove navigation dependency

  // Initial auth check - UPDATED to set initialStackName
  useEffect(() => {
    const bootstrapAsync = async () => {
      setIsLoading(true);
      let token: string | null = null;
      let firstLaunch: boolean = true;
      let stackName: 'AuthStack' | 'AppStack' = 'AuthStack'; // Default to Auth

      try {
        token = await AsyncStorage.getItem('userToken');
        const alreadyLaunched = await AsyncStorage.getItem('alreadyLaunched');
        firstLaunch = alreadyLaunched === null;
        
        if (firstLaunch) {
          await AsyncStorage.setItem('alreadyLaunched', 'true');
        }

        if (token) {
          stackName = 'AppStack';
        } else {
          stackName = 'AuthStack';
        }

      } catch (e) {
        console.log("Bootstrap Error:", e);
        stackName = 'AuthStack'; // Default to Auth on error
      } finally {
      setUserToken(token);
      setIsFirstLaunch(firstLaunch);
        setInitialStackName(stackName);

        if (!token) {
      setIsLoading(false);
        }
      }
    };

    bootstrapAsync();
  }, []);

  // --- Effect to handle token changes (Login/Logout) --- //
  useEffect(() => {
    if (userToken === undefined) return; // Skip initial undefined state

    if (userToken) {
      // --- LOGIN ---
      setInitialStackName('AppStack'); // Set stack to App
      setIsLoading(true);            // Set loading true
      setInitialAppScreen(null);     // Reset target screen state
      // Call check after a tiny delay, allowing state to settle
      const timer = setTimeout(() => {
          checkOnboardingAndNavigate();
      }, 10); // Minimal delay
      return () => clearTimeout(timer); // Cleanup timer

    } else {
      // --- LOGOUT ---
      // This block now handles all state changes for logout
       if (initialStackName !== null) { // Avoid setting state before bootstrap finishes initial check
           setInitialStackName('AuthStack');
           setInitialAppScreen(null); // Ensure app screen is reset
           setIsLoading(false);       // Explicitly set loading false
       }
       // If bootstrap hasn't finished, it will set the correct state upon completion
    }
  }, [userToken]); // Re-run only when userToken changes

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
    let destination: 'CreateAccountScreen' | 'TabNavigator' | null = null;
    try {
      const { data: { user }, error: getUserError } = await supabase.auth.getUser();

      if (getUserError || !user) {
        console.error("Error fetching user for onboarding check:", getUserError);
        authContext.signOut();
        return;
      }

      const { data: userData, error: fetchError } = await supabase
        .from('Users')
        .select('isOnboardingComplete')
        .eq('Id', user.id)
        .maybeSingle();

      // ---> ADDED Detailed Logging <---
      console.log(`[Onboarding Check] User ID: ${user.id}`);
      console.log(`[Onboarding Check] Fetched User Data:`, JSON.stringify(userData, null, 2));
      console.log(`[Onboarding Check] Fetch Error:`, fetchError);
      // ---> End Logging <---

      if (fetchError) {
        console.error("[Onboarding Check] Error fetching onboarding status:", fetchError);
        destination = 'TabNavigator'; // Default to main app on error
      } else {
        // Handle null userData explicitly for clarity
        const onboardingComplete = userData?.isOnboardingComplete ?? false; // Treat null userData as incomplete
        console.log(`[Onboarding Check] Determined Onboarding Status for ${user.email}: ${onboardingComplete}`);
        destination = onboardingComplete ? 'TabNavigator' : 'CreateAccountScreen';
      }

    } catch (error) {
      console.error("Error during onboarding check:", error);
      authContext.signOut();
      return;
    } finally {
      setInitialAppScreen(destination);
      setIsLoading(false);
    }
  };

  if (!appIsReady || isLoading || !initialStackName) {
    return null;
  }

  return (
    <View style={{ flex: 1 }} onLayout={onLayoutRootView}>
      <AuthContext.Provider value={authContext}>
        <Stack.Navigator 
          initialRouteName={initialStackName}
          screenOptions={{ 
            headerShown: false,
            headerShadowVisible: false,
            headerBackTitleVisible: false,
            headerTitle: () => null
          }}
        >
          <Stack.Screen name="AuthStack">
            {(props) => <AuthStack {...props} isFirstLaunch={isFirstLaunch ?? true} devForceOnboarding={devForceOnboarding} />}
          </Stack.Screen>

          <Stack.Screen name="AppStack">
             {(props) =>
                initialAppScreen ? (
                  <AppStack {...props} initialScreenName={initialAppScreen} />
                ) : (
                  <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}><ActivityIndicator /></View>
                )
             }
            </Stack.Screen>

        </Stack.Navigator>
      </AuthContext.Provider>
    </View>
  );
};

export default AppNavigator; 