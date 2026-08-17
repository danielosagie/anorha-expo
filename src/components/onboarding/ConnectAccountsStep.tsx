// ConnectAccountsStep — the final, skippable onboarding step. The user hooks up
// their selling platforms here; each successful connect kicks off a background
// inventory pull + draft-mapping build (via usePlatformConnect) so listings are
// ready to review by the time they finish poking around the app.

import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { Check } from 'lucide-react-native';

import PlatformLogo from '../PlatformLogo';
import ConnectFlowSheet from '../ConnectFlowSheet';
import { listPlatforms } from '../../config/platforms';

import { type ConnectablePlatform } from '../../hooks/usePlatformConnect';
import { usePlatformConnections } from '../../context/PlatformConnectionsContext';
import { useFacebookJobStatus } from '../../hooks/useFacebookJobStatus';
import { useImportStatus } from '../../hooks/useImportStatus';
import { derivePlatformConnectStatus } from '../../lib/platformConnectStatus';
import { connectionImportPresentationsById } from '../../lib/connectionImportPresentation';

const INK = '#1C1B17';
const SUBTLE = '#6B6A63';
const GREEN = '#93C822';
const GREEN_DEEP = '#93C822';
const BORDER = '#EAE6DA';
const CARD_BG = '#FBFAF6';

type PlatformDef = {
  key: ConnectablePlatform;
  name: string;
};

const PLATFORMS: PlatformDef[] = listPlatforms({ connectableOnly: true }).map((d) => ({
  key: d.key as ConnectablePlatform,
  name: d.label,
}));

export default function ConnectAccountsStep({
  orgId,
  orgName,
  onDone,
}: {
  orgId?: string | null;
  orgName?: string;
  onDone: () => void;
}) {
  const { connections, progressByConnectionId, refresh } = usePlatformConnections();
  const { computerOnline, presenceLoaded } = useFacebookJobStatus();
  const importStatus = useImportStatus();
  const presentationByConnectionId = useMemo(
    () => connectionImportPresentationsById({
      connections,
      aggregateConnections: importStatus.connections,
      recentImports: importStatus.recentImports,
      progressByConnectionId,
    }),
    [connections, importStatus.connections, importStatus.recentImports, progressByConnectionId],
  );

  // The platform whose combined connect flow (OAuth + link-computer) is open.
  const [flowPlatform, setFlowPlatform] = useState<ConnectablePlatform | null>(null);
  // Fully connected = every required step done (Facebook needs OAuth AND a linked
  // computer). Read server-backed connection rows only; OAuth completion alone
  // must not fabricate an importing state.
  const isFullyConnected = useCallback(
    (key: ConnectablePlatform) =>
      derivePlatformConnectStatus(
        key,
        connections,
        { computerOnline, presenceLoaded },
        { presentationByConnectionId },
      ).isFullyConnected,
    [connections, computerOnline, presenceLoaded, presentationByConnectionId],
  );

  const connectedCount = useMemo(
    () => PLATFORMS.filter((p) => isFullyConnected(p.key)).length,
    [isFullyConnected],
  );
  const name = orgName?.trim() || 'My store';

  return (
    <Animated.View entering={FadeIn.duration(280)} style={styles.wrap}>
      <Text style={styles.title}>Connect your stores</Text>
      <Text style={styles.subtitle}>We'll pull your products into {name}.</Text>

      <View style={styles.selectList}>
        {PLATFORMS.map((p) => {
          const platformStatus = derivePlatformConnectStatus(
            p.key,
            connections,
            { computerOnline, presenceLoaded },
            { presentationByConnectionId },
          );
          const connected = platformStatus.isFullyConnected;
          const importing = platformStatus.importing;
          return (
            <TouchableOpacity
              key={p.key}
              style={[styles.selectRow, connected && styles.selectRowActive]}
              onPress={() => setFlowPlatform(p.key)}
              disabled={connected}
              activeOpacity={0.85}
            >
              <View style={styles.selectIconCircle}>
                <PlatformLogo type={p.key} size={22} />
              </View>
              <View style={styles.selectLabelWrap}>
                <Text style={styles.selectLabel}>{p.name}</Text>
                {importing ? (
                  <Text style={styles.rowStatus} numberOfLines={1}>Importing items</Text>
                ) : null}
              </View>

              {connected ? (
                <View style={[styles.selectorBox, styles.selectorSelected]}>
                  <Check size={14} color="#FFFFFF" />
                </View>
              ) : (
                <Text style={styles.connectText}>Connect</Text>
              )}
            </TouchableOpacity>
          );
        })}
      </View>

      <Text style={styles.hint}>We only sync what you connect.</Text>

      <View style={{ flex: 1, minHeight: 12 }} />

      <TouchableOpacity style={styles.primaryBtn} onPress={onDone} activeOpacity={0.9}>
        <Text style={styles.primaryText}>{connectedCount > 0 ? 'Continue' : 'Skip'}</Text>
      </TouchableOpacity>

      <ConnectFlowSheet
        visible={!!flowPlatform}
        platform={flowPlatform}
        orgId={orgId}
        onCancel={() => setFlowPlatform(null)}
        onConnected={() => {
          setFlowPlatform(null);
          refresh?.();
          setTimeout(() => refresh?.(), 2500);
        }}
      />
    </Animated.View>
  );
}

// Every value below is the one its sibling step in CreateAccountScreen uses.
// This step used to be a settings-style card with dividers and a section label,
// which read as a different screen; it is now the same rows the seller has been
// tapping for ten steps.
const styles = StyleSheet.create({
  wrap: { flex: 1, padding: 24, justifyContent: 'space-between' },
  title: {
    fontSize: 26,
    lineHeight: 32,
    fontFamily: 'Inter_700Bold',
    color: INK,
    letterSpacing: -0.5,
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 15,
    lineHeight: 22,
    fontFamily: 'Inter_500Medium',
    color: SUBTLE,
    marginTop: 6,
  },

  selectList: { marginTop: 18, gap: 10 },
  selectRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 62,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 11,
    backgroundColor: CARD_BG,
    borderWidth: 1.5,
    borderColor: BORDER,
  },
  selectRowActive: {
    backgroundColor: 'rgba(147,200,34,0.10)',
    borderColor: GREEN,
  },
  // Same 40pt circle as the sibling rows, neutral fill so brand logos read.
  selectIconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#F1EFE6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectLabelWrap: { flex: 1, marginLeft: 13 },
  selectLabel: { fontSize: 16, fontFamily: 'Inter_600SemiBold', color: INK },
  rowStatus: { fontSize: 12, fontFamily: 'Inter_500Medium', color: GREEN_DEEP, marginTop: 2 },

  selectorBox: { width: 24, height: 24, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  selectorSelected: { backgroundColor: GREEN },
  connectText: { color: GREEN_DEEP, fontSize: 15, fontFamily: 'Inter_600SemiBold' },

  hint: {
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
    color: SUBTLE,
    marginTop: 14,
  },

  primaryBtn: {
    backgroundColor: GREEN,
    height: 54,
    borderRadius: 999,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  primaryText: { color: '#FFFFFF', fontSize: 16, fontFamily: 'Inter_700Bold' },
});
