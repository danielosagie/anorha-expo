import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Alert,
  TouchableOpacity,
  Image,
  useWindowDimensions,
} from 'react-native';
import { useRoute, useNavigation, RouteProp } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LinearGradient } from 'expo-linear-gradient';
import { Store } from 'lucide-react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';

import { AppStackParamList } from '../navigation/AppNavigator';
import { supabase } from '../../lib/supabase';
import { useImportSession } from '../hooks/useImportSession';
import { ImportWizardSheet } from '../components/import/ImportWizardSheet';
import { RC } from '../components/resolve/ResolveKit';
import { reviewDeckCases } from '../components/resolve/classifyMatch';
import {
  LobbyHeader,
  HeaderPill,
  UpNextRow,
  swatchFor,
} from '../components/quest/LobbyKit';

type IconName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];
import PlatformLogo from '../components/PlatformLogo';
import { getPlatform, getPlatformColor } from '../config/platforms';

type ImportOverviewRouteProp = RouteProp<AppStackParamList, 'ImportOverview'>;
type ImportOverviewNavProp = StackNavigationProp<AppStackParamList, 'ImportOverview'>;


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
    reviewCount,
    mappingDone,
    settingsDone,
    syncDirection,
    poolName,
    setWizardVisible,
    submitImport,
    isSubmitting,
    counts,
    connection,
    refreshSuggestions,
  } = session;

  const [optimizeCount, setOptimizeCount] = useState(0);
  const [missingPhotoCount, setMissingPhotoCount] = useState(0);
  const [missingDataCount, setMissingDataCount] = useState(0);

  const fetchOptimizerCounts = useCallback(async () => {
    const { data: variants, error } = await supabase
      .from('ProductVariants')
      .select('Id, Sku, Title, Description, ProductImages!ProductImages_ProductVariantId_fkey(ImageUrl)')
      .limit(200);
    if (!error && variants) {
      let needsOptimize = 0;
      let photosNeeded = 0;
      let productDataNeeded = 0;
      for (const v of variants) {
        const noImages = !v.ProductImages || (v.ProductImages as any[]).length === 0;
        const noSku = !v.Sku || v.Sku.trim() === '';
        const weakDescription = !v.Description || v.Description.length < 30;
        if (noImages) photosNeeded += 1;
        if (noSku || weakDescription) productDataNeeded += 1;
        if (noImages || noSku || weakDescription) needsOptimize += 1;
      }
      setOptimizeCount(needsOptimize);
      setMissingPhotoCount(photosNeeded);
      setMissingDataCount(productDataNeeded);
    }
  }, []);

  useEffect(() => {
    fetchOptimizerCounts();
  }, [fetchOptimizerCounts]);

  useEffect(() => {
    const unsub = navigation.addListener('focus', () => {
      session.refreshSuggestions();
      fetchOptimizerCounts();
    });
    return unsub;
  }, [navigation, refreshSuggestions, fetchOptimizerCounts]);

  const optimizerDone = optimizeCount === 0;
  // The real "to review" count is the deck's decision cards — classifyMatch groups
  // the hundreds of raw rows into a handful of actual decisions. Drive the Match
  // label AND its done-state off THIS one number so the lobby, the deck, and the
  // checkmark never disagree (the old `reviewCount` counted raw rows = "438").
  const matchCases = useMemo(
    () => reviewDeckCases((suggestions || []) as any, platformName),
    [suggestions, platformName],
  );
  const matchDone = matchCases.length === 0;
  const canComplete = matchDone && settingsDone && optimizerDone;

  const handleCompleteImport = () => {
    if (!canComplete) return;
    Alert.alert('Complete Import', `Start syncing ${totalScanned} products with ${platformName}?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Confirm', style: 'default', onPress: () => submitImport() },
    ]);
  };

  // Stage model — Match → Optimize → Preferences → Finish (the winding path).
  // Each step unlocks the next; "finish" is the terminal sync action, so it is
  // only ever locked or active — never "done" from inside the lobby.
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
      navigation.navigate('BackfillOptimizer' as any, { source: 'import' });
    } else if (st === 'preferences') {
      setWizardVisible(true);
    } else {
      handleCompleteImport();
    }
  };

  // Hero preview strip — the items the active "match" stage will act on.
  const reviewItems = (suggestions || [])
    .filter((s) => s.action !== 'IGNORE' && !s.resolved)
    .slice(0, 8)
    .map((s) => ({ id: s.platformProduct.id, imageUrl: s.platformProduct.imageUrl }));

  // ── The receipt — a ONE-TIME splash after the first scan completes ───────
  // Nothing else on screen: the count-up headline and the wall of everything
  // that just came in, pouring in row by row. When the pour finishes (or the
  // user taps anywhere) it drops into the regular overview and never replays.
  const { width: winW, height: winH } = useWindowDimensions();
  const WALL_COLS = 14;
  const wallCell = Math.max(16, Math.floor((winW - 44 - (WALL_COLS - 1) * 4) / WALL_COLS));
  // The wall is a moment, not a browse surface — render only what fits on ONE
  // screen so the animation stays cheap and every visible image is prefetched.
  const wallMaxRows = Math.max(6, Math.floor((winH - insets.top - 190) / (wallCell + 4)));
  const [countN, setCountN] = useState(0);
  const [receiptSeen, setReceiptSeen] = useState<boolean | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(`import_receipt_seen_${connectionId}`)
      .then((v) => setReceiptSeen(!!v))
      .catch(() => setReceiptSeen(true));
  }, [connectionId]);

  const dismissReceipt = useCallback(
    (source: string = 'tap') => {
      setReceiptSeen(true);
      AsyncStorage.setItem(`import_receipt_seen_${connectionId}`, source).catch(() => {});
    },
    [connectionId],
  );

  const receiptCases = matchCases;
  const flaggedIds = useMemo(
    () => new Set(receiptCases.flatMap((c) => c.itemIds || [])),
    [receiptCases],
  );
  const wallItems = useMemo(
    () =>
      (suggestions || []).map((s) => ({
        id: s.platformProduct.id,
        uri: s.platformProduct.imageUrl,
        flagged: flaggedIds.has(s.platformProduct.id),
      })),
    [suggestions, flaggedIds],
  );
  const flaggedCount = useMemo(() => wallItems.filter((w) => w.flagged).length, [wallItems]);
  const selfMatched = wallItems.length - flaggedCount;
  const wallRows = useMemo(() => {
    const capped = wallItems.slice(0, wallMaxRows * WALL_COLS);
    const rows: (typeof wallItems)[] = [];
    for (let i = 0; i < capped.length; i += WALL_COLS) rows.push(capped.slice(i, i + WALL_COLS));
    return rows;
  }, [wallItems, wallMaxRows]);

  // The splash must not fire while suggestions are still streaming in (it
  // would count to 0 over a half-empty wall and burn its one showing). Wait
  // for the count to hold still, then PRE-RENDER: warm every visible image
  // into cache (capped wait) so the pour plays over loaded art, not gray boxes.
  const [wallReady, setWallReady] = useState(false);
  useEffect(() => {
    if (loading || wallItems.length === 0) {
      setWallReady(false);
      return;
    }
    let alive = true;
    const t = setTimeout(() => {
      const uris = wallRows.flat().map((w) => w.uri).filter((u): u is string => !!u);
      const warm = Promise.allSettled(uris.map((u) => Image.prefetch(u)));
      const cap = new Promise((r) => setTimeout(r, 1500));
      Promise.race([warm, cap]).then(() => {
        if (alive) setWallReady(true);
      });
    }, 500);
    return () => {
      alive = false;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, wallItems.length]);

  const showReceipt = wallReady && receiptSeen === false && activeStage === 'match';

  // Headline counts what matched itself — or, when nothing did, what came in.
  const countTarget = selfMatched > 0 ? selfMatched : wallItems.length;
  useEffect(() => {
    if (!showReceipt) return;
    setCountN(0);
    const t0 = Date.now();
    const iv = setInterval(() => {
      const p = Math.min(1, (Date.now() - t0) / 900);
      setCountN(Math.round(p * countTarget));
      if (p >= 1) clearInterval(iv);
    }, 40);
    return () => clearInterval(iv);
  }, [countTarget, showReceipt]);

  // Auto-drop into the overview once the pour settles.
  useEffect(() => {
    if (!showReceipt) return;
    const total = 900 + wallRows.length * 45 + 220 + 1100;
    const t = setTimeout(() => dismissReceipt('auto'), total);
    return () => clearTimeout(t);
  }, [showReceipt, wallRows.length, dismissReceipt]);

  // Per-stage presentation: the hero (when active), the up-next row, and the
  // sticky bottom CTA all read from one source so they never drift apart.
  type StageView = {
    icon: IconName;
    glyph: IconName;
    title: string;
    upSub: string;
    count: number | null;
    heroSub: string;
    ctaSub: string;
    cta: string;
    items?: { id?: string; imageUrl?: string | null }[];
    color?: string;
    dark?: string;
  };
  const stageView = (st: StageId): StageView => {
    switch (st) {
      case 'optimize':
        return {
          icon: 'star-four-points',
          glyph: 'star-four-points-outline',
          title: 'Optimize',
          upSub: 'photos & details',
          count: optimizeCount > 0 ? optimizeCount : null,
          heroSub: '',
          ctaSub: '',
          cta: 'Start · Optimize',
        };
      case 'preferences':
        return {
          icon: 'tune-variant',
          glyph: 'tune-variant',
          title: 'Preferences',
          upSub: 'how syncing behaves',
          count: null,
          heroSub: '',
          ctaSub: '',
          cta: 'Set up · Preferences',
        };
      case 'finish':
        return {
          icon: 'flag-variant',
          glyph: 'flag-variant-outline',
          title: 'Sync',
          upSub: 'goes live everywhere',
          count: null,
          heroSub: '',
          ctaSub: '',
          cta: canComplete ? 'Sync now' : 'Finish the steps above',
          color: RC.green,
          dark: RC.greenDark,
        };
      case 'match':
      default:
        return {
          icon: 'puzzle',
          glyph: 'puzzle-outline',
          title: 'Match',
          upSub: matchCases.length === 0 ? 'All matched · nothing to review' : `${matchCases.length} to review`,
          count: null,
          heroSub: '',
          ctaSub: '',
          cta: 'Start · Match',
          items: reviewItems,
        };
    }
  };

  const av = stageView(activeStage);
  const upcoming = stageOrder.filter((st) => st !== activeStage && !stageDone[st]);
  const completed = stageOrder.filter((st) => stageDone[st]);

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
          <ActivityIndicator size="large" color={RC.orange} />
          <Text style={styles.centerText}>Loading import…</Text>
        </View>
      </View>
    );
  }

  // ── One-time receipt splash — the whole screen, nothing else ─────────────
  if (showReceipt) {
    return (
      <TouchableOpacity
        activeOpacity={1}
        onPress={() => dismissReceipt('tap')}
        style={[styles.screen, { paddingTop: insets.top + 34, overflow: 'hidden' }]}
      >
        <View style={styles.receiptHead}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
            <Text style={styles.receiptBig}>{countN}</Text>
            <Text style={styles.receiptBigSub}>
              {selfMatched > 0 ? 'matched themselves' : 'items came in'}
            </Text>
          </View>
          <Animated.View entering={FadeIn.duration(300).delay(900)} style={styles.receiptFlagRow}>
            <View style={styles.receiptDot} />
            <Text style={styles.receiptFlagText}>
              {selfMatched > 0
                ? `${flaggedCount} flagged for you — they glow below`
                : `${flaggedCount} need a quick look — let’s sort them`}
            </Text>
          </Animated.View>
        </View>
        <View pointerEvents="none" style={{ paddingHorizontal: 22 }}>
          {wallRows.map((row, ri) => (
            <Animated.View
              key={ri}
              entering={FadeIn.duration(220).delay(ri * 45)}
              style={styles.wallRow}
            >
              {row.map((it) => {
                // Glow/dim only carries meaning when SOME items matched
                // themselves — all-flagged renders as a calm uniform wall.
                const contrast = selfMatched > 0;
                return (
                  <View
                    key={it.id}
                    style={[
                      { width: wallCell, height: wallCell, borderRadius: 6, overflow: 'hidden', opacity: !contrast || it.flagged ? 1 : 0.25 },
                      contrast && it.flagged && styles.wallGlow,
                    ]}
                  >
                    {it.uri ? (
                      <Image source={{ uri: it.uri }} style={{ width: '100%', height: '100%' }} />
                    ) : (
                      <View style={{ flex: 1, backgroundColor: swatchFor(it.id) }} />
                    )}
                  </View>
                );
              })}
            </Animated.View>
          ))}
        </View>
      </TouchableOpacity>
    );
  }

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 6 }]}>
      <LobbyHeader title="Import Inventory" onBack={() => navigation.goBack()} right={platformPill} />

      {/* V7 · list-first — no hero. The step list IS the screen: the active
          step is one green-tinted row, everything else waits its turn. */}
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.sectionLabel}>START HERE</Text>
        <UpNextRow
          icon={av.icon}
          title={av.title}
          sub={av.upSub}
          count={av.count}
          state="active"
          onPress={() => onStagePress(activeStage)}
        />

        {upcoming.length > 0 && (
          <>
            <Text style={styles.sectionLabel}>THEN</Text>
            {upcoming.map((st) => {
              const v = stageView(st);
              return (
                <UpNextRow
                  key={st}
                  icon={v.icon}
                  title={v.title}
                  sub={v.upSub}
                  count={v.count}
                  onPress={() => onStagePress(st)}
                />
              );
            })}
          </>
        )}

        {completed.length > 0 && (
          <>
            <Text style={styles.sectionLabel}>DONE</Text>
            {completed.map((st) => {
              const v = stageView(st);
              return (
                <UpNextRow
                  key={st}
                  icon={v.icon}
                  title={v.title}
                  sub="Done"
                  state="done"
                  onPress={() => onStagePress(st)}
                />
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

  scroll: { paddingHorizontal: 18, paddingBottom: 190, paddingTop: 6 },
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

  // ── one-time receipt splash ──────────────────────────────────────────────
  receiptHead: { paddingTop: 4, paddingBottom: 16, paddingHorizontal: 24 },
  receiptBig: { fontSize: 40, fontWeight: '800', color: RC.ink, letterSpacing: -1.2, lineHeight: 42, fontVariant: ['tabular-nums'] },
  receiptBigSub: { fontSize: 17, fontWeight: '700', color: RC.greenDark },
  receiptFlagRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 },
  receiptDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: RC.orange },
  receiptFlagText: { fontSize: 13.5, fontWeight: '600', color: RC.muted },

  wallRow: { flexDirection: 'row', gap: 4, marginBottom: 4 },
  wallGlow: { borderWidth: 2, borderColor: RC.orange },
});

export default ImportOverviewScreen;
