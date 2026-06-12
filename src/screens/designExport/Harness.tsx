/**
 * Harness — wraps a single REAL app screen in the provider stack + a real
 * NavigationContainer so navigation hooks and route.params work, for web design export.
 *
 * Clerk is mocked at the Metro level (see metro.config.js). Session/Org/LegendState
 * get mock values; the remaining data providers are the real ones (they degrade to
 * empty/loading when their network calls fail, which is fine for layout export).
 */
import React, { Suspense } from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { observable } from '@legendapp/state';

import { ThemeProvider } from '../../context/ThemeContext';
import { SessionContext } from '../../context/SessionContext';
import { OrgContext } from '../../context/OrgContext';
import { LegendStateContext } from '../../context/LegendStateContext';
import { LegendStateControlContext } from '../../context/LegendStateControlContext';
import { SystemNotificationProvider } from '../../context/SystemNotificationContext';
import { PlatformConnectionsProvider } from '../../context/PlatformConnectionsContext';
import { PlatformPickerOverlayProvider } from '../../context/PlatformPickerOverlayContext';
import { AppDataProvider } from '../../context/AppDataContext';
import { JobsProvider } from '../../context/JobsContext';

import type { ExportRoute } from './registry';

const Stack = createStackNavigator();

const MOCK_SESSION: any = {
  ready: true,
  bootstrapState: 'ready',
  bootstrapError: null,
  user: { id: 'user_mock', email: 'demo@sssync.app' },
  getClerkToken: async () => 'mock_jwt_token',
};

const MOCK_ORG: any = {
  currentOrg: { id: 'org_mock', organizationId: 'org_mock', name: 'Demo Business', role: 'org:admin', isActive: true },
  availableOrgs: [{ id: 'org_mock', organizationId: 'org_mock', name: 'Demo Business', role: 'org:admin', isActive: true }],
  isLoading: false,
  error: null,
  hasPendingInvites: false,
  switchOrg: async () => {},
  refreshOrgs: async () => {},
};

const MOCK_LEGEND: any = {
  userId: 'user_mock',
  productVariants$: observable({}),
  inventoryLevels$: observable({}),
  products$: observable({}),
  productImages$: observable({}),
  platformMappings$: observable({}),
  marketplaceListings$: observable({}),
  platformConnections$: observable({}),
  platformLocations$: observable({}),
};

const MOCK_LEGEND_CONTROL: any = { resetLegendState: async () => {} };

class ScreenErrorBoundary extends React.Component<
  { children: React.ReactNode; routeKey: string },
  { failed: boolean; message?: string }
> {
  state: { failed: boolean; message?: string } = { failed: false };
  static getDerivedStateFromError(err: any) {
    return { failed: true, message: err?.message ? String(err.message) : String(err) };
  }
  componentDidUpdate(prev: { routeKey: string }) {
    if (prev.routeKey !== this.props.routeKey && this.state.failed) {
      this.setState({ failed: false, message: undefined });
    }
  }
  render() {
    if (this.state.failed) {
      return (
        <View style={styles.errorWrap}>
          <Text style={styles.errorTitle}>This screen couldn't render on web</Text>
          <Text style={styles.errorMsg}>{this.state.message}</Text>
          <Text style={styles.errorHint}>
            Usually a native-only dependency or required live data. Other screens still import fine.
          </Text>
        </View>
      );
    }
    return this.props.children;
  }
}

function Loading() {
  return (
    <View style={styles.loading}>
      <ActivityIndicator size="large" color="#8BB04F" />
    </View>
  );
}

export default function Harness({ route }: { route: ExportRoute }) {
  const ScreenComponent = React.useMemo(() => React.lazy(route.load), [route.key]);

  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <SessionContext.Provider value={MOCK_SESSION}>
          <OrgContext.Provider value={MOCK_ORG}>
            <LegendStateControlContext.Provider value={MOCK_LEGEND_CONTROL}>
              <LegendStateContext.Provider value={MOCK_LEGEND}>
                <SystemNotificationProvider>
                  <PlatformConnectionsProvider>
                    <PlatformPickerOverlayProvider>
                      <AppDataProvider>
                        <JobsProvider>
                          <ScreenErrorBoundary routeKey={route.key}>
                            <Suspense fallback={<Loading />}>
                              <NavigationContainer documentTitle={{ enabled: false }}>
                                <Stack.Navigator screenOptions={{ headerShown: false }}>
                                  <Stack.Screen
                                    name={route.routeName}
                                    component={ScreenComponent as any}
                                    initialParams={route.params}
                                  />
                                </Stack.Navigator>
                              </NavigationContainer>
                            </Suspense>
                          </ScreenErrorBoundary>
                        </JobsProvider>
                      </AppDataProvider>
                    </PlatformPickerOverlayProvider>
                  </PlatformConnectionsProvider>
                </SystemNotificationProvider>
              </LegendStateContext.Provider>
            </LegendStateControlContext.Provider>
          </OrgContext.Provider>
        </SessionContext.Provider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  errorWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, backgroundColor: '#fff' },
  errorTitle: { fontSize: 18, fontWeight: '700', color: '#B91C1C', marginBottom: 12, textAlign: 'center' },
  errorMsg: { fontSize: 13, color: '#7F1D1D', marginBottom: 12, textAlign: 'center' },
  errorHint: { fontSize: 12, color: '#9CA3AF', textAlign: 'center', maxWidth: 360 },
});
