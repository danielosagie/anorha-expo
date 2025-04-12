import React, { useEffect, useState, useCallback } from 'react';
import { createStackNavigator } from '@react-navigation/stack';
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
import { Asset, Font } from 'expo-asset';
import * as SplashScreen from 'expo-splash-screen';
import { useFonts } from 'expo-font';
import {
  PlusJakartaSans_400Regular,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_700Bold,
} from '@expo-google-fonts/plus-jakarta-sans';

// Import the context from its new location
import { AuthContext, AuthContextType } from '../context/AuthContext';

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

const Stack = createStackNavigator();
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
          tabBarIcon: 'view-dashboard-outline'
        }}
      />
      <Tab.Screen 
        name="Inventory" 
        component={InventoryOrdersScreen}
        options={{
          tabBarLabel: 'Inventory',
          tabBarIcon: 'package-variant-closed'
        }}
      />
      <Tab.Screen 
        name="AddListing" 
        component={AddListingScreen}
        options={{
          tabBarLabel: 'Add',
          tabBarIcon: 'plus-circle-outline'
        }}
      />
      <Tab.Screen 
        name="Marketplace" 
        component={MarketplaceScreen}
        options={{
          tabBarLabel: 'Marketplace',
          tabBarIcon: 'store-outline'
        }}
      />
      <Tab.Screen 
        name="Profile" 
        component={ProfileScreen}
        options={{
          tabBarLabel: 'Settings',
          tabBarIcon: 'cog-outline'
        }}
      />
    </Tab.Navigator>
  );
};

const AuthStack = ({ isFirstLaunch, devForceOnboarding }: { isFirstLaunch: boolean, devForceOnboarding: boolean }) => (
  <Stack.Navigator screenOptions={{ headerShown: false }}>
    {(isFirstLaunch || devForceOnboarding) ? (
      <>
        <Stack.Screen name="InitialScreen" component={InitialScreen} />
        <Stack.Screen name="OnboardingSlides" component={OnboardingSlides} />
      </>
    ) : null}
    <Stack.Screen name="Auth" component={AuthScreen} />
  </Stack.Navigator>
);

const AppStack = () => (
  <Stack.Navigator screenOptions={{ headerShown: false }}>
    <Stack.Screen name="TabNavigator" component={TabNavigator} />
    <Stack.Screen name="ProductDetail" component={ProductDetailScreen} />
  </Stack.Navigator>
);

// Prevent auto-hiding of splash screen
SplashScreen.preventAutoHideAsync();

const AppNavigator = () => {
  const navigation = useNavigation();
  const [isLoading, setIsLoading] = useState(true);
  const [userToken, setUserToken] = useState<string | null>(null);
  const [isFirstLaunch, setIsFirstLaunch] = useState<boolean | null>(null);
  const [appIsReady, setAppIsReady] = useState(false);
  
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

  // Create authentication functions
  const authContext = React.useMemo((): AuthContextType => ({
    signIn: async (token: string) => {
      setIsLoading(false);
      setUserToken(token);
      try {
        await AsyncStorage.setItem('userToken', token);
      } catch (e) {
        console.log(e);
      }
    },
    signOut: async () => {
      setIsLoading(false);
      setUserToken(null);
      try {
        await AsyncStorage.removeItem('userToken');
        // Reset navigation to AuthStack after sign out
        navigation.dispatch(
          CommonActions.reset({
            index: 0,
            routes: [{ name: 'AuthStack' }],
          })
        );
      } catch (e) {
        console.log(e);
      }
    },
    signUp: async (token: string) => {
      setIsLoading(false);
      setUserToken(token);
      try {
        await AsyncStorage.setItem('userToken', token);
      } catch (e) {
        console.log(e);
      }
    }
  }), [navigation]);

  // Initial auth check - modified to handle first launch properly
  useEffect(() => {
    const bootstrapAsync = async () => {
      let token: string | null = null;
      let firstLaunch: boolean = true;

      try {
        token = await AsyncStorage.getItem('userToken');
        const alreadyLaunched = await AsyncStorage.getItem('alreadyLaunched');
        firstLaunch = alreadyLaunched === null;
        
        // Set alreadyLaunched flag if it doesn't exist
        if (firstLaunch) {
          await AsyncStorage.setItem('alreadyLaunched', 'true');
        }
      } catch (e) {
        console.log(e);
      }

      setUserToken(token);
      setIsFirstLaunch(firstLaunch);
      setIsLoading(false);
    };

    bootstrapAsync();
  }, []);

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

  if (!appIsReady || isLoading) {
    return null; // Keep splash screen visible
  }

  return (
    <View style={{ flex: 1 }} onLayout={onLayoutRootView}>
      <AuthContext.Provider value={authContext}>
        <Stack.Navigator 
          screenOptions={{ 
            headerShown: false,
            headerShadowVisible: false,
            headerBackTitleVisible: false,
            headerTitle: () => null
          }}
        >
          {userToken ? (
            <Stack.Screen 
              name="AppStack" 
              component={AppStack} 
              options={{ headerShown: false }}
            />
          ) : (
            <Stack.Screen 
              name="AuthStack"
              options={{ headerShown: false }}
            >
              {() => <AuthStack isFirstLaunch={isFirstLaunch || devForceOnboarding} devForceOnboarding={devForceOnboarding} />}
            </Stack.Screen>
          )}
        </Stack.Navigator>
      </AuthContext.Provider>
    </View>
  );
};

export default AppNavigator; 