import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, Alert } from 'react-native';
import { useRoute, useNavigation, RouteProp } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Store } from 'lucide-react-native';

import { AppStackParamList } from '../navigation/AppNavigator';
import { supabase } from '../../lib/supabase';
import { useImportSession } from '../hooks/useImportSession';
import { ImportWizardSheet } from '../components/import/ImportWizardSheet';
import {
  QUEST,
  QFONT,
  QuestBar,
  QuestRow,
  QuestCTA,
  QuestSegment,
} from '../components/quest/QuestKit';
import ShopifySvg from '../assets/shopify.svg';
import SquareSvg from '../assets/square.svg';
import CloverSvg from '../assets/clover.svg';
import EbaySvg from '../assets/ebay.svg';
import FacebookSvg from '../assets/facebook.svg';
import AmazonSvg from '../assets/amazon.svg';

type ImportOverviewRouteProp = RouteProp<AppStackParamList, 'ImportOverview'>;
type ImportOverviewNavProp = StackNavigationProp<AppStackParamList, 'ImportOverview'>;

const platformSvgMap: Record<string, React.ComponentType<any>> = {
  shopify: ShopifySvg,
  square: SquareSvg,
  clover: CloverSvg,
  ebay: EbaySvg,
  facebook: FacebookSvg,
  amazon: AmazonSvg,
};

const getPlatformLogoComponent = (name: string): React.ComponentType<any> | null => {
  const n = (name || '').toLowerCase();
  const match = Object.entries(platformSvgMap).find(([key]) => n.includes(key));
  return match?.[1] || null;
};

const getPlatformColor = (name: string): string => {
  const n = (name || '').toLowerCase();
  if (n.includes('shopify')) return '#96BF47';
  if (n.includes('square')) return '#3E4348';
  if (n.includes('clover')) return '#27AE60';
  if (n.includes('ebay')) return '#0064D2';
  if (n.includes('amazon')) return '#FF9900';
  if (n.includes('facebook')) return '#1877F2';
  return '#6B7280';
};

