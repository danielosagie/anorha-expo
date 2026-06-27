import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Image,
  Alert,
} from 'react-native';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Progress from 'react-native-progress';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

import { AppStackParamList } from '../navigation/AppNavigator';
import { useTheme } from '../context/ThemeContext';
import { useImportSession } from '../hooks/useImportSession';
import { usePlatformConnections } from '../context/PlatformConnectionsContext';
import { tokens } from '../design/tokens';
import MatchDeck from '../components/import/MatchDeck';
import { classifyMatch, reviewDeckCases } from '../components/resolve/classifyMatch';
import anorhaLogo from '../assets/rounded_anorha.png';

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

type RouteType = RouteProp<AppStackParamList, 'MappingReview'>;
type NavType = StackNavigationProp<AppStackParamList, 'MappingReview'>;

const MappingReviewScreen: React.FC = () => {
  const theme = useTheme();
  const route = useRoute<RouteType>();
  const navigation = useNavigation<NavType>();
  const insets = useSafeAreaInsets();
  const { connectionId, platformName, importedProducts, isCSVImport, isScanning } = (route.params || {}) as any;

  const { progressByConnectionId } = usePlatformConnections();
  const syncProgress = progressByConnectionId[connectionId];
  const isScanningEarly =
    isScanning ||
    syncProgress?.status === 'scanning' ||
    syncProgress?.status === 'syncing';

  const session = useImportSession({
    connectionId,
    platformName,
    isCSVImport,
    importedProducts,
    skipInitialFetch: !!isScanningEarly,
    // Completing the import must DROP the whole import flow from the stack — otherwise
    // "back" from "Import Complete" re-enters the now-stale Match / overview screens (the
    // messed-up stack the seller hit). Reset to Inventory with the completion screen on top.
    onNavigate: (screen, params) =>
      screen === 'PublishConfirmation'
        ? navigation.reset({
            index: 1,
            routes: [
              { name: 'TabNavigator' as any, params: { screen: 'Inventory' } },
              { name: 'PublishConfirmation' as any, params },
            ],
          })
        : navigation.navigate(screen as any, params),
  });

  const {
    suggestions,
    setSuggestions,
    importDraft,
    loading,
    error,
    refreshSuggestions,
    submitImport,
    isSubmitting,
  } = session;

  const [doneVisible, setDoneVisible] = useState(false);

  // The deck and this host read the live mapping suggestions through the same
  // classifier, so `remaining` is exactly the deck's review-card count — no
  // dependency on the server import-draft (which 404s on sssync-bknd).
  const classify = useMemo(
    () => classifyMatch((suggestions || []) as any, platformName),
    [suggestions, platformName],
  );
  const remaining = useMemo(
    () => reviewDeckCases((suggestions || []) as any, platformName).length,
    [suggestions, platformName],
  );
  const autoMatched = classify.autoResolved.length || (importDraft?.summary.autoResolved ?? 0);
  // Done-overlay tallies, read straight off the decided suggestions.
  const broughtInCount =
    autoMatched + (suggestions || []).filter((s) => s.resolved && s.isSelected && s.action !== 'IGNORE').length;
  const answeredSkips = (suggestions || []).filter((s) => s.resolved && s.action === 'IGNORE').length;

  // Nothing to review → land directly on the single "All reviewed" confirm summary. The
  // separate "All set / Complete import" lobby card was a redundant extra screen on the way
  // to the same confirm. Fire once (ref-guarded) so the overlay's "Back to review" can still
  // dismiss it; re-arm if real review work reappears (e.g. an undo).
  const autoDoneShownRef = useRef(false);
  useEffect(() => {
    if (loading || !suggestions) return;
    if (remaining > 0) { autoDoneShownRef.current = false; return; }
    if (!doneVisible && !autoDoneShownRef.current) {
      autoDoneShownRef.current = true;
      setDoneVisible(true);
    }
  }, [loading, suggestions, remaining, doneVisible]);

  // Scan completion: react to the sync status instead of polling every 2.5s forever.
  // syncProgress comes from usePlatformConnections() — a React state value in the dep
  // array — so this effect already re-runs the moment the socket pushes a new status.
  // A single bounded fallback re-fetches once if a terminal event is ever missed
  // (reconnect / background / packet loss), preserving the old poll's safety-net intent
  // without the forever loop.
  useEffect(() => {
    if (!connectionId || !isScanningEarly) return;
    const status = syncProgress?.status;
    if (status === 'review' || status === 'active' || status === 'completed') {
      refreshSuggestions();
      return;
    }
    const fallback = setTimeout(() => { refreshSuggestions(); }, 20000);
    return () => clearTimeout(fallback);
  }, [connectionId, isScanningEarly, syncProgress?.status, refreshSuggestions]);

  const handleConfirmMapping = useCallback(async () => {
    try {
      await submitImport();
      setDoneVisible(false);
    } catch (e: any) {
      Alert.alert('Could not confirm mapping', e?.message || 'Please try again.');
    }
  }, [submitImport]);

  // ---------------------------------------------------------------------------
  // Render: reading → deck. No lobby, no "start reviewing" gate — the seller
  // lands on the work itself.
  // ---------------------------------------------------------------------------

  // `isScanning` is a one-time entry hint; the moment the first suggestions land
  // we leave the reading surface for the deck (never gate on the sticky route
  // param forever, or the screen would never advance past "reading").
  const scanInProgress =
    syncProgress?.status === 'scanning' || syncProgress?.status === 'syncing';
  const reading = loading || ((!!isScanning || scanInProgress) && !suggestions);

  // Reading — the scan/initial load streams in. A calm "we're reading your
  // listings" surface, never a percentage, that resolves straight into the first
  // decision card the instant data is ready.
  if (reading) {
    return (
      <View style={[styles.screen, { backgroundColor: theme.colors.background, paddingTop: insets.top + 8 }]}>
        <View style={styles.readingTopRow}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.headerBackBtn} hitSlop={8}>
            <Icon name="arrow-left" size={20} color={theme.colors.text} />
          </TouchableOpacity>
        </View>
        <View style={styles.scanBlock}>
          <Image source={anorhaLogo} style={styles.readingLogo} resizeMode="contain" />
          <Text style={[styles.readingTitle, { color: theme.colors.text }]}>
            Reading your {platformName || 'listings'}
          </Text>
          <Text style={[styles.readingSub, { color: theme.colors.textSecondary }]}>
            The first ones land in a few seconds.
          </Text>
          <View style={styles.readingBarWrap}>
            <Progress.Bar
              indeterminate
              width={null}
              height={5}
              borderRadius={3}
              color={theme.colors.primary}
              unfilledColor="#E5E7EB"
              borderWidth={0}
            />
          </View>
        </View>
      </View>
    );
  }

  if (error) {
    return (
      <View style={[styles.screen, { backgroundColor: theme.colors.background, paddingTop: insets.top + 24 }]}>
        <Header title="Match products" count={0} onClose={() => navigation.goBack()} theme={theme} />
        <View style={styles.scanBlock}>
          <Icon name="alert-circle-outline" size={32} color="#EF4444" />
          <Text style={[styles.scanTitle, { color: theme.colors.text }]}>{error}</Text>
          <TouchableOpacity onPress={refreshSuggestions} style={[styles.retryBtn, { backgroundColor: theme.colors.text }]}>
            <Text style={styles.retryBtnText}>Try again</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // The deck IS the screen — one decision at a time, driven by the live
  // suggestions (classifyMatch → MatchResolver). Auto-matched items never become
  // cards and stay browsable from the deck's "All items" view. DoneOverlay rides
  // on top when the last card is resolved (or, for an all-auto import, on arrival
  // via the ref-guarded effect above).
  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <MatchDeck
        theme={theme}
        insets={insets}
        suggestions={suggestions || []}
        platformName={platformName}
        setSuggestions={setSuggestions}
        onClose={() => navigation.goBack()}
        onCommit={() => setDoneVisible(true)}
      />

      {doneVisible && (
        <DoneOverlay
          theme={theme}
          insets={insets}
          linkedCount={broughtInCount}
          skippedCount={answeredSkips}
          onConfirm={handleConfirmMapping}
          onBack={() => setDoneVisible(false)}
          isSubmitting={isSubmitting}
        />
      )}
    </View>
  );
};

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

