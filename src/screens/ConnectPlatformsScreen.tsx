import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { StackScreenProps } from '@react-navigation/stack';
import { AppStackParamList } from '../navigation/AppNavigator';
import PlatformLogo from '../components/PlatformLogo';
import PlatformConnectSheet from '../components/PlatformConnectSheet';
import { listPlatforms, resolvePlatformKey, PlatformDef, PlatformKey } from '../config/platforms';
import { usePlatformConnect, ConnectablePlatform } from '../hooks/usePlatformConnect';
import { usePlatformConnections } from '../context/PlatformConnectionsContext';
import { useOrg } from '../context/OrgContext';
import { createLogger } from '../utils/logger';

const log = createLogger('ConnectPlatformsScreen');

type Props = StackScreenProps<AppStackParamList, 'ConnectPlatforms'>;

// One-line "what you get" per platform — plain, calm, verb-first.
const BLURB: Partial<Record<PlatformKey, string>> = {
  shopify: 'Sync products, inventory, and orders with your store.',
  square: 'Keep your Square catalog and stock in step.',
  clover: 'Post and update items on your Clover register.',
  ebay: 'List and reprice on eBay, taxonomy and all.',
  facebook: 'Post to Marketplace through your own computer.',
  amazon: 'Sell on Amazon — coming soon.',
  whatnot: 'Go live and list on Whatnot — coming soon.',
  depop: 'List your closet on Depop — coming soon.',
};

/**
 * Full connect-platform page — the "See all" surface reached from the connect
 * bottom sheet. One decision per row: Connect (green) / Connected (quiet) /
 * Soon (disabled). Available platforms first, coming-soon below. Search
 * narrows the list. Tapping Connect runs the same consent → OAuth flow the
 * sheet uses, so there's one connect path, not two.
 */
