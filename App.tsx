import React, { useEffect, useRef } from 'react';
import { NavigationContainer, NavigationContainerRef } from '@react-navigation/native';
import { StatusBar, Linking, Alert } from 'react-native';
import { ThemeProvider } from './src/context/ThemeContext';
import AppNavigator from './src/navigation/AppNavigator';
import { LogBox } from 'react-native';
import 'react-native-get-random-values';


const App: React.FC = () => {
  const navigationRef = useRef<NavigationContainerRef<any>>(null);

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

  return (
    <ThemeProvider>
      <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" />
      <NavigationContainer ref={navigationRef}>
        <AppNavigator />
      </NavigationContainer>
    </ThemeProvider>
  );
};

export default App; 