function Header({ title, count, onClose, theme }: { title: string; count: number; onClose: () => void; theme: any }) {
  return (
    <View style={styles.header}>
      <TouchableOpacity onPress={onClose} style={styles.headerBackBtn} hitSlop={8}>
        <Icon name="arrow-left" size={20} color={theme.colors.text} />
      </TouchableOpacity>
      <Text style={[styles.headerTitle, { color: theme.colors.text }]}>{title}</Text>
      <Text style={[styles.headerCount, { color: theme.colors.textSecondary }]}>{count}</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Done Overlay
// ---------------------------------------------------------------------------

function DoneOverlay({
  theme,
  insets,
  linkedCount,
  skippedCount,
  onConfirm,
  onBack,
  isSubmitting,
}: {
  theme: any;
  insets: { top: number; bottom: number };
  linkedCount: number;
  skippedCount: number;
  onConfirm: () => void;
  onBack: () => void;
  isSubmitting: boolean;
}) {
  return (
    <View style={[styles.doneOverlay, { backgroundColor: theme.colors.background, paddingTop: insets.top + 80 }]}>
      <View style={styles.donePlant}>
        <Image source={anorhaLogo} style={styles.doneLogo} resizeMode="contain" />
      </View>
      <Text style={[styles.doneTitle, { color: theme.colors.text }]}>All reviewed</Text>
      <Text style={[styles.doneSub, { color: theme.colors.textSecondary }]}>
        Everything is linked and ready. Confirm to apply across all platforms.
      </Text>
      <View style={styles.doneStats}>
        <View style={styles.doneStat}>
          <Text style={[styles.doneStatValue, { color: theme.colors.text }]}>{linkedCount}</Text>
          <Text style={[styles.doneStatLabel, { color: theme.colors.textSecondary }]}>Linked</Text>
        </View>
        <View style={styles.doneStat}>
          <Text style={[styles.doneStatValue, { color: theme.colors.text }]}>{skippedCount}</Text>
          <Text style={[styles.doneStatLabel, { color: theme.colors.textSecondary }]}>Skipped</Text>
        </View>
      </View>
      <TouchableOpacity
        onPress={onConfirm}
        disabled={isSubmitting}
        style={[styles.doneBtn, { backgroundColor: theme.colors.primary }]}
      >
        {isSubmitting ? (
          <ActivityIndicator color="#FFFFFF" />
        ) : (
          <>
            <Icon name="arrow-right" size={16} color="#FFFFFF" />
            <Text style={styles.doneBtnText}>Confirm mapping</Text>
          </>
        )}
      </TouchableOpacity>
      <TouchableOpacity onPress={onBack} style={styles.doneBack}>
        <Icon name="arrow-left" size={14} color={theme.colors.textSecondary} />
        <Text style={[styles.doneBackText, { color: theme.colors.textSecondary }]}>Back to review</Text>
      </TouchableOpacity>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: tokens.spacing.lg,
    paddingBottom: tokens.spacing.sm,
  },
  headerBackBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  headerTitle: {
    flex: 1,
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  headerCount: {
    fontSize: 20,
    fontWeight: '600',
  },

  // Progress

  // Content

  // "How it works" explainer

  // Group card

  // Empty state

  // Matched / skipped row

  // Sticky bottom

  // -------- REVIEW VIEW --------

  // Comparison card (vertical)





  // Quick row

  // Variant section

  // Action bar

  // -------- BOTTOM SHEET (search / more) --------

  // Option row

  // Done overlay
  doneOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 28,
    alignItems: 'center',
  },
  donePlant: {
    width: 76,
    height: 76,
    borderRadius: 22,
    backgroundColor: '#F0FDF4',
    borderWidth: 1,
    borderColor: '#BBF7D0',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 22,
  },
  doneLogo: {
    width: 48,
    height: 48,
    borderRadius: 12,
  },
  doneTitle: {
    fontSize: 26,
    fontWeight: '700',
    marginBottom: 8,
    letterSpacing: -0.4,
  },
  doneSub: {
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 30,
    maxWidth: 280,
    textAlign: 'center',
  },
  doneStats: {
    flexDirection: 'row',
    width: '100%',
    marginBottom: 28,
  },
  doneStat: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    padding: 14,
    marginHorizontal: 4,
  },
  doneStatValue: {
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  doneStatLabel: {
    fontSize: 10,
    marginTop: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    fontWeight: '600',
  },
  doneBtn: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 52,
    borderRadius: 14,
  },
  doneBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
    marginLeft: 6,
  },
  doneBack: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 16,
  },
  doneBackText: {
    fontSize: 13,
    marginLeft: 6,
  },

  // Scan / loading block
  scanBlock: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  scanTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginTop: 16,
    textAlign: 'center',
  },
  retryBtn: {
    marginTop: 16,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 10,
  },
  retryBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 13,
  },

  // Reading — calm "we're reading your listings" surface (no percentage)
  readingTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: tokens.spacing.lg,
    height: 40,
  },
  readingLogo: {
    width: 56,
    height: 56,
    borderRadius: 16,
  },
  readingTitle: {
    fontSize: 19,
    fontWeight: '700',
    marginTop: 18,
    textAlign: 'center',
    letterSpacing: -0.3,
  },
  readingSub: {
    fontSize: 13.5,
    marginTop: 6,
    textAlign: 'center',
  },
  readingBarWrap: {
    width: '62%',
    marginTop: 24,
  },
});

export default MappingReviewScreen;
