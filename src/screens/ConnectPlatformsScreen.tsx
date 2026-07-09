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
import ConnectFlowSheet from '../components/ConnectFlowSheet';
import { listPlatforms, getPlatformAvailability, PlatformDef, PlatformKey, resolvePlatformKey } from '../config/platforms';
import { usePlatformConnections, type PlatformConnectionRow } from '../context/PlatformConnectionsContext';
import { useFacebookJobStatus } from '../hooks/useFacebookJobStatus';
import { derivePlatformConnectStatus } from '../lib/platformConnectStatus';
import { useOrg } from '../context/OrgContext';
import ConnectionDetailSheet from '../components/ConnectionDetailSheet';
type Props = StackScreenProps<AppStackParamList, 'ConnectPlatforms'>;

// One-line "what you get" per platform — plain, calm, verb-first.
const BLURB: Partial<Record<PlatformKey, string>> = {
  shopify: 'Sync products, inventory, and orders with your store.',
  square: 'Keep your Square catalog and stock in step.',
  clover: 'Post and update items on your Clover register.',
  ebay: 'List and reprice on eBay, taxonomy and all.',
  facebook: 'Post to Marketplace through your own computer.',
  // Coming-soon rows already carry the section header + Soon pill — the blurb
  // says what the platform does, not "soon" a third time.
  amazon: 'Sell your inventory on Amazon.',
  whatnot: 'Go live and sell on Whatnot.',
  depop: 'List your closet on Depop.',
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
  const { computerOnline, presenceLoaded } = useFacebookJobStatus();

  const [query, setQuery] = useState('');
  const [flowPlatform, setFlowPlatform] = useState<PlatformKey | null>(null);
  const [detailConnection, setDetailConnection] = useState<PlatformConnectionRow | null>(null);

  // One truthful status per platform: connected ONLY when every required step is
  // done. Facebook needs OAuth AND a linked computer, so the OAuth row alone no
  // longer shows "Connected" (the old connectedKeys bug). Presence is read once
  // here and folded per row via the pure derive, not one subscription per row.
  const statusFor = useCallback(
    (def: PlatformDef) =>
      derivePlatformConnectStatus(def.key, liveConnections, { computerOnline, presenceLoaded }),
    [liveConnections, computerOnline, presenceLoaded],
  );

  const { available, comingSoon } = useMemo(() => {
    const q = query.trim().toLowerCase();
    const match = (d: PlatformDef) => !q || d.label.toLowerCase().includes(q);
    const all = listPlatforms().filter(match);
    // The registry's ONE availability gate decides which rows get a live
    // Connect button — including the EXPO_PUBLIC_ENABLED_PLATFORMS kill
    // switch, so a platform hidden from the picker can't be connected here.
    return {
      available: all.filter((d) => getPlatformAvailability(d.key) !== 'coming-soon'),
      comingSoon: all.filter((d) => getPlatformAvailability(d.key) === 'coming-soon'),
    };
  }, [query]);

  // Open the ONE combined flow. It runs OAuth, then link-computer for platforms
  // that post through the computer (Facebook), skipping any step already done.
  const onConnect = useCallback((def: PlatformDef) => {
    if (!def.connect && def.capabilities.writeVia !== 'computer') return;
    setFlowPlatform(def.key);
  }, []);

  const openDetail = useCallback((def: PlatformDef) => {
    const matching = liveConnections.filter(
      (row) => resolvePlatformKey(row.PlatformType) === def.key,
    );
    const stateOf = (row: PlatformConnectionRow) =>
      derivePlatformConnectStatus(def.key, [row], {
        computerOnline,
        presenceLoaded,
      }).uiState;
    const connection = matching.find((row) => stateOf(row) === 'connected')
      || matching.find((row) => stateOf(row) === 'needs-reauth')
      || matching[0];
    if (connection) setDetailConnection(connection);
  }, [liveConnections, computerOnline, presenceLoaded]);

  const renderRow = (def: PlatformDef, connectable: boolean) => {
    const st = statusFor(def);
    const trailing = !connectable ? (
      <View style={styles.soonPill}>
        <Text style={styles.soonText}>Soon</Text>
      </View>
    ) : st.uiState === 'connected' ? (
      <TouchableOpacity
        style={styles.connectedPill}
        onPress={() => openDetail(def)}
        activeOpacity={0.75}
      >
        <View style={styles.liveDot} />
        <Text style={styles.connectedText}>Connected</Text>
      </TouchableOpacity>
    ) : st.uiState === 'needs-reauth' ? (
      <TouchableOpacity style={styles.finishBtn} onPress={() => openDetail(def)} activeOpacity={0.85}>
        <Text style={styles.finishBtnText}>Reconnect</Text>
      </TouchableOpacity>
    ) : st.uiState === 'needs-computer' ? (
      // OAuth done but the computer isn't linked — one tap resumes the flow at
      // the link-computer step rather than restarting OAuth.
      <TouchableOpacity style={styles.finishBtn} onPress={() => onConnect(def)} activeOpacity={0.85}>
        <Text style={styles.finishBtnText}>Finish setup</Text>
      </TouchableOpacity>
    ) : st.uiState === 'checking' ? (
      // OAuth done, computer status still loading — quiet neutral, never green.
        <View style={styles.connectedPill}>
          <View style={[styles.liveDot, { backgroundColor: '#9CA3AF' }]} />
          <Text style={[styles.connectedText, { color: '#9CA3AF' }]}>Checking</Text>
      </View>
    ) : (
      <TouchableOpacity style={styles.connectBtn} onPress={() => onConnect(def)} activeOpacity={0.85}>
        <Text style={styles.connectBtnText}>Connect</Text>
      </TouchableOpacity>
    );
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
        {trailing}
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
        // With the search keyboard up, the first tap on a Connect button must
        // press the button — not just dismiss the keyboard.
        keyboardShouldPersistTaps="handled"
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

      <ConnectFlowSheet
        visible={!!flowPlatform}
        platform={flowPlatform}
        orgId={currentOrg?.id}
        onCancel={() => setFlowPlatform(null)}
        onConnected={() => {
          setFlowPlatform(null);
          // The backend commits the connection row on the OAuth callback; nudge
          // twice so the row flips to Connected without a manual reload.
          refresh?.();
          setTimeout(() => refresh?.(), 2500);
        }}
      />

      <ConnectionDetailSheet
        visible={detailConnection !== null}
        connection={detailConnection}
        onClose={() => setDetailConnection(null)}
        onReview={(connection) => {
          setDetailConnection(null);
          navigation.navigate('SyncInbox', {
            connectionId: connection.Id,
            platformName: connection.PlatformType,
          });
        }}
        onSyncRules={(connection) => {
          setDetailConnection(null);
          navigation.navigate('SyncRules', { connectionId: connection.Id });
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
  finishBtn: {
    backgroundColor: '#FFF7ED',
    borderColor: '#FDBA74',
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 16,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  finishBtnText: { color: '#B45309', fontSize: 13.5, fontWeight: '700' },
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
