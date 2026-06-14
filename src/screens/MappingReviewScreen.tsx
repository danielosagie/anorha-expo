import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
  FlatList,
  Pressable,
  TextInput,
  Modal,
  Image,
  Platform,
  Alert,
  KeyboardAvoidingView,
} from 'react-native';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import * as Progress from 'react-native-progress';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

import { AppStackParamList } from '../navigation/AppNavigator';
import { useTheme } from '../context/ThemeContext';
import { useImportSession } from '../hooks/useImportSession';
import { ImportWizardSheet } from '../components/import/ImportWizardSheet';
import { usePlatformConnections } from '../context/PlatformConnectionsContext';
import { MappingSuggestion } from '../types/importSession';
import Card from '../components/Card';
import PillTabs from '../components/ui/PillTabs';
import { tokens, BRAND_PRIMARY} from '../design/tokens';
import DecisionQueue from '../components/import/DecisionQueue';
import { applyAnswer, buildUnits, DecisionAnswer, DecisionUnit } from '../features/import/decisions';

// ---------------------------------------------------------------------------
// Reason metadata
// ---------------------------------------------------------------------------

type ReviewReason = 'no_match_found' | 'low_confidence' | 'duplicate' | 'variant_mismatch' | 'stale_match';
type ActiveTab = 'review' | 'matched' | 'skipped';

interface ReasonMeta {
  label: string;
  sub: string;
  icon: string;
  iconColor: string;
  iconBg: string;
  badgeBg: string;
  badgeColor: string;
  badgeText: string;
  bulkLabel: string;
  bulkVariant: 'primary' | 'amber' | 'ghost';
}

const REASON_META: Record<ReviewReason, ReasonMeta> = {
  no_match_found: {
    label: 'No match found',
    sub: "Couldn't find a likely match",
    icon: 'magnify',
    iconColor: '#F59E0B',
    iconBg: '#FEF3C7',
    badgeBg: '#DCFCE7',
    badgeColor: '#15803D',
    badgeText: 'Add as new',
    bulkLabel: 'Add all as new',
    bulkVariant: 'primary',
  },
  low_confidence: {
    label: 'Low confidence match',
    sub: 'Confirm or change the suggestion',
    icon: 'alert-outline',
    iconColor: '#D97706',
    iconBg: '#FEF3C7',
    badgeBg: '#FEF3C7',
    badgeColor: '#92400E',
    badgeText: 'Needs check',
    bulkLabel: 'Accept all suggestions',
    bulkVariant: 'amber',
  },
  duplicate: {
    label: 'Possible duplicate',
    sub: 'Already exists in another platform',
    icon: 'set-merge',
    iconColor: '#7C3AED',
    iconBg: '#EDE9FE',
    badgeBg: '#EDE9FE',
    badgeColor: '#5B21B6',
    badgeText: 'Duplicate',
    bulkLabel: 'Merge all duplicates',
    bulkVariant: 'ghost',
  },
  variant_mismatch: {
    label: 'Variant mismatch',
    sub: "Variants don't line up",
    icon: 'layers-outline',
    iconColor: '#2563EB',
    iconBg: '#DBEAFE',
    badgeBg: '#DBEAFE',
    badgeColor: '#1E40AF',
    badgeText: 'Variant issue',
    bulkLabel: 'Review variant mismatches',
    bulkVariant: 'ghost',
  },
  stale_match: {
    label: 'Suggestion updated',
    sub: 'A previous match was claimed',
    icon: 'refresh',
    iconColor: '#9333EA',
    iconBg: '#FAE8FF',
    badgeBg: '#FAE8FF',
    badgeColor: '#86198F',
    badgeText: 'Match changed',
    bulkLabel: 'Re-evaluate all',
    bulkVariant: 'ghost',
  },
};

const REASON_ORDER: ReviewReason[] = [
  'no_match_found',
  'low_confidence',
  'variant_mismatch',
  'duplicate',
  'stale_match',
];

// ---------------------------------------------------------------------------
// Annotation
// ---------------------------------------------------------------------------

interface AnnotatedSuggestion extends MappingSuggestion {
  reviewReason?: ReviewReason;
  isStaleClaim: boolean;
}

