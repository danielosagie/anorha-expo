import { getLocales } from 'expo-localization';
import { Alert, Platform } from 'react-native';

const US_EXTERNAL_BILLING_REGIONS = new Set(['US', 'PR', 'GU', 'VI', 'AS', 'MP']);

export function getDeviceBillingRegion(): string | null {
  const locale = getLocales()[0];
  const region = locale?.regionCode || locale?.languageRegionCode;
  return region ? region.toUpperCase() : null;
}

export function canOpenExternalBillingLinks(): boolean {
  if (Platform.OS === 'web') return true;
  const region = getDeviceBillingRegion();
  return !!region && US_EXTERNAL_BILLING_REGIONS.has(region);
}

export function alertExternalBillingUnavailable() {
  Alert.alert(
    'Billing unavailable in this region',
    'External checkout and subscription management are currently available only in the U.S. Please contact support if you need help with your plan.'
  );
}