const ImportOverviewScreen = () => {
  const route = useRoute<ImportOverviewRouteProp>();
  const navigation = useNavigation<ImportOverviewNavProp>();
  const insets = useSafeAreaInsets();

  const { connectionId, platformName } = route.params as any;
  const platformColor = getPlatformColor(platformName);
  const PlatformLogo = getPlatformLogoComponent(platformName);

  const session = useImportSession({
    connectionId,
    platformName,
    onNavigate: (screen, params) => navigation.navigate(screen as any, params),
  });

  const {
    loading,
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
  const canComplete = mappingDone && settingsDone && optimizerDone;

  const handleCompleteImport = () => {
    if (!canComplete) return;
    Alert.alert('Complete Import', `Start syncing ${totalScanned} products with ${platformName}?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Confirm', style: 'default', onPress: () => submitImport() },
    ]);
  };

  // Stage model — Match → Optimize → Settings, each unlocks the next (HO3/HO6).
  type StageId = 'match' | 'optimize' | 'settings';
  const stageOrder: StageId[] = ['match', 'optimize', 'settings'];
  const stageDone: Record<StageId, boolean> = {
    match: mappingDone,
    optimize: optimizerDone,
    settings: settingsDone,
  };
  const activeStage = stageOrder.find((st) => !stageDone[st]) || null;
  const stageState = (st: StageId): 'done' | 'active' | 'locked' => {
    if (stageDone[st]) return 'done';
    return st === activeStage ? 'active' : 'locked';
  };
  const stagesLeft = stageOrder.filter((st) => !stageDone[st]).length;

  const segments: QuestSegment[] = [
    {
      n: Math.max(totalScanned, 1),
      done: mappingDone,
      color: QUEST.green,
      short: 'match',
      label: activeStage === 'match' ? 'match' : undefined,
    },
    {
      n: Math.max(optimizeCount, 1),
      done: optimizerDone,
      color: QUEST.orange,
      short: 'polish',
      label: activeStage === 'optimize' ? 'polish' : undefined,
    },
    {
      n: 1,
      done: settingsDone,
      color: QUEST.blue,
      short: 'setup',
      label: activeStage === 'settings' ? 'setup' : undefined,
    },
  ];
  const activeIdx = activeStage ? stageOrder.indexOf(activeStage) : stageOrder.length - 1;

  const onStagePress = (st: StageId) => {
    if (st === 'match') {
      navigation.navigate('MappingReview' as any, { connectionId, platformName });
    } else if (st === 'optimize') {
      navigation.navigate('BackfillOptimizer' as any, { source: 'import' });
    } else {
      // Settings opens the existing wizard sheet directly (HO6 — unchanged).
      setWizardVisible(true);
    }
  };

  if (loading) {
    return (
      <View style={[styles.screen, { paddingTop: insets.top + 6 }]}>
        <QuestBar segments={segments} activeIdx={activeIdx} close="back" onClose={() => navigation.goBack()} />
        <View style={styles.center}>
          <ActivityIndicator size="large" color={QUEST.green} />
          <Text style={styles.centerText}>Loading import…</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 6 }]}>
      <QuestBar segments={segments} activeIdx={activeIdx} close="back" onClose={() => navigation.goBack()} />

      {/* Compact platform identity row (replaces the hero banner) */}
      <View style={styles.identity}>
        <View style={[styles.logo, { backgroundColor: platformColor }]}>
          {PlatformLogo ? <PlatformLogo width={22} height={22} /> : <Store size={18} color="#fff" />}
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.identityTitle} numberOfLines={1}>
            Import from {platformName}
          </Text>
          <Text style={styles.identitySub} numberOfLines={1}>
            {totalScanned} items scanned
            {stagesLeft > 0 ? ` · ${stagesLeft} stage${stagesLeft === 1 ? '' : 's'} to go` : ' · all stages clear'}
          </Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <QuestRow
          state={stageState('match')}
          accent={QUEST.green}
          accentDark={QUEST.greenD}
          count={mappingDone ? totalScanned : reviewCount}
          unit={mappingDone ? 'items' : 'left'}
          title="Match products"
          sub={mappingDone ? 'all items linked to your catalog' : 'link imported items to your catalog'}
          onPress={() => onStagePress('match')}
        />
        <QuestRow
          state={stageState('optimize')}
          accent={QUEST.orange}
          accentDark={QUEST.orangeD}
          count={optimizerDone ? totalScanned : optimizeCount}
          unit={optimizerDone ? 'items' : 'left'}
          title="Optimize listings"
          sub={
            optimizerDone
              ? 'photos added · data drafted'
              : `${missingPhotoCount} need photos · ${missingDataCount} need details`
          }
          onPress={stageState('optimize') === 'locked' ? undefined : () => onStagePress('optimize')}
        />
        <QuestRow
          state={stageState('settings')}
          accent={QUEST.blue}
          accentDark={QUEST.blueD}
          count={settingsDone ? '✓' : '—'}
          unit="setup"
          title="Import settings"
          sub={settingsDone ? `${syncDirection} · ${poolName}` : 'direction · pool · sync behavior'}
          onPress={stageState('settings') === 'locked' ? undefined : () => onStagePress('settings')}
        />
      </ScrollView>

      <LinearGradient
        colors={['rgba(250,247,238,0)', QUEST.bg, QUEST.bg]}
        style={[styles.sticky, { paddingBottom: insets.bottom + 24 }]}
        pointerEvents="box-none"
      >
        {canComplete && <Text style={styles.readyTag}>★ READY TO SYNC</Text>}
        <QuestCTA
          label="Complete import"
          icon={canComplete ? 'chevron-right' : undefined}
          color={canComplete ? QUEST.green : QUEST.ink}
          dark={canComplete ? QUEST.greenD : '#000'}
          disabled={!canComplete || isSubmitting}
          onPress={handleCompleteImport}
        />
        {!canComplete && <Text style={styles.hint}>finish every stage to unlock</Text>}
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
  screen: { flex: 1, backgroundColor: QUEST.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  centerText: { fontSize: 13, fontFamily: QFONT.m, color: QUEST.sub, marginTop: 12 },

  identity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingBottom: 16,
  },
  logo: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  identityTitle: { fontSize: 17, fontFamily: QFONT.b, color: QUEST.ink, letterSpacing: -0.4 },
  identitySub: { fontSize: 11.5, fontFamily: QFONT.m, color: QUEST.sub, marginTop: 2 },

  scroll: { paddingHorizontal: 16, paddingBottom: 160 },

  sticky: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 18,
    paddingTop: 28,
  },
  readyTag: {
    textAlign: 'center',
    fontSize: 11,
    fontFamily: QFONT.x,
    color: QUEST.greenD,
    letterSpacing: 0.4,
    marginBottom: 12,
  },
  hint: {
    textAlign: 'center',
    fontSize: 11,
    fontFamily: QFONT.sb,
    color: QUEST.muted,
    marginTop: 10,
  },
});

export default ImportOverviewScreen;
