import React, { useState } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';

// Static copy mirrors backend src/platform-connections/platform-disclosures.ts.
// Never used as a gate — the modal opens from local state regardless of network.
// Exported so the richer PlatformConnectSheet (OAuth consent page) reuses the
// same per-platform copy instead of redefining it.
export type PlatformDisclosure = { title: string; subtitle: string; bullets: string[]; apiKey?: boolean };
export const DISCLOSURES: Record<string, PlatformDisclosure> = {
  shopify: {
    title: 'Connect Shopify store',
    subtitle: 'Keep your products, inventory and orders in sync with your Shopify store',
    bullets: [
      'Sync products, inventory levels and orders between Anorha and your Shopify store',
      'Anorha will read and update your Shopify catalog, inventory and order information on your behalf',
      'Disconnect at any time from your Anorha settings or your Shopify account',
    ],
  },
  square: {
    title: 'Connect Square account',
    subtitle: 'Keep your catalog, inventory and orders in sync with Square',
    bullets: [
      'Sync catalog items, inventory counts and orders between Anorha and Square',
      'Anorha will read and update your Square catalog, inventory and orders across your locations',
      'Disconnect at any time from your Anorha settings or your Square account',
    ],
  },
  clover: {
    title: 'Connect Clover merchant',
    subtitle: 'Keep your items, stock and orders in sync with your Clover merchant',
    bullets: [
      'Sync items, stock levels and orders between Anorha and your Clover merchant',
      'Anorha will read and update your Clover inventory and receive order updates for your merchant',
      'Disconnect at any time from your Anorha settings or your Clover account',
    ],
  },
  ebay: {
    title: 'Connect eBay account',
    subtitle: 'Keep your listings, inventory and orders in sync with eBay',
    bullets: [
      'Sync listings, offers, inventory and orders between Anorha and your eBay account',
      'Anorha will read and update your eBay inventory and listings and receive order notifications',
      'Disconnect at any time from your Anorha settings or your eBay account',
    ],
  },
  facebook: {
    title: 'Connect Facebook account',
    subtitle: 'List and sync your products on Facebook Marketplace and catalogs',
    bullets: [
      'Reading keeps your Facebook listings and availability in sync with your other channels',
      'Posting happens through your own computer and Facebook account, paced to keep your account safe — your computer needs to be on',
      'Disconnect at any time from your Anorha settings or your Facebook account',
    ],
  },
  whatnot: {
    title: 'Connect Whatnot account',
    subtitle: 'Keep your Whatnot listings and inventory in sync with your other sales channels',
    bullets: [
      'Sync products, listings, quantities and orders between Anorha and your Whatnot shop',
      'Anorha will read and update your Whatnot inventory and read your orders through the Whatnot Seller API',
      'Disconnect at any time from your Anorha settings or your Whatnot account',
    ],
  },
  depop: {
    title: 'Connect Depop shop',
    subtitle: 'Keep your Depop listings and inventory in sync with your other sales channels',
    bullets: [
      'Sync listings, quantities and orders between Anorha and your Depop shop',
      'Anorha will create, update and delete listings in your Depop shop and read your orders using your Depop API key',
      'Disconnect at any time from your Anorha settings or your Depop account',
    ],
    apiKey: true,
  },
};

interface Props {
  visible: boolean;
  platform: string;
  busy?: boolean;
  error?: string | null;
  onContinue: (apiKey?: string) => void;
  onCancel: () => void;
}

export default function ConnectDisclosureModal({
  visible,
  platform,
  busy = false,
  error,
  onContinue,
  onCancel,
}: Props) {
  const [apiKey, setApiKey] = useState('');
  const d = DISCLOSURES[platform];

  if (!d) return null;

  const canContinue = !busy && (!d.apiKey || apiKey.trim().length > 0);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onCancel}
    >
      <View style={styles.overlay}>
        <View style={styles.card}>
          <Text style={styles.title}>{d.title}</Text>
          <Text style={styles.subtitle}>{d.subtitle}</Text>

          {d.bullets.map((b) => (
            <Text key={b} style={styles.bullet}>{'•'}{'  '}{b}</Text>
          ))}

          {d.apiKey && (
            <TextInput
              style={styles.input}
              placeholder="Depop API key"
              placeholderTextColor="#9CA3AF"
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              value={apiKey}
              onChangeText={setApiKey}
            />
          )}

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <Pressable
            style={[styles.continueButton, !canContinue && styles.disabled]}
            disabled={!canContinue}
            onPress={() => onContinue(d.apiKey ? apiKey.trim() : undefined)}
          >
            {busy ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.continueLabel}>Continue</Text>
            )}
          </Pressable>

          <Pressable onPress={onCancel} style={styles.cancelPressable}>
            <Text style={styles.cancel}>Cancel</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  card: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 24,
    gap: 10,
  },
  title: {
    fontSize: 20,
    fontFamily: 'Inter_700Bold',
    color: '#18181B',
  },
  subtitle: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: '#71717A',
    marginBottom: 4,
  },
  bullet: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: '#3F3F46',
    lineHeight: 22,
  },
  input: {
    borderWidth: 1,
    borderColor: '#E4E4E7',
    borderRadius: 10,
    padding: 13,
    marginTop: 6,
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
    color: '#18181B',
  },
  error: {
    color: '#DC2626',
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
  },
  continueButton: {
    marginTop: 8,
    backgroundColor: '#18181B',
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: 'center',
  },
  continueLabel: {
    color: '#fff',
    fontFamily: 'Inter_700Bold',
    fontSize: 15,
  },
  disabled: {
    opacity: 0.45,
  },
  cancelPressable: {
    alignItems: 'center',
    paddingVertical: 4,
  },
  cancel: {
    textAlign: 'center',
    padding: 8,
    color: '#71717A',
    fontFamily: 'Inter_500Medium',
    fontSize: 14,
  },
});
