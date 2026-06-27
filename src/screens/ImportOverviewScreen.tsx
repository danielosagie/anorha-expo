import React, { useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Alert,
  TouchableOpacity,
} from 'react-native';
import { useRoute, useNavigation, RouteProp } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Store } from 'lucide-react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { AppStackParamList } from '../navigation/AppNavigator';
import { useImportSession } from '../hooks/useImportSession';
import { useOptimizerQueues } from '../hooks/useOptimizerQueues';
import { ImportWizardSheet } from '../components/import/ImportWizardSheet';
import { RC } from '../components/resolve/ResolveKit';
import { reviewDeckCases } from '../components/resolve/classifyMatch';
import { LobbyHeader, HeaderPill, UpNextRow } from '../components/quest/LobbyKit';

type IconName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];
import PlatformLogo from '../components/PlatformLogo';
import { getPlatform, getPlatformColor } from '../config/platforms';

type ImportOverviewRouteProp = RouteProp<AppStackParamList, 'ImportOverview'>;
type ImportOverviewNavProp = StackNavigationProp<AppStackParamList, 'ImportOverview'>;

// ── Import Inventory — the calm RESUME hub ────────────────────────────────────
// Reached when a seller comes BACK to a half-finished import (from Connections /
// Settings), never as the mandatory first screen after a scan — that lands
// straight on the review deck. So this is a "where does this stand, jump back
// in" surface: one confidence summary, then the steps, active one first.
const ImportOverviewScreen = () => {
  const route = useRoute<ImportOverviewRouteProp>();
  const navigation = useNavigation<ImportOverviewNavProp>();
  const insets = useSafeAreaInsets();

  const { connectionId, platformName } = route.params as any;
  const platformColor = getPlatformColor(platformName);

  const session = useImportSession({
    connectionId,
    platformName,
    // On completion, drop the import flow from the stack so "back" from "Import Complete"
    // lands on Inventory, not the stale Match/overview screens.
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
    loading,
    suggestions,
    totalScanned,
    settingsDone,
    setWizardVisible,
    submitImport,
    isSubmitting,
    counts,
    connection,
    refreshSuggestions,
  } = session;

  // Optimize count — import-scoped (only THIS connection's mapped variants) and
  // read from the SAME hook the optimize screen walks, so the hub badge, the
  // subtitle, and the optimize screen can never disagree. (Was a separate
  // catalog-wide query with different thresholds — the source of the "188 here,
  // Done there" mismatch.)
  const { counts: optimizerCounts, refresh: refreshOptimizer } = useOptimizerQueues({ connectionId });
  // Distinct items needing any work (photos OR details). photoNeeded/dataNeeded
  // overlap now (an item can need both), so a naive sum would double-count.
  const optimizeCount = optimizerCounts.attention;

  useEffect(() => {
    const unsub = navigation.addListener('focus', () => {
      session.refreshSuggestions();
      refreshOptimizer();
    });
    return unsub;
  }, [navigation, refreshSuggestions, refreshOptimizer]);

  const optimizerDone = optimizeCount === 0;
  // The real "to review" count is the deck's decision cards — classifyMatch groups
  // the hundreds of raw rows into a handful of actual decisions. Drive the Match
  // label AND its done-state off THIS one number so the hub, the deck, and the
  // checkmark never disagree (a raw-row count once read "438").
  const matchCases = useMemo(
    () => reviewDeckCases((suggestions || []) as any, platformName),
    [suggestions, platformName],
  );
  const matchDone = matchCases.length === 0;
  const canComplete = matchDone && settingsDone && optimizerDone;

  const handleCompleteImport = () => {
    if (!canComplete) return;
    Alert.alert('Complete import', `Start syncing ${totalScanned} products with ${platformName}?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Confirm', style: 'default', onPress: () => submitImport() },
    ]);
  };

  // Stage model — Match → Optimize → Preferences → Finish. Each step unlocks the
  // next; "finish" is the terminal sync action, so it is only ever locked or
  // active — never "done" from inside the hub.
  type StageId = 'match' | 'optimize' | 'preferences' | 'finish';
  const stageOrder: StageId[] = ['match', 'optimize', 'preferences', 'finish'];
  const stageDone: Record<StageId, boolean> = {
    match: matchDone,
    optimize: optimizerDone,
    preferences: settingsDone,
    finish: false,
  };
  const activeStage: StageId = stageOrder.find((st) => !stageDone[st]) || 'finish';

  const onStagePress = (st: StageId) => {
    if (st === 'match') {
      navigation.navigate('MappingReview' as any, { connectionId, platformName });
    } else if (st === 'optimize') {
      navigation.navigate('BackfillOptimizer' as any, { source: 'import', connectionId, platformName });
    } else if (st === 'preferences') {
      setWizardVisible(true);
    } else {
      handleCompleteImport();
    }
  };

  // ── Confidence summary — answers "where does this stand?" in one read ───────
  const prepStages: StageId[] = ['match', 'optimize', 'preferences'];
  const prepDone = prepStages.filter((st) => stageDone[st]).length;
  const prepPct = Math.round((prepDone / prepStages.length) * 100);

  type StageView = { icon: IconName; title: string; upSub: string; count: number | null; cta: string };
  const stageView = (st: StageId): StageView => {
    switch (st) {
      case 'optimize':
        return { icon: 'star-four-points', title: 'Optimize', upSub: 'photos & details', count: optimizeCount > 0 ? optimizeCount : null, cta: 'Start · Optimize' };
      case 'preferences':
        return { icon: 'tune-variant', title: 'Preferences', upSub: 'how syncing behaves', count: null, cta: 'Set up · Preferences' };
      case 'finish':
        return { icon: 'flag-variant', title: 'Sync', upSub: 'goes live everywhere', count: null, cta: canComplete ? 'Sync now' : 'Finish the steps above' };
      case 'match':
      default:
        return { icon: 'puzzle', title: 'Match', upSub: matchCases.length === 0 ? 'All matched · nothing to review' : `${matchCases.length} to review`, count: null, cta: 'Start · Match' };
    }
  };

  const av = stageView(activeStage);
  const upcoming = stageOrder.filter((st) => st !== activeStage && !stageDone[st]);
  const completed = stageOrder.filter((st) => stageDone[st]);

  // The card orients: the "N of 3 ready" status title + this terse "what's next"
  // line (names the active step + its count) instead of a bare item count.
  const summarySub = canComplete
    ? 'Ready to sync'
    : `Next · ${av.title}${typeof av.count === 'number' && av.count > 0 ? ` · ${av.count}` : ''}`;

  const platformPill = (
    <HeaderPill
      label={platformName}
      leading={
        getPlatform(platformName) ? (
          <PlatformLogo type={platformName} size={16} />
        ) : (
          <Store size={14} color={platformColor} />
        )
      }
    />
  );

  if (loading) {
    return (
      <View style={[styles.screen, { paddingTop: insets.top + 6 }]}>
        <LobbyHeader title="Import Inventory" onBack={() => navigation.goBack()} right={platformPill} />
        <View style={styles.center}>
          <ActivityIndicator size="large" color={RC.green} />
          <Text style={styles.centerText}>Loading import…</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 6 }]}>
      <LobbyHeader title="Import Inventory" onBack={() => navigation.goBack()} right={platformPill} />

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Confidence summary — where this import stands, in one calm read */}
        <Animated.View entering={FadeInDown.duration(260)} style={styles.summaryCard}>
          <View style={styles.summaryTop}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.summaryTitle}>
                {canComplete ? 'Ready to sync' : `${prepDone} of ${prepStages.length} ready`}
              </Text>
              <Text style={styles.summarySub} numberOfLines={2}>{summarySub}</Text>
            </View>
            <View style={[styles.summaryBadge, canComplete && styles.summaryBadgeReady]}>
              <MaterialCommunityIcons
                name={canComplete ? 'check' : av.icon}
                size={20}
                color={canComplete ? '#fff' : RC.greenDark}
              />
            </View>
          </View>
          <View style={styles.summaryTrack}>
            <View style={[styles.summaryFill, { width: `${prepPct}%` }]} />
          </View>
        </Animated.View>

        <Text style={styles.sectionLabel}>START HERE</Text>
        <Animated.View entering={FadeInDown.duration(260).delay(60)}>
          <UpNextRow
            icon={av.icon}
            title={av.title}
            sub={av.upSub}
            count={av.count}
            state="active"
            onPress={() => onStagePress(activeStage)}
          />
        </Animated.View>

        {upcoming.length > 0 && (
          <>
            <Text style={styles.sectionLabel}>THEN</Text>
            {upcoming.map((st, i) => {
              const v = stageView(st);
              return (
                <Animated.View key={st} entering={FadeInDown.duration(260).delay(120 + i * 60)}>
                  <UpNextRow icon={v.icon} title={v.title} sub={v.upSub} count={v.count} onPress={() => onStagePress(st)} />
                </Animated.View>
              );
            })}
          </>
        )}

        {completed.length > 0 && (
          <>
            <Text style={styles.sectionLabel}>DONE</Text>
            {completed.map((st, i) => {
              const v = stageView(st);
              return (
                <Animated.View key={st} entering={FadeInDown.duration(260).delay(220 + i * 60)}>
                  <UpNextRow icon={v.icon} title={v.title} sub="Done" state="done" onPress={() => onStagePress(st)} />
                </Animated.View>
              );
            })}
          </>
        )}
      </ScrollView>

      <LinearGradient
        colors={['rgba(255,255,255,0)', '#FFFFFF', '#FFFFFF']}
        style={[styles.sticky, { paddingBottom: insets.bottom + 18 }]}
        pointerEvents="box-none"
      >
        <TouchableOpacity
          activeOpacity={0.88}
          disabled={activeStage === 'finish' && (!canComplete || isSubmitting)}
          onPress={() => onStagePress(activeStage)}
          style={[
            styles.ctaBtn,
            activeStage === 'finish' && (!canComplete || isSubmitting) && styles.ctaBtnDim,
          ]}
        >
          <Text
            style={[
              styles.ctaBtnText,
              activeStage === 'finish' && (!canComplete || isSubmitting) && { color: RC.faint },
            ]}
          >
            {av.cta}
          </Text>
        </TouchableOpacity>
      </LinearGradient>

      <ImportWizardSheet
        visible={session.wizardVisible}
        onClose={() => session.setWizardVisible(false)}
        platformName={platformName}
        connection={connection}
        counts={counts}
        session={session}
        showReselectMatches={false}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#FFFFFF' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  centerText: { fontSize: 13, fontWeight: '500', color: RC.muted, marginTop: 12 },

  scroll: { paddingHorizontal: 18, paddingBottom: 190, paddingTop: 8 },

  // Confidence summary
  summaryCard: {
    backgroundColor: RC.greenSoft,
    borderWidth: 1,
    borderColor: RC.greenLine,
    borderRadius: 18,
    padding: 16,
  },
  summaryTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  summaryTitle: { fontSize: 18, fontWeight: '800', color: RC.greenInk, letterSpacing: -0.3, fontVariant: ['tabular-nums'] },
  summarySub: { fontSize: 13.5, fontWeight: '500', color: RC.greenDark, marginTop: 3 },
  summaryBadge: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: RC.greenLine,
    alignItems: 'center',
    justifyContent: 'center',
  },
  summaryBadgeReady: { backgroundColor: RC.green, borderColor: RC.green },
  summaryTrack: { height: 6, borderRadius: 3, backgroundColor: 'rgba(74,124,0,0.14)', overflow: 'hidden', marginTop: 14 },
  summaryFill: { height: '100%', borderRadius: 3, backgroundColor: RC.green },

  sectionLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: '#666666',
    letterSpacing: 0.2,
    marginTop: 20,
    marginBottom: 12,
    marginLeft: 2,
  },

  sticky: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 16,
    paddingTop: 30,
  },
  ctaBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    height: 52,
    borderRadius: 14,
    backgroundColor: RC.green,
  },
  ctaBtnDim: { backgroundColor: RC.surface2 },
  ctaBtnText: { fontSize: 16, fontWeight: '700', color: '#fff', letterSpacing: -0.2 },
});

export default ImportOverviewScreen;
