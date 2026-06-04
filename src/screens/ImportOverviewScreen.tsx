import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, Alert, useWindowDimensions } from 'react-native';
import { useRoute, useNavigation, RouteProp } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Store } from 'lucide-react-native';

import { AppStackParamList } from '../navigation/AppNavigator';
import { supabase } from '../../lib/supabase';
import { useImportSession } from '../hooks/useImportSession';
import { ImportWizardSheet } from '../components/import/ImportWizardSheet';
import { RC } from '../components/resolve/ResolveKit';
import {
  LobbyHeader,
  HeaderPill,
  WindingPath,
  LobbyCTACard,
  PathNodeData,
} from '../components/quest/LobbyKit';
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
  const { width: winW } = useWindowDimensions();
  const pathWidth = Math.min(winW - 36, 420);

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

  // Stage model — Match → Optimize → Preferences → Finish (the winding path).
  // Each step unlocks the next; "finish" is the terminal sync action, so it is
  // only ever locked or active — never "done" from inside the lobby.
  type StageId = 'match' | 'optimize' | 'preferences' | 'finish';
  const stageOrder: StageId[] = ['match', 'optimize', 'preferences', 'finish'];
  const stageDone: Record<StageId, boolean> = {
    match: mappingDone,
    optimize: optimizerDone,
    preferences: settingsDone,
    finish: false,
  };
  const activeStage: StageId = stageOrder.find((st) => !stageDone[st]) || 'finish';
  const stageState = (st: StageId): 'done' | 'active' | 'locked' => {
    if (stageDone[st]) return 'done';
    return st === activeStage ? 'active' : 'locked';
  };
  const stagesLeft = (['match', 'optimize', 'preferences'] as StageId[]).filter(
    (st) => !stageDone[st],
  ).length;

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

  const NODE_ICON: Record<StageId, PathNodeData['icon']> = {
    match: 'puzzle',
    optimize: 'auto-fix',
    preferences: 'tune-variant',
    finish: 'flag-checkered',
  };
  const NODE_LABEL: Record<StageId, string> = {
    match: 'Match',
    optimize: 'Optimize',
    preferences: 'Preferences',
    finish: 'Finish',
  };
  const pathNodes: PathNodeData[] = stageOrder.map((st) => ({
    id: st,
    label: NODE_LABEL[st],
    state: stageState(st),
    icon: NODE_ICON[st],
    onPress: () => onStagePress(st),
  }));

  // The bottom CTA mirrors whichever step is currently active.
  const ctaByStage: Record<StageId, { title: string; sub: string; color?: string; dark?: string }> = {
    match: { title: 'Match Items', sub: `${reviewCount} item${reviewCount === 1 ? '' : 's'} need review` },
    optimize: { title: 'Optimize Listings', sub: `${optimizeCount} item${optimizeCount === 1 ? '' : 's'} to polish` },
    preferences: { title: 'Set Preferences', sub: 'sync direction · pool · behavior' },
    finish: {
      title: 'Finish Import',
      sub: `sync ${totalScanned} product${totalScanned === 1 ? '' : 's'}`,
      color: RC.green,
      dark: RC.greenDark,
    },
  };
  const cta = ctaByStage[activeStage];

  const platformPill = (
    <HeaderPill
      label={platformName}
      leading={
        PlatformLogo ? (
          <PlatformLogo width={16} height={16} />
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

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 6 }]}>
      <LobbyHeader title="Import Inventory" onBack={() => navigation.goBack()} right={platformPill} />

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.scanLine} numberOfLines={1}>
          {totalScanned} items scanned
          {stagesLeft > 0 ? ` · ${stagesLeft} step${stagesLeft === 1 ? '' : 's'} to go` : ' · ready to sync'}
        </Text>

        <WindingPath nodes={pathNodes} width={pathWidth} />
      </ScrollView>

      <LinearGradient
        colors={['rgba(255,255,255,0)', '#FFFFFF', '#FFFFFF']}
        style={[styles.sticky, { paddingBottom: insets.bottom + 18 }]}
        pointerEvents="box-none"
      >
        <LobbyCTACard
          title={cta.title}
          sub={cta.sub}
          color={cta.color}
          dark={cta.dark}
          disabled={activeStage === 'finish' && (!canComplete || isSubmitting)}
          onPress={() => onStagePress(activeStage)}
        />
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

  scroll: { paddingHorizontal: 18, paddingBottom: 170, paddingTop: 2 },
  scanLine: {
    textAlign: 'center',
    fontSize: 12,
    fontWeight: '600',
    color: RC.muted,
    marginBottom: 2,
  },

  sticky: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 16,
    paddingTop: 30,
  },
});

export default ImportOverviewScreen;
