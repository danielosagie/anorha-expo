import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
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
import { tokens, BRAND_PRIMARY} from '../design/tokens';
import DecisionQueue from '../components/import/DecisionQueue';

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
    importDraft,
    draftLog,
    recordDecision,
    reopenDecision,
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

  const [searchSheet, setSearchSheet] = useState<{ visible: boolean; targetId: string | null }>({
    visible: false,
    targetId: null,
  });
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [doneVisible, setDoneVisible] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);

  // Everything the lobby shows is derived from the server-built draft + the
  // local decision log. No reason taxonomy, no client annotation.
  const planTotal = importDraft?.units.length ?? 0;
  const autoMatched = importDraft?.summary.autoResolved ?? 0;
  const answered = draftLog.filter((d) => d.kind === 'answer').length;
  const remaining = Math.max(0, planTotal - answered);
  const answeredSkips = draftLog.filter((d) => d.kind === 'answer' && d.answer === 'skip').length;
  const broughtInCount = autoMatched + Math.max(0, answered - answeredSkips);

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
      (suggestions || []).forEach((s) => {
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
  }, [searchQuery, searchSheet.visible, suggestions]);

  // ---------------------------------------------------------------------------
  // Action helpers
  // ---------------------------------------------------------------------------
  const updateOne = useCallback((id: string, patch: (s: MappingSuggestion) => MappingSuggestion) => {
    setSuggestions((prev) => (prev || []).map((s) => (s.platformProduct.id === id ? patch(s) : s)));
  }, [setSuggestions]);

  const openSearchFor = useCallback((item: { platformProduct: { id: string } }) => {
    setSearchSheet({ visible: true, targetId: item.platformProduct.id });
    setSearchQuery('');
  }, []);

  // ── Server-driven decision queue (GROUP → SAME → KEEP) ───────────────────────
  // Every interaction posts to the backend; the queue renders the draft it
  // returns. No local derivation, no client-side "alternates".
  const openQueue = useCallback(() => setQueueOpen(true), []);

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
  // Render: full-screen decision queue (GROUP → SAME → KEEP) — server-driven
  // ---------------------------------------------------------------------------
  if (queueOpen && importDraft) {
    return (
      <DecisionQueue
        theme={theme}
        insets={insets}
        draft={importDraft}
        log={draftLog}
        onRecord={recordDecision}
        onReopen={reopenDecision}
        onSearch={openSearchFor}
        onClose={() => { setSearchSheet({ visible: false, targetId: null }); setQueueOpen(false); }}
        onCommit={() => { setSearchSheet({ visible: false, targetId: null }); setQueueOpen(false); setDoneVisible(true); }}
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
  // Render: main view — a thin lobby over the server's draft
  // ---------------------------------------------------------------------------
  return (
    <View style={[styles.screen, { backgroundColor: theme.colors.background, paddingTop: insets.top + 8 }]}>
      <Header
        title="Match products"
        count={remaining}
        onClose={() => navigation.goBack()}
        theme={theme}
      />

      <ScrollView contentContainerStyle={styles.contentPadding} showsVerticalScrollIndicator={false}>
        {/* Overview — everything comes from the server-built draft */}
        <View style={styles.overviewCard}>
          <Icon name={remaining === 0 ? 'check-decagram' : 'view-grid-outline'} size={30} color={theme.colors.primary} />
          <Text style={[styles.overviewBig, { color: theme.colors.text }]}>
            {remaining === 0 ? 'All set' : `${remaining} to review`}
          </Text>
          <Text style={[styles.overviewSub, { color: theme.colors.textSecondary }]}>
            {autoMatched > 0
              ? `${autoMatched} matched automatically${remaining === 0 ? '' : ` · ${answered} of ${planTotal} decided`}`
              : remaining === 0 ? 'Ready to import' : `${answered} of ${planTotal} decided`}
          </Text>
          {planTotal > 0 && (
            <View style={{ width: '100%', marginTop: 14 }}>
              <Progress.Bar
                progress={planTotal ? answered / planTotal : 0}
                width={null}
                height={5}
                borderRadius={3}
                color={theme.colors.primary}
                unfilledColor="#E5E7EB"
                borderWidth={0}
              />
            </View>
          )}
        </View>

        {/* What the backend handled for you */}
        {importDraft && importDraft.autoResolved.length > 0 && (
          <View style={styles.autoSection}>
            <Text style={[styles.sectionTitle, { color: theme.colors.textSecondary }]}>Matched automatically</Text>
            {importDraft.autoResolved.slice(0, 60).map((a) => (
              <SimpleRow
                key={a.id}
                theme={theme}
                imageUrl={a.imageUrl}
                title={a.title}
                subtitle={`→ ${a.matchedTo?.title || a.reason}`}
                right={<Icon name="check-circle" size={18} color={theme.colors.primary} />}
              />
            ))}
          </View>
        )}

        {!importDraft && (
          <View style={styles.emptyState}>
            <Icon name="cloud-search-outline" size={32} color="#D1D5DB" />
            <Text style={[styles.emptyTitle, { color: theme.colors.text }]}>Preparing your import…</Text>
          </View>
        )}
      </ScrollView>

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
          {remaining > 0 ? (
            <TouchableOpacity
              onPress={openQueue}
              style={[styles.stickyPrimaryBtn, { backgroundColor: theme.colors.primary }]}
              activeOpacity={0.85}
            >
              <Icon name="play-circle-outline" size={18} color="#FFFFFF" />
              <Text style={styles.stickyPrimaryText}>Review {remaining} item{remaining === 1 ? '' : 's'}</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              onPress={() => setDoneVisible(true)}
              style={[styles.stickyPrimaryBtn, { backgroundColor: theme.colors.primary }]}
              activeOpacity={0.85}
            >
              <Icon name="check" size={17} color="#FFFFFF" />
              <Text style={styles.stickyPrimaryText}>Complete import</Text>
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
          linkedCount={broughtInCount}
          skippedCount={answeredSkips}
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
  autoMatched: {
    fontSize: 12,
    fontWeight: '500',
    marginTop: 6,
  },

  // Content
  contentPadding: {
    paddingHorizontal: tokens.spacing.lg,
    paddingTop: tokens.spacing.md,
    paddingBottom: 140,
  },
  overviewCard: {
    alignItems: 'center',
    paddingVertical: 28,
    paddingHorizontal: 20,
    borderRadius: 20,
    backgroundColor: '#F9FAFB',
    marginBottom: 18,
  },
  overviewBig: {
    fontSize: 24,
    marginTop: 12,
    fontFamily: 'PlusJakartaSans_700Bold',
    letterSpacing: -0.3,
  },
  overviewSub: {
    fontSize: 14,
    marginTop: 4,
    textAlign: 'center',
    fontFamily: 'PlusJakartaSans_500Medium',
  },
  autoSection: {
    marginTop: 4,
  },
  sectionTitle: {
    fontSize: 12,
    letterSpacing: 0.5,
    marginBottom: 8,
    fontFamily: 'PlusJakartaSans_700Bold',
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