export default function ConnectPlatformsScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const { currentOrg } = useOrg();
  const { liveConnections, refresh } = usePlatformConnections();
  const { connect } = usePlatformConnect({ orgId: currentOrg?.id });

  const [query, setQuery] = useState('');
  const [consentPlatform, setConsentPlatform] = useState<PlatformKey | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);

  const connectedKeys = useMemo(() => {
    const set = new Set<PlatformKey>();
    for (const c of liveConnections || []) {
      if ((c.Status || '').toLowerCase() === 'active') {
        // PlatformType is free-text ("Shopify", "facebook_marketplace", a store
        // domain…); resolve it to a canonical key through the registry's
        // alias + fuzzy-contains resolver so every spelling maps correctly.
        const key = resolvePlatformKey(c.PlatformType);
        if (key) set.add(key);
      }
    }
    return set;
  }, [liveConnections]);

  const isConnected = useCallback((def: PlatformDef) => connectedKeys.has(def.key), [connectedKeys]);

  const { available, comingSoon } = useMemo(() => {
    const q = query.trim().toLowerCase();
    const match = (d: PlatformDef) => !q || d.label.toLowerCase().includes(q);
    const all = listPlatforms().filter(match);
    return {
      available: all.filter((d) => !!d.connect && d.status !== 'planned'),
      comingSoon: all.filter((d) => !d.connect || d.status === 'planned'),
    };
  }, [query]);

  const onConnect = useCallback((def: PlatformDef) => {
    if (!def.connect) return;
    setConnectError(null);
    setConsentPlatform(def.key);
  }, []);

  const handleContinueConnect = useCallback(async () => {
    if (!consentPlatform) return;
    setConnecting(true);
    setConnectError(null);
    try {
      const res = await connect(consentPlatform as ConnectablePlatform);
      if (res.success) {
        setConsentPlatform(null);
        refresh?.();
      } else if (!res.cancelled && res.errorMessage) {
        setConnectError(res.errorMessage);
      }
    } catch (e) {
      log.error('connect failed', e);
      setConnectError('Something went wrong. Please try again.');
    } finally {
      setConnecting(false);
    }
  }, [consentPlatform, connect, refresh]);

  const renderRow = (def: PlatformDef, connectable: boolean) => {
    const connected = isConnected(def);
    return (
      <View key={def.key} style={styles.row}>
        <View style={styles.logoWrap}>
          <PlatformLogo type={def.key} size={26} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={styles.name}>{def.label}</Text>
          <Text style={styles.blurb} numberOfLines={2}>
            {BLURB[def.key] ?? ''}
          </Text>
        </View>
        {connected ? (
          <View style={styles.connectedPill}>
            <View style={styles.liveDot} />
            <Text style={styles.connectedText}>Connected</Text>
          </View>
        ) : connectable ? (
          <TouchableOpacity style={styles.connectBtn} onPress={() => onConnect(def)} activeOpacity={0.85}>
            <Text style={styles.connectBtnText}>Connect</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.soonPill}>
            <Text style={styles.soonText}>Soon</Text>
          </View>
        )}
      </View>
    );
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 6 }]}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backCircle}
          activeOpacity={0.8}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Icon name="chevron-left" size={22} color="#18181B" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Connect a platform</Text>
        <View style={{ width: 40 }} />
      </View>

      <View style={styles.searchWrap}>
        <Icon name="magnify" size={18} color="#9CA3AF" />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search platforms"
          placeholderTextColor="#9CA3AF"
          style={styles.searchInput}
          autoCorrect={false}
          autoCapitalize="none"
        />
        {query.length > 0 ? (
          <TouchableOpacity onPress={() => setQuery('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Icon name="close-circle" size={18} color="#C4C8CE" />
          </TouchableOpacity>
        ) : null}
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + 28 }}
        showsVerticalScrollIndicator={false}
      >
        {available.length > 0 ? (
          <>
            <Text style={styles.sectionLabel}>AVAILABLE</Text>
            <View style={styles.card}>{available.map((d) => renderRow(d, true))}</View>
          </>
        ) : null}

        {comingSoon.length > 0 ? (
          <>
            <Text style={[styles.sectionLabel, { marginTop: 22 }]}>COMING SOON</Text>
            <View style={styles.card}>{comingSoon.map((d) => renderRow(d, false))}</View>
          </>
        ) : null}

        {available.length === 0 && comingSoon.length === 0 ? (
          <Text style={styles.empty}>No platforms match “{query}”.</Text>
        ) : null}
      </ScrollView>

      <PlatformConnectSheet
        visible={!!consentPlatform}
        platform={consentPlatform ?? null}
        busy={connecting}
        error={connectError}
        onContinue={handleContinueConnect}
        onCancel={() => {
          setConsentPlatform(null);
          setConnectError(null);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#F4F4F1' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 10,
  },
  backCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: { fontSize: 19, fontWeight: '700', color: '#18181B', letterSpacing: -0.3 },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FFFFFF',
    borderColor: '#E5E7EB',
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    height: 46,
    marginHorizontal: 16,
    marginBottom: 8,
  },
  searchInput: { flex: 1, fontSize: 15, color: '#18181B', padding: 0 },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#9CA3AF',
    letterSpacing: 0.6,
    marginTop: 14,
    marginBottom: 8,
    marginHorizontal: 20,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderColor: '#E5E7EB',
    borderWidth: 1,
    borderRadius: 16,
    marginHorizontal: 16,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 13,
    paddingHorizontal: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#F1F2F4',
  },
  logoWrap: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#F9FAFB',
    borderWidth: 1,
    borderColor: '#F1F2F4',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  name: { fontSize: 15.5, fontWeight: '600', color: '#18181B' },
  blurb: { fontSize: 12.5, color: '#71717A', lineHeight: 17 },
  connectBtn: {
    backgroundColor: '#93C822',
    borderRadius: 999,
    paddingHorizontal: 18,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  connectBtnText: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
  connectedPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    height: 36,
    flexShrink: 0,
  },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#16A34A' },
  connectedText: { color: '#16A34A', fontSize: 13.5, fontWeight: '600' },
  soonPill: {
    backgroundColor: '#F3F4F6',
    borderRadius: 999,
    paddingHorizontal: 14,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  soonText: { color: '#9CA3AF', fontSize: 13, fontWeight: '600' },
  empty: { textAlign: 'center', color: '#9CA3AF', fontSize: 14, marginTop: 40 },
});