function annotateSuggestions(suggestions: MappingSuggestion[]): AnnotatedSuggestion[] {
  const claimedIds = new Set<string>();
  suggestions.forEach((s) => {
    if (s.action === 'LINK_EXISTING' && s.resolved && s.suggestedCanonicalProduct?.id) {
      claimedIds.add(s.suggestedCanonicalProduct.id);
    }
  });

  const familyResolvedCanonicalIds = new Map<string, Set<string>>();
  suggestions.forEach((item) => {
    const parentId = item.platformProduct.parentId;
    const canonicalId = item.suggestedCanonicalProduct?.id || null;
    if (!parentId || !canonicalId || item.resolved !== true || item.action !== 'LINK_EXISTING') return;
    if (!familyResolvedCanonicalIds.has(parentId)) {
      familyResolvedCanonicalIds.set(parentId, new Set<string>());
    }
    familyResolvedCanonicalIds.get(parentId)!.add(canonicalId);
  });

  return suggestions.map((item) => {
    const unresolved = item.action !== 'IGNORE' && item.resolved !== true;
    const canonicalId = item.suggestedCanonicalProduct?.id || null;
    const familyResolvedIds = item.platformProduct.parentId
      ? familyResolvedCanonicalIds.get(item.platformProduct.parentId)
      : undefined;

    const hasFamilyConflict =
      unresolved &&
      !!item.platformProduct.parentId &&
      !!familyResolvedIds &&
      familyResolvedIds.size > 0 &&
      (!canonicalId || !familyResolvedIds.has(canonicalId));

    const isStaleClaim = unresolved && !!canonicalId && claimedIds.has(canonicalId);

    let reviewReason: ReviewReason | undefined;
    if (unresolved) {
      if (hasFamilyConflict) reviewReason = 'variant_mismatch';
      else if (isStaleClaim) reviewReason = 'stale_match';
      else if (item.action === 'UNMATCHED' && !canonicalId) reviewReason = 'no_match_found';
      else if (typeof item.confidence === 'number' && item.confidence < 0.7) reviewReason = 'low_confidence';
      else if (canonicalId) reviewReason = 'low_confidence';
      else reviewReason = 'no_match_found';
    }

    return { ...item, reviewReason, isStaleClaim };
  });
}

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
    onNavigate: (screen, params) => navigation.navigate(screen as any, params),
  });

  const {
    suggestions,
    setSuggestions,
    loading,
    error,
    counts: hookCounts,
    wizardVisible,
    setWizardVisible,
    refreshSuggestions,
    submitImport,
    isSubmitting,
    connection,
  } = session;

  const [activeTab, setActiveTab] = useState<ActiveTab>('review');
  const [openGroup, setOpenGroup] = useState<ReviewReason | null>(null);
  const [searchSheet, setSearchSheet] = useState<{ visible: boolean; targetId: string | null }>({
    visible: false,
    targetId: null,
  });
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [doneVisible, setDoneVisible] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);
  const [queueTotal, setQueueTotal] = useState(0);

  const annotated = useMemo<AnnotatedSuggestion[]>(
    () => annotateSuggestions(suggestions || []),
    [suggestions],
  );

  const grouped = useMemo<Record<ReviewReason, AnnotatedSuggestion[]>>(() => {
    const out: Record<ReviewReason, AnnotatedSuggestion[]> = {
      no_match_found: [],
      low_confidence: [],
      duplicate: [],
      variant_mismatch: [],
      stale_match: [],
    };
    annotated.forEach((s) => {
      if (s.reviewReason) out[s.reviewReason].push(s);
    });
    return out;
  }, [annotated]);

  const matchedItems = useMemo(
    () => annotated.filter((s) => s.resolved && (s.action === 'LINK_EXISTING' || s.action === 'CREATE_NEW')),
    [annotated],
  );
  const skippedItems = useMemo(() => annotated.filter((s) => s.action === 'IGNORE'), [annotated]);
  const reviewCount = annotated.filter((s) => !!s.reviewReason).length;
  const totalItems = annotated.length;
  const resolvedItems = matchedItems.length;

  // Polling for scan completion
  useEffect(() => {
    if (!connectionId || !isScanningEarly) return;
    const interval = setInterval(() => {
      const status = syncProgress?.status;
      if (status === 'review' || status === 'active' || status === 'completed') {
        refreshSuggestions();
        clearInterval(interval);
      }
    }, 2500);
    return () => clearInterval(interval);
  }, [connectionId, isScanningEarly, syncProgress?.status, refreshSuggestions]);

  // Search filter
  useEffect(() => {
    if (!searchSheet.visible) return;
    setSearchLoading(true);
    const t = setTimeout(() => {
      const q = searchQuery.trim().toLowerCase();
      const seen = new Set<string>();
      const results: SearchResult[] = [];
      annotated.forEach((s) => {
        const c = s.suggestedCanonicalProduct;
        if (c?.id && !seen.has(c.id)) {
          if (!q || c.title.toLowerCase().includes(q) || (c.sku || '').toLowerCase().includes(q)) {
            seen.add(c.id);
            results.push({
              id: c.id,
              title: c.title,
              sku: c.sku || null,
              price: c.price ?? null,
              imageUrl: c.imageUrl ?? null,
            });
          }
        }
        const v = s.anorhaVariant;
        if (v?.id && !seen.has(v.id)) {
          if (!q || (v.title || '').toLowerCase().includes(q) || (v.sku || '').toLowerCase().includes(q)) {
            seen.add(v.id);
            results.push({
              id: v.id,
              title: v.title || 'Untitled',
              sku: v.sku,
              price: v.price ?? null,
              imageUrl: v.imageUrl ?? null,
            });
          }
        }
      });
      setSearchResults(results.slice(0, 50));
      setSearchLoading(false);
    }, 150);
    return () => clearTimeout(t);
  }, [searchQuery, searchSheet.visible, annotated]);

  // ---------------------------------------------------------------------------
  // Action helpers
  // ---------------------------------------------------------------------------
  const updateOne = useCallback((id: string, patch: (s: MappingSuggestion) => MappingSuggestion) => {
    setSuggestions((prev) => (prev || []).map((s) => (s.platformProduct.id === id ? patch(s) : s)));
  }, [setSuggestions]);

  const updateMany = useCallback((ids: string[], patch: (s: MappingSuggestion) => MappingSuggestion) => {
    const idSet = new Set(ids);
    setSuggestions((prev) => (prev || []).map((s) => (idSet.has(s.platformProduct.id) ? patch(s) : s)));
  }, [setSuggestions]);

  const openSearchFor = useCallback((item: { platformProduct: { id: string } }) => {
    setSearchSheet({ visible: true, targetId: item.platformProduct.id });
    setSearchQuery('');
  }, []);

  // ── Three-question decision queue (GROUP → SAME → KEEP) ──────────────────────
  const openQueue = useCallback(() => {
    setQueueTotal(buildUnits(suggestions || []).length);
    setQueueOpen(true);
  }, [suggestions]);

  const handleAnswer = useCallback((unit: DecisionUnit, answer: DecisionAnswer) => {
    setSuggestions((prev) => applyAnswer(prev || [], unit, answer));
  }, [setSuggestions]);

  const handleDropFromGroup = useCallback((id: string) => {
    updateOne(id, (s) => ({ ...s, groupId: undefined, groupCover: undefined, groupTitle: undefined }));
  }, [updateOne]);

  const handleSearchSelect = useCallback((result: SearchResult) => {
    if (!searchSheet.targetId) return;
    updateOne(searchSheet.targetId, (s) => ({
      ...s,
      action: 'LINK_EXISTING',
      isSelected: true,
      resolved: true,
      suggestedCanonicalProduct: {
        id: result.id,
        sku: result.sku || '',
        title: result.title,
        price: result.price ?? undefined,
        imageUrl: result.imageUrl ?? null,
      },
    }));
    setSearchSheet({ visible: false, targetId: null });
  }, [searchSheet.targetId, updateOne]);

  const handleBulkForReason = useCallback((reason: ReviewReason) => {
    const items = grouped[reason];
    if (items.length === 0) return;
    if (reason === 'no_match_found') {
      updateMany(items.map((i) => i.platformProduct.id), (s) => ({
        ...s,
        action: 'CREATE_NEW',
        isSelected: true,
        resolved: true,
      }));
    } else if (reason === 'low_confidence' || reason === 'duplicate') {
      updateMany(
        items.filter((i) => !!i.suggestedCanonicalProduct?.id).map((i) => i.platformProduct.id),
        (s) => ({
          ...s,
          action: 'LINK_EXISTING',
          isSelected: true,
          resolved: true,
        }),
      );
    } else {
      openQueue();
    }
  }, [grouped, updateMany, openQueue]);

  const handleConfirmMapping = useCallback(async () => {
    try {
      await submitImport();
      setDoneVisible(false);
    } catch (e: any) {
      Alert.alert('Could not confirm mapping', e?.message || 'Please try again.');
    }
  }, [submitImport]);

  // ---------------------------------------------------------------------------
  // Render: scanning / loading / error
  // ---------------------------------------------------------------------------
  if (loading || isScanningEarly) {
    return (
      <View style={[styles.screen, { backgroundColor: theme.colors.background, paddingTop: insets.top + 24 }]}>
        <Header title="Match products" count={0} onClose={() => navigation.goBack()} theme={theme} />
        <View style={styles.scanBlock}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
          <Text style={[styles.scanTitle, { color: theme.colors.text }]}>Analyzing {platformName}…</Text>
          {syncProgress?.description && (
            <Text style={[styles.scanSub, { color: theme.colors.textSecondary }]}>{syncProgress.description}</Text>
          )}
          {syncProgress?.progress != null && (
            <View style={{ width: '70%', marginTop: 16 }}>
              <Progress.Bar
                progress={(syncProgress.progress || 0) / 100}
                width={null}
                height={6}
                color={theme.colors.primary}
                borderRadius={4}
                borderWidth={0}
                unfilledColor="#E5E7EB"
              />
              <Text style={[styles.scanPct, { color: theme.colors.textSecondary }]}>
                {Math.round(syncProgress.progress || 0)}%
              </Text>
            </View>
          )}
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

  // ---------------------------------------------------------------------------
  // Render: full-screen decision queue (GROUP → SAME → KEEP)
  // ---------------------------------------------------------------------------
  if (queueOpen) {
    return (
      <DecisionQueue
        theme={theme}
        insets={insets}
        suggestions={suggestions || []}
        initialTotal={queueTotal}
        onAnswer={handleAnswer}
        onDropFromGroup={handleDropFromGroup}
        onSearch={openSearchFor}
        onClose={() => setQueueOpen(false)}
        onDone={() => { /* queue shows its own all-clear; user taps Done */ }}
        searchSheet={
          <SearchSheet
            theme={theme}
            visible={searchSheet.visible}
            onClose={() => setSearchSheet({ visible: false, targetId: null })}
            query={searchQuery}
            onQueryChange={setSearchQuery}
            results={searchResults}
            loading={searchLoading}
            onSelect={handleSearchSelect}
          />
        }
      />
    );
  }


  // ---------------------------------------------------------------------------
  // Render: main view
  // ---------------------------------------------------------------------------
  return (
    <View style={[styles.screen, { backgroundColor: theme.colors.background, paddingTop: insets.top + 8 }]}>
      <Header
        title="Match products"
        count={activeTab === 'review' ? reviewCount : totalItems}
        onClose={() => navigation.goBack()}
        theme={theme}
      />

      <PillTabs
        tabs={[
          { key: 'review', label: 'Review', count: reviewCount, tone: 'warning' },
          { key: 'matched', label: 'Matched', count: matchedItems.length, tone: 'success' },
          { key: 'skipped', label: 'Skipped', count: skippedItems.length, tone: 'default' },
        ]}
        value={activeTab}
        onChange={(k) => setActiveTab(k as ActiveTab)}
      />

      {activeTab === 'review' && totalItems > 0 && (
        <View style={styles.progRow}>
          <View style={styles.progMeta}>
            <Text style={[styles.progLabel, { color: theme.colors.textSecondary }]}>
              {resolvedItems} of {totalItems} done
            </Text>
            <Text style={[styles.progPct, { color: theme.colors.primary }]}>
              {Math.round((resolvedItems / totalItems) * 100)}%
            </Text>
          </View>
          <Progress.Bar
            progress={resolvedItems / totalItems}
            width={null}
            height={4}
            borderRadius={2}
            color={theme.colors.primary}
            unfilledColor="#E5E7EB"
            borderWidth={0}
          />
        </View>
      )}

      {activeTab === 'review' ? (
        <ScrollView contentContainerStyle={styles.contentPadding} showsVerticalScrollIndicator={false}>
          {REASON_ORDER.map((reason) => {
            const items = grouped[reason];
            if (items.length === 0) return null;
            return (
              <GroupCard
                key={reason}
                theme={theme}
                reason={reason}
                items={items}
                isOpen={openGroup === reason}
                onToggle={() => setOpenGroup(openGroup === reason ? null : reason)}
                onBulk={() => handleBulkForReason(reason)}
                onReview={openQueue}
                onItemPress={() => openQueue()}
              />
            );
          })}
          {reviewCount === 0 && (
            <View style={styles.emptyState}>
              <Icon name="check-circle-outline" size={36} color={theme.colors.primary} />
              <Text style={[styles.emptyTitle, { color: theme.colors.text }]}>All reviewed</Text>
              <Text style={[styles.emptySub, { color: theme.colors.textSecondary }]}>
                Tap Confirm mapping below to finish.
              </Text>
            </View>
          )}
        </ScrollView>
      ) : activeTab === 'matched' ? (
        <FlatList
          data={matchedItems}
          keyExtractor={(item) => item.platformProduct.id}
          contentContainerStyle={styles.contentPadding}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Icon name="package-variant-closed" size={32} color="#D1D5DB" />
              <Text style={[styles.emptyTitle, { color: theme.colors.text }]}>Nothing matched yet</Text>
              <Text style={[styles.emptySub, { color: theme.colors.textSecondary }]}>
                Confirmed matches will appear here.
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <SimpleRow
              theme={theme}
              imageUrl={item.platformProduct.imageUrl}
              title={item.platformProduct.title}
              subtitle={`→ ${item.suggestedCanonicalProduct?.title || (item.action === 'CREATE_NEW' ? 'New product' : 'Linked')}`}
              right={<Icon name="check-circle" size={18} color={theme.colors.primary} />}
            />
          )}
        />
      ) : (
        <FlatList
          data={skippedItems}
          keyExtractor={(item) => item.platformProduct.id}
          contentContainerStyle={styles.contentPadding}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Icon name="close-circle-outline" size={32} color="#D1D5DB" />
              <Text style={[styles.emptyTitle, { color: theme.colors.text }]}>Nothing skipped</Text>
              <Text style={[styles.emptySub, { color: theme.colors.textSecondary }]}>
                Skipped items will show up here.
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <SimpleRow
              theme={theme}
              imageUrl={item.platformProduct.imageUrl}
              title={item.platformProduct.title}
              subtitle="Skipped — won't import"
              right={
                <TouchableOpacity
                  onPress={() => updateOne(item.platformProduct.id, (s) => ({
                    ...s,
                    action: s.prevAction || 'UNMATCHED',
                    resolved: false,
                  }))}
                >
                  <Text style={[styles.undoText, { color: theme.colors.primary }]}>Undo</Text>
                </TouchableOpacity>
              }
            />
          )}
        />
      )}

      {/* Sticky bottom CTA with white-fade gradient — same look as BottomNav */}
      <LinearGradient
        colors={['rgba(255,255,255,0)', 'rgba(255,255,255,1)', 'rgba(255,255,255,1)']}
        style={[styles.sticky, { paddingBottom: insets.bottom + 14 }]}
        pointerEvents="box-none"
      >
        <View style={styles.stickyRow}>
          <TouchableOpacity
            onPress={() => setWizardVisible(true)}
            style={styles.stickySecondaryBtn}
            activeOpacity={0.85}
          >
            <Icon name="cog-outline" size={18} color={theme.colors.textSecondary} />
            <Text style={[styles.stickySecondaryText, { color: theme.colors.textSecondary }]}>Settings</Text>
          </TouchableOpacity>
          {reviewCount === 0 ? (
            <TouchableOpacity
              onPress={() => setDoneVisible(true)}
              style={[styles.stickyPrimaryBtn, { backgroundColor: theme.colors.primary }]}
              activeOpacity={0.85}
            >
              <Icon name="check" size={17} color="#FFFFFF" />
              <Text style={styles.stickyPrimaryText}>Confirm mapping ({matchedItems.length})</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              onPress={openQueue}
              style={[styles.stickyPrimaryBtn, { backgroundColor: theme.colors.primary }]}
              activeOpacity={0.85}
            >
              <Icon name="play-circle-outline" size={18} color="#FFFFFF" />
              <Text style={styles.stickyPrimaryText}>Review {reviewCount} item{reviewCount === 1 ? '' : 's'}</Text>
            </TouchableOpacity>
          )}
        </View>
      </LinearGradient>

      <SearchSheet
        theme={theme}
        visible={searchSheet.visible}
        onClose={() => setSearchSheet({ visible: false, targetId: null })}
        query={searchQuery}
        onQueryChange={setSearchQuery}
        results={searchResults}
        loading={searchLoading}
        onSelect={handleSearchSelect}
      />

      {doneVisible && (
        <DoneOverlay
          theme={theme}
          insets={insets}
          linkedCount={matchedItems.length}
          skippedCount={skippedItems.length}
          onConfirm={handleConfirmMapping}
          onBack={() => setDoneVisible(false)}
          isSubmitting={isSubmitting}
        />
      )}

      <ImportWizardSheet
        visible={wizardVisible}
        onClose={() => setWizardVisible(false)}
        platformName={platformName}
        connection={connection}
        counts={hookCounts}
        session={session}
        showReselectMatches={false}
      />
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
// Group Card (uses Card component for consistency)
// ---------------------------------------------------------------------------

interface GroupCardProps {
  theme: any;
  reason: ReviewReason;
  items: AnnotatedSuggestion[];
  isOpen: boolean;
  onToggle: () => void;
  onBulk: () => void;
  onReview: () => void;
  onItemPress: (index: number) => void;
}

function GroupCard({ theme, reason, items, isOpen, onToggle, onBulk, onReview, onItemPress }: GroupCardProps) {
  const meta = REASON_META[reason];
  const previewItems = items.slice(0, 6);
  return (
    <Card style={styles.groupCardOuter}>
      <TouchableOpacity onPress={onToggle} style={styles.groupHeader} activeOpacity={0.7}>
        <View style={[styles.groupIcon, { backgroundColor: meta.iconBg }]}>
          <Icon name={meta.icon} size={18} color={meta.iconColor} />
        </View>
        <View style={styles.groupBody}>
          <Text style={[styles.groupTitle, { color: theme.colors.text }]} numberOfLines={1}>{meta.label}</Text>
          <Text style={[styles.groupSub, { color: theme.colors.textSecondary }]} numberOfLines={1}>{meta.sub}</Text>
        </View>
        <View style={styles.groupRight}>
          <Text style={[styles.groupCount, { color: theme.colors.text }]}>{items.length}</Text>
          <Icon
            name="chevron-down"
            size={20}
            color="#9CA3AF"
            style={{ transform: [{ rotate: isOpen ? '180deg' : '0deg' }] }}
          />
        </View>
      </TouchableOpacity>

      <View style={styles.groupBulkRow}>
        <TouchableOpacity
          onPress={onBulk}
          style={[
            styles.groupBulkBtn,
            meta.bulkVariant === 'primary' && { backgroundColor: '#EEFCE0', borderColor: BRAND_PRIMARY },
            meta.bulkVariant === 'amber' && { backgroundColor: '#FFFBEB', borderColor: '#FDE68A' },
            meta.bulkVariant === 'ghost' && { backgroundColor: '#F9FAFB', borderColor: '#E5E7EB' },
          ]}
          activeOpacity={0.85}
        >
          <Icon
            name="check"
            size={14}
            color={
              meta.bulkVariant === 'primary'
                ? '#4A7C00'
                : meta.bulkVariant === 'amber'
                  ? '#92400E'
                  : theme.colors.textSecondary
            }
          />
          <Text
            style={[
              styles.groupBulkText,
              { color: theme.colors.textSecondary },
              meta.bulkVariant === 'primary' && { color: '#4A7C00' },
              meta.bulkVariant === 'amber' && { color: '#92400E' },
            ]}
          >
            {meta.bulkLabel}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={onReview}
          style={[styles.groupBulkBtn, { backgroundColor: '#F9FAFB', borderColor: '#E5E7EB' }]}
          activeOpacity={0.85}
        >
          <Icon name="arrow-right" size={14} color={theme.colors.textSecondary} />
          <Text style={[styles.groupBulkText, { color: theme.colors.textSecondary }]}>Review</Text>
        </TouchableOpacity>
      </View>

      {isOpen && (
        <View style={styles.groupRows}>
          {previewItems.map((item, i) => (
            <TouchableOpacity
              key={item.platformProduct.id}
              style={styles.gRow}
              onPress={() => onItemPress(i)}
              activeOpacity={0.7}
            >
              <View style={styles.gRowIcon}>
                {item.platformProduct.imageUrl ? (
                  <Image source={{ uri: item.platformProduct.imageUrl }} style={styles.gRowImage} />
                ) : (
                  <Icon name="package-variant" size={16} color="#9CA3AF" />
                )}
              </View>
              <View style={styles.gRowInfo}>
                <Text style={[styles.gRowName, { color: theme.colors.text }]} numberOfLines={1}>
                  {item.platformProduct.title || 'Untitled'}
                </Text>
                <Text style={[styles.gRowSub, { color: theme.colors.textSecondary }]} numberOfLines={1}>
                  {item.platformProduct.sku ? `SKU ${item.platformProduct.sku}` : ''}
                  {item.platformProduct.price
                    ? `${item.platformProduct.sku ? ' · ' : ''}$${item.platformProduct.price.toFixed(2)}`
                    : ''}
                </Text>
              </View>
              <View style={[styles.gRowBadge, { backgroundColor: meta.badgeBg }]}>
                <Text style={[styles.gRowBadgeText, { color: meta.badgeColor }]}>{meta.badgeText}</Text>
              </View>
              <Icon name="chevron-right" size={16} color="#D1D5DB" />
            </TouchableOpacity>
          ))}
          {items.length > previewItems.length && (
            <View style={styles.gRowMore}>
              <Text style={[styles.gRowMoreText, { color: theme.colors.textSecondary }]}>
                +{items.length - previewItems.length} more items
              </Text>
            </View>
          )}
        </View>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Simple row (matched / skipped)
// ---------------------------------------------------------------------------

function SimpleRow({
  theme,
  imageUrl,
  title,
  subtitle,
  right,
}: {
  theme: any;
  imageUrl: string | null | undefined;
  title: string;
  subtitle: string;
  right: React.ReactNode;
}) {
  return (
    <View style={styles.matchedRow}>
      <View style={styles.gRowIcon}>
        {imageUrl ? (
          <Image source={{ uri: imageUrl }} style={styles.gRowImage} />
        ) : (
          <Icon name="package-variant" size={16} color="#9CA3AF" />
        )}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.matchedName, { color: theme.colors.text }]} numberOfLines={1}>{title}</Text>
        <Text style={[styles.matchedSub, { color: theme.colors.textSecondary }]} numberOfLines={1}>{subtitle}</Text>
      </View>
      {right}
    </View>
  );
}


// ---------------------------------------------------------------------------
// Search Sheet
// ---------------------------------------------------------------------------

interface SearchResult {
  id: string;
  title: string;
  sku: string | null;
  price: number | null;
  imageUrl: string | null;
}

function SearchSheet({
  theme,
  visible,
  onClose,
  query,
  onQueryChange,
  results,
  loading,
  onSelect,
}: {
  theme: any;
  visible: boolean;
  onClose: () => void;
  query: string;
  onQueryChange: (q: string) => void;
  results: SearchResult[];
  loading: boolean;
  onSelect: (r: SearchResult) => void;
}) {
  const [selected, setSelected] = useState<SearchResult | null>(null);

  useEffect(() => {
    if (!visible) setSelected(null);
  }, [visible]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.bsOverlay} onPress={onClose}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{ width: '100%' }}
        >
          <Pressable style={[styles.bs, { maxHeight: '85%' }]} onPress={(e) => e.stopPropagation()}>
            <View style={styles.bsHandle} />
            <View style={styles.bsHeader}>
              <Text style={[styles.bsTitle, { color: theme.colors.text }]}>Search your inventory</Text>
              <View style={styles.bsSearchWrap}>
                <Icon name="magnify" size={18} color="#9CA3AF" />
                <TextInput
                  value={query}
                  onChangeText={onQueryChange}
                  placeholder="Search products in Anorha..."
                  placeholderTextColor="#9CA3AF"
                  style={[styles.bsInput, { color: theme.colors.text }]}
                  autoFocus
                  autoCorrect={false}
                  returnKeyType="search"
                />
              </View>
            </View>
            <ScrollView style={styles.bsResults} keyboardShouldPersistTaps="handled">
              {loading ? (
                <View style={{ padding: 24, alignItems: 'center' }}>
                  <ActivityIndicator color={theme.colors.primary} />
                </View>
              ) : results.length === 0 ? (
                <Text style={[styles.bsEmpty, { color: theme.colors.textSecondary }]}>
                  {query ? 'No results' : 'Start typing to search'}
                </Text>
              ) : (
                results.map((r) => {
                  const isSel = selected?.id === r.id;
                  return (
                    <TouchableOpacity
                      key={r.id}
                      onPress={() => setSelected(r)}
                      style={[styles.bsRow, isSel && { backgroundColor: '#EEFCE0' }]}
                    >
                      <View style={[styles.bsRowIcon, isSel && { backgroundColor: '#DCFCE7' }]}>
                        {r.imageUrl ? (
                          <Image source={{ uri: r.imageUrl }} style={styles.bsRowImage} />
                        ) : (
                          <Icon name="package-variant" size={15} color={isSel ? '#15803D' : '#9CA3AF'} />
                        )}
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text
                          style={[
                            styles.bsRowName,
                            { color: isSel ? '#15803D' : theme.colors.text, fontWeight: isSel ? '700' : '500' },
                          ]}
                          numberOfLines={1}
                        >
                          {r.title}
                        </Text>
                        {(r.sku || r.price != null) && (
                          <Text style={[styles.bsRowSub, { color: theme.colors.textSecondary }]} numberOfLines={1}>
                            {r.sku ? `SKU ${r.sku}` : ''}
                            {r.price != null ? `${r.sku ? ' · ' : ''}$${r.price.toFixed(2)}` : ''}
                          </Text>
                        )}
                      </View>
                      {isSel && (
                        <View style={[styles.bsCheck, { backgroundColor: theme.colors.primary }]}>
                          <Icon name="check" size={12} color="#FFFFFF" />
                        </View>
                      )}
                    </TouchableOpacity>
                  );
                })
              )}
            </ScrollView>
            <View style={styles.bsFooter}>
              <TouchableOpacity
                onPress={() => selected && onSelect(selected)}
                disabled={!selected}
                style={[
                  styles.bsBtn,
                  { backgroundColor: selected ? theme.colors.primary : '#EEFCE0' },
                ]}
              >
                <Icon name="check" size={16} color={selected ? '#FFFFFF' : '#86EFAC'} />
                <Text style={[styles.bsBtnText, !selected && { color: '#86EFAC' }]}>
                  {selected
                    ? `Link to ${selected.title.slice(0, 26)}${selected.title.length > 26 ? '…' : ''}`
                    : 'Select a product'}
                </Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </KeyboardAvoidingView>
      </Pressable>
    </Modal>
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
        <Icon name="sprout-outline" size={32} color="#15803D" />
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
  progRow: {
    paddingHorizontal: tokens.spacing.lg,
    paddingTop: 10,
    paddingBottom: 4,
    backgroundColor: '#FFFFFF',
  },
  progMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  progLabel: {
    fontSize: 12,
    fontWeight: '500',
  },
  progPct: {
    fontSize: 12,
    fontWeight: '700',
  },

  // Content
  contentPadding: {
    paddingHorizontal: tokens.spacing.lg,
    paddingTop: tokens.spacing.md,
    paddingBottom: 140,
  },

  // Group card
  groupCardOuter: {
    marginBottom: 12,
    padding: 0,
  },
  groupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 12,
  },
  groupIcon: {
    width: 38,
    height: 38,
    borderRadius: 11,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  groupBody: {
    flex: 1,
    minWidth: 0,
  },
  groupTitle: {
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 2,
  },
  groupSub: {
    fontSize: 12,
  },
  groupRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  groupCount: {
    fontSize: 16,
    fontWeight: '700',
    marginRight: 6,
  },
  groupBulkRow: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingBottom: 12,
  },
  groupBulkBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 9,
    borderRadius: 10,
    borderWidth: 1,
    marginHorizontal: 3,
  },
  groupBulkText: {
    fontSize: 12,
    fontWeight: '600',
    marginLeft: 6,
  },
  groupRows: {
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
  },
  gRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  gRowIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: '#F3F4F6',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
    overflow: 'hidden',
  },
  gRowImage: {
    width: '100%',
    height: '100%',
  },
  gRowInfo: {
    flex: 1,
    minWidth: 0,
  },
  gRowName: {
    fontSize: 13,
    fontWeight: '600',
  },
  gRowSub: {
    fontSize: 11,
    marginTop: 1,
  },
  gRowBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    marginRight: 6,
  },
  gRowBadgeText: {
    fontSize: 10,
    fontWeight: '700',
  },
  gRowMore: {
    paddingVertical: 10,
    alignItems: 'center',
  },
  gRowMoreText: {
    fontSize: 12,
  },

  // Empty state
  emptyState: {
    alignItems: 'center',
    paddingVertical: 60,
    paddingHorizontal: 20,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginTop: 12,
  },
  emptySub: {
    fontSize: 13,
    marginTop: 4,
    textAlign: 'center',
  },

  // Matched / skipped row
  matchedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E7EB',
  },
  matchedName: {
    fontSize: 14,
    fontWeight: '600',
  },
  matchedSub: {
    fontSize: 12,
    marginTop: 2,
  },
  undoText: {
    fontSize: 13,
    fontWeight: '600',
  },

  // Sticky bottom
  sticky: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: tokens.spacing.lg,
    paddingTop: 28,
  },
  stickyRow: {
    flexDirection: 'row',
  },
  stickySecondaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
    height: 50,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    marginRight: 8,
  },
  stickySecondaryText: {
    fontSize: 13,
    fontWeight: '600',
    marginLeft: 6,
  },
  stickyPrimaryBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 50,
    borderRadius: 12,
  },
  stickyPrimaryText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
    marginLeft: 6,
  },

  // -------- REVIEW VIEW --------
  reviewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: tokens.spacing.lg,
    paddingBottom: 8,
  },
  reviewHeaderTitle: {
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  reviewHeaderSub: {
    fontSize: 12,
    marginTop: 2,
  },
  filmstrip: {
    paddingHorizontal: tokens.spacing.lg,
    paddingVertical: 10,
  },
  fsItem: {
    width: 44,
    height: 44,
    borderRadius: 11,
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#E5E7EB',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 6,
    overflow: 'hidden',
  },
  fsItemActive: {
    borderWidth: 2,
  },
  fsItemResolved: {
    backgroundColor: '#F0FDF4',
    borderColor: '#BBF7D0',
  },
  fsImage: {
    width: '100%',
    height: '100%',
  },
  fsNum: {
    position: 'absolute',
    bottom: 1,
    right: 3,
    fontSize: 8,
    fontWeight: '700',
    color: '#9CA3AF',
  },
  reviewBody: {
    paddingHorizontal: tokens.spacing.lg,
    paddingTop: 4,
    paddingBottom: 140,
  },

  // Comparison card (vertical)
  cmpCard: {
    padding: 0,
    marginBottom: 0,
  },
  cmpBlock: {
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  cmpRow: {
    flexDirection: 'row',
  },
  cmpLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 8,
  },
  cmpThumb: {
    width: 52,
    height: 52,
    borderRadius: 10,
    backgroundColor: '#F3F4F6',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
    overflow: 'hidden',
  },
  cmpThumbImg: {
    width: '100%',
    height: '100%',
  },
  cmpName: {
    fontSize: 15,
    fontWeight: '700',
    lineHeight: 19,
    marginBottom: 4,
  },
  cmpSub: {
    fontSize: 12,
    lineHeight: 16,
  },
  cmpTag: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F3F4F6',
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 3,
    alignSelf: 'flex-start',
    marginTop: 6,
  },
  cmpTagText: {
    fontSize: 10,
    fontWeight: '600',
    marginLeft: 4,
  },

  cmpDivider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
  },
  cmpDividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#E5E7EB',
  },
  cmpDividerIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    justifyContent: 'center',
    alignItems: 'center',
    marginHorizontal: 6,
  },

  cmpMatch: {
    backgroundColor: '#F0FDF4',
  },
  cmpMatchHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  cmpConfPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#DCFCE7',
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  cmpConfText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#15803D',
    marginLeft: 4,
  },
  cmpChange: {
    fontSize: 12,
    fontWeight: '600',
  },

  cmpEmpty: {
    backgroundColor: '#FAFAFA',
    minHeight: 120,
  },
  cmpEmptyContent: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
  },
  cmpEmptyIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#F3F4F6',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 10,
  },
  cmpEmptyTitle: {
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 4,
  },
  cmpEmptySub: {
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 16,
  },

  cmpStale: {
    backgroundColor: '#FAF5FF',
  },

  // Quick row
  quickRow: {
    flexDirection: 'row',
    marginTop: 14,
    marginBottom: 16,
  },
  quickBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 11,
    borderRadius: 12,
    borderWidth: 1,
    marginHorizontal: 4,
  },
  quickBtnGhost: {
    backgroundColor: '#F9FAFB',
    borderColor: '#E5E7EB',
  },
  quickBtnText: {
    fontSize: 13,
    fontWeight: '700',
    marginLeft: 6,
  },

  // Variant section
  variantSection: {
    marginTop: 8,
  },
  variantSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    marginLeft: 4,
  },
  variantSectionTitle: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginLeft: 6,
  },
  variantRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 6,
  },
  variantLeft: {
    fontSize: 13,
    fontWeight: '600',
  },
  variantSub: {
    fontSize: 11,
    marginTop: 2,
  },
  variantMatch: {
    fontSize: 13,
    fontWeight: '700',
  },
  variantNoMatch: {
    fontSize: 12,
    fontWeight: '600',
  },
  variantAction: {
    fontSize: 11,
    fontWeight: '700',
    marginTop: 2,
  },

  // Action bar
  actionBar: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  abIconBtn: {
    width: 50,
    height: 50,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
  },
  abSkip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 50,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    marginRight: 8,
  },
  abSkipText: {
    fontSize: 14,
    fontWeight: '600',
    marginLeft: 6,
  },
  abDone: {
    flex: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 50,
    borderRadius: 12,
  },
  abDoneText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
    marginLeft: 6,
  },

  // -------- BOTTOM SHEET (search / more) --------
  bsOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'flex-end',
  },
  bs: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingBottom: 24,
  },
  bsHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#E5E7EB',
    alignSelf: 'center',
    marginTop: 10,
  },
  bsHeader: {
    paddingHorizontal: 18,
    paddingTop: 14,
  },
  bsTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 12,
    letterSpacing: -0.2,
  },
  bsSearchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F9FAFB',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  bsInput: {
    flex: 1,
    fontSize: 15,
    marginLeft: 8,
    padding: 0,
  },
  bsResults: {
    maxHeight: 320,
  },
  bsEmpty: {
    padding: 24,
    textAlign: 'center',
    fontSize: 13,
  },
  bsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingVertical: 11,
  },
  bsRowIcon: {
    width: 34,
    height: 34,
    borderRadius: 9,
    backgroundColor: '#F3F4F6',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
    overflow: 'hidden',
  },
  bsRowImage: {
    width: '100%',
    height: '100%',
  },
  bsRowName: {
    fontSize: 14,
  },
  bsRowSub: {
    fontSize: 11,
    marginTop: 2,
  },
  bsCheck: {
    width: 20,
    height: 20,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  bsFooter: {
    paddingHorizontal: 18,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
  },
  bsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 48,
    borderRadius: 12,
  },
  bsBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
    marginLeft: 6,
  },

  // Option row
  optRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  optIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  optLabel: {
    fontSize: 14,
    fontWeight: '600',
  },
  optSub: {
    fontSize: 12,
    marginTop: 2,
  },

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
  scanSub: {
    fontSize: 13,
    marginTop: 6,
    textAlign: 'center',
  },
  scanPct: {
    fontSize: 12,
    marginTop: 6,
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
});

export default MappingReviewScreen;
