import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  Platform,
  RefreshControl,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useAuth, useUser } from '@clerk/clerk-expo';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { LineChart } from 'react-native-chart-kit';
import * as Haptics from 'expo-haptics';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { HybridConversationDataAdapter } from '../features/liquidationConversation/HybridConversationDataAdapter';
import { useLiquidationConversationController } from '../features/liquidationConversation/useLiquidationConversationController';
import type { CampaignSummary } from '../features/liquidationConversation/types';
import { NewClearoutSheet, NewClearoutInput } from '../components/liquidation/NewClearoutSheet';

const CONVEX_TEMPLATE =
  process.env.EXPO_PUBLIC_CLERK_CONVEX_JWT_TEMPLATE ||
  process.env.EXPO_PUBLIC_CLERK_JWT_TEMPLATE ||
  'mobile';

const BRAND = '#93C822';

const FONT = {
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
};

const RANGES = ['1D', '1W', '1M', '3M', '6M', '1Y', 'All'] as const;
type Range = (typeof RANGES)[number];

const FILTERS = ['All', 'Running', 'Completed'] as const;
type Filter = (typeof FILTERS)[number];


const greetingForHour = (hour: number): string => {
  if (hour >= 22 || hour < 5) return 'Late night';
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
};

const currency = (value: number): string => {
  const rounded = Math.round(value * 100) / 100;
  return `$${rounded.toLocaleString(undefined, { minimumFractionDigits: rounded % 1 === 0 ? 0 : 2, maximumFractionDigits: 2 })}`;
};

type BriefingChip = 'SOLD' | 'OFFER' | 'REPRICE' | 'ASK' | 'LISTED';
type BriefingRowData = { id: string; label: string; chip: BriefingChip };

const CHIP_STYLE: Record<BriefingChip, { bg: string; fg: string; text: string }> = {
  SOLD: { bg: '#EAF7CF', fg: '#4E6B12', text: 'SOLD' },
  OFFER: { bg: '#FBEAD2', fg: '#A2611A', text: 'OFFER' },
  REPRICE: { bg: '#E7E7EA', fg: '#3F3F46', text: 'REPRICE' },
  ASK: { bg: '#DCEBFB', fg: '#1F5FA8', text: 'NEEDS YOU' },
  LISTED: { bg: '#E6F0FB', fg: '#2563A8', text: 'LISTED' },
};

// ── Adaptive home theme: green by day, dark by night ──────────────────────
type Palette = {
  bgFrom: string; bgTo: string;
  strong: string; dim: string; faint: string;
  pillBg: string; newBg: string;
  chart: string; divider: string;
  chipIdleBg: string; chipIdleText: string; chipActiveBg: string; chipActiveText: string;
  blur: 'light' | 'dark';
};

const DAY_THEME: Palette = {
  bgFrom: '#9AC53C', bgTo: '#6F9C26',
  strong: '#FFFFFF', dim: 'rgba(255,255,255,0.6)', faint: 'rgba(255,255,255,0.78)',
  pillBg: 'rgba(255,255,255,0.18)', newBg: 'rgba(20,30,8,0.30)',
  chart: 'rgba(255,255,255,0.95)', divider: 'rgba(255,255,255,0.34)',
  chipIdleBg: 'rgba(255,255,255,0.14)', chipIdleText: 'rgba(255,255,255,0.78)',
  chipActiveBg: '#FFFFFF', chipActiveText: '#43631A', blur: 'light',
};

const NIGHT_THEME: Palette = {
  bgFrom: '#272B20', bgTo: '#14160F',
  strong: '#F4F4EE', dim: 'rgba(244,244,238,0.5)', faint: 'rgba(244,244,238,0.72)',
  pillBg: 'rgba(255,255,255,0.10)', newBg: 'rgba(255,255,255,0.14)',
  chart: 'rgba(255,255,255,0.92)', divider: 'rgba(255,255,255,0.16)',
  chipIdleBg: 'rgba(255,255,255,0.08)', chipIdleText: 'rgba(244,244,238,0.6)',
  chipActiveBg: '#F4F4EE', chipActiveText: '#1F2218', blur: 'dark',
};

// Connector/structure words rendered dim, so the facts pop (iMessage-summary look)
const DIM_TOKENS = new Set([
  'on','the','for','a','an','to','of','in','at','and','&','that','came','is','with','your',
  'from','by','were','was','are','then','as','its','it',
]);

type Seg = { text: string; strong: boolean };

const briefingToSegments = (rows: BriefingRowData[]): Seg[] => {
  const out: Seg[] = [];
  rows.forEach((row, i) => {
    if (i > 0) out.push({ text: i === rows.length - 1 ? ', and ' : ', ', strong: false });
    row.label.split(/(\s+)/).forEach(tok => {
      if (/^\s*$/.test(tok)) { out.push({ text: tok, strong: false }); return; }
      const clean = tok.replace(/[^A-Za-z&']/g, '').toLowerCase();
      out.push({ text: tok, strong: !DIM_TOKENS.has(clean) });
    });
  });
  if (out.length) out.push({ text: '.', strong: false });
  return out;
};

const SproutHomeScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const { getToken } = useAuth();
  const { user } = useUser();

  const firstName = user?.firstName || user?.username || 'there';
  const greeting = useMemo(() => greetingForHour(new Date().getHours()), []);

  const getTokenRef = useRef(getToken);
  useEffect(() => {
    getTokenRef.current = getToken;
  }, [getToken]);

  const adapter = useMemo(
    () =>
      new HybridConversationDataAdapter({
        getClerkToken: () =>
          getTokenRef.current({ template: CONVEX_TEMPLATE }).catch(async () => getTokenRef.current()),
      }),
    [],
  );

  const controller = useLiquidationConversationController({ adapter });

  const [activeRange, setActiveRange] = useState<Range>('1W');
  const [activeFilter, setActiveFilter] = useState<Filter>('All');

  // Create-campaign modal state
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const tap = useCallback((style: Haptics.ImpactFeedbackStyle = Haptics.ImpactFeedbackStyle.Light) => {
    Haptics.impactAsync(style).catch(() => undefined);
  }, []);

  // ── Aggregate stats from the campaign list (loaded with the list, no extra fetch)
  const { itemsLeft, totalItems, soldTotal } = useMemo(() => {
    let left = 0;
    let total = 0;
    let sold = 0;
    for (const c of controller.campaigns) {
      const t = c.stats?.totalCount || 0;
      const s = c.stats?.soldCount || 0;
      total += t;
      sold += s;
      left += Math.max(0, t - s);
    }
    return { itemsLeft: left, totalItems: total, soldTotal: sold };
  }, [controller.campaigns]);

  // Revenue figures come from the active campaign's 24h overview (real)
  const revenue24h = controller.campaignOverview?.summary24h?.revenue || 0;
  const soldToday = controller.campaignOverview?.summary24h?.sold || 0;

  // ── "While you slept" briefing rows, derived from the active campaign overview
  const briefingRows = useMemo<BriefingRowData[]>(() => {
    const o = controller.campaignOverview;
    if (!o) return [];
    const rows: BriefingRowData[] = [];
    const s = o.summary24h;
    if (s.sold > 0) rows.push({ id: 'sold', label: `${s.sold} ${s.sold === 1 ? 'Item' : 'Items'} Sold`, chip: 'SOLD' });
    if (s.negotiating > 0) rows.push({ id: 'neg', label: `${s.negotiating} ${s.negotiating === 1 ? 'Offer' : 'Offers'} In`, chip: 'OFFER' });
    if (s.repriced > 0) rows.push({ id: 'rep', label: `${s.repriced} Repriced`, chip: 'REPRICE' });
    if (s.listed > 0) rows.push({ id: 'list', label: `${s.listed} ${s.listed === 1 ? 'Listing' : 'Listings'} Live`, chip: 'LISTED' });
    for (const item of o.needsInput.slice(0, 2)) {
      rows.push({ id: `ask-${item.id}`, label: item.title, chip: 'ASK' });
    }
    return rows.slice(0, 4);
  }, [controller.campaignOverview]);

  // ── Chart series: cumulative revenue from recent actions where available,
  //    otherwise a calm decorative baseline (no axis numbers are shown).
  const chartSeries = useMemo<number[]>(() => {
    const pointCount = activeRange === '1D' ? 8 : activeRange === '1W' ? 12 : 16;
    const actions = (controller.campaignOverview?.recentActions || []).filter(
      a => Number(a.revenueImpact || 0) !== 0,
    );
    if (actions.length >= 2) {
      const sorted = [...actions].sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      );
      let cum = 0;
      const pts = sorted.map(a => (cum += Number(a.revenueImpact || 0)));
      // resample to a fixed number of points
      const out: number[] = [];
      for (let i = 0; i < pointCount; i++) {
        const idx = Math.min(pts.length - 1, Math.floor((i / (pointCount - 1)) * (pts.length - 1)));
        out.push(pts[idx]);
      }
      return out;
    }
    // Decorative, deterministic baseline so the hero reads as "alive" but flat.
    return Array.from({ length: pointCount }, (_, i) => 40 + Math.sin(i / 1.8) * 7 + i * 1.2);
  }, [controller.campaignOverview, activeRange]);

  const filteredCampaigns = useMemo(() => {
    if (activeFilter === 'Running') {
      return controller.campaigns.filter(c => c.status === 'active' || c.status === 'waiting_user');
    }
    if (activeFilter === 'Completed') {
      return controller.campaigns.filter(c => c.status === 'completed');
    }
    return controller.campaigns;
  }, [controller.campaigns, activeFilter]);

  const openCampaign = useCallback(
    (c: CampaignSummary) => {
      tap();
      navigation.navigate('CampaignThreadScreen', { campaignId: c.id, title: c.title });
    },
    [navigation, tap],
  );

  const openCreate = useCallback(() => {
    tap(Haptics.ImpactFeedbackStyle.Medium);
    setCreateOpen(true);
  }, [tap]);

  const handleCreate = useCallback(async (input: NewClearoutInput) => {
    setCreating(true);
    try {
      const campaign = await adapter.createCampaign({
        title: input.title,
        targetRevenue: input.targetRevenue,
        timeframeDays: input.timeframeDays,
        aggressiveness: input.aggressiveness,
        inventoryScope: 'all',
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
      setCreateOpen(false);
      await controller.onRefresh();
      navigation.navigate('CampaignThreadScreen', { campaignId: campaign.id, title: campaign.title });
    } catch (e: any) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => undefined);
      Alert.alert('Could not start clearout', String(e?.message || e));
    } finally {
      setCreating(false);
    }
  }, [adapter, controller, navigation]);

  const chartWidth = Dimensions.get('window').width;
  const isNight = useMemo(() => {
    const h = new Date().getHours();
    return h >= 22 || h < 5;
  }, []);
  const THEME = isNight ? NIGHT_THEME : DAY_THEME;
  const briefingSegments = useMemo(() => briefingToSegments(briefingRows), [briefingRows]);

  return (
    <View style={[styles.screen, { backgroundColor: THEME.bgTo }]}>
      <StatusBar barStyle="light-content" />
      <LinearGradient colors={[THEME.bgFrom, THEME.bgTo]} style={StyleSheet.absoluteFill} pointerEvents="none" />
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingTop: insets.top + 56, paddingBottom: insets.bottom + 120 }}
        refreshControl={
          <RefreshControl refreshing={controller.refreshing} onRefresh={controller.onRefresh} tintColor={BRAND} />
        }
      >
        {/* ── HERO (themed: green by day, dark by night) ─────────────── */}
        <View style={styles.hero}>
          <Text style={[styles.greeting, { color: THEME.strong }]}>
            {greeting}, 📖 {firstName}
          </Text>

          {briefingRows.length > 0 ? (
            <>
              <Text style={[styles.briefingHeadline, { color: THEME.strong }]}>
                {briefingRows.length} {briefingRows.length === 1 ? 'thing' : 'things'} happened {isNight ? 'while you slept' : 'today'}  {isNight ? '🌙' : '☀️'}
              </Text>
              <Text style={styles.briefingProse}>
                {briefingSegments.map((seg, i) => (
                  <Text
                    key={i}
                    style={{
                      color: seg.strong ? THEME.strong : THEME.dim,
                      fontFamily: seg.strong ? FONT.semibold : FONT.regular,
                    }}
                  >
                    {seg.text}
                  </Text>
                ))}
              </Text>
            </>
          ) : (
            <Text style={[styles.briefingHeadline, { color: THEME.faint }]}>
              {controller.loading
                ? 'Catching you up…'
                : isNight
                  ? 'All quiet while you slept. Sprout is watching.'
                  : 'All quiet so far. Sprout is watching.'}
            </Text>
          )}

          <View style={[styles.dashedDivider, { borderColor: THEME.divider }]} />

          {/* Hero stats — sales today + revenue */}
          <View style={styles.statsRow}>
            <Text style={[styles.salesToday, { color: THEME.strong }]}>
              {soldToday} {soldToday === 1 ? 'sale' : 'sales'} today
            </Text>
            <Text style={[styles.salesDelta, { color: THEME.strong }]}>+{currency(revenue24h)}</Text>
          </View>

          {/* Sparkline */}
          <View style={styles.chartWrap} pointerEvents="none">
            <LineChart
              data={{ labels: [], datasets: [{ data: chartSeries.length >= 2 ? chartSeries : [0, 0] }] }}
              width={chartWidth}
              height={110}
              withDots={false}
              withInnerLines={false}
              withOuterLines={false}
              withVerticalLabels={false}
              withHorizontalLabels={false}
              withShadow={false}
              bezier
              chartConfig={{
                backgroundGradientFrom: THEME.bgTo,
                backgroundGradientFromOpacity: 0,
                backgroundGradientTo: THEME.bgTo,
                backgroundGradientToOpacity: 0,
                color: () => THEME.chart,
                strokeWidth: 3,
                decimalPlaces: 0,
                propsForBackgroundLines: { strokeWidth: 0 },
              }}
              style={styles.chart}
            />
            <View style={[styles.chartBaseline, { borderColor: THEME.divider }]} />
          </View>

          {/* Range chips */}
          <View style={styles.rangeRow}>
            {RANGES.map(r => {
              const active = r === activeRange;
              return (
                <TouchableOpacity
                  key={r}
                  style={[styles.rangeChip, { backgroundColor: active ? THEME.chipActiveBg : 'transparent' }]}
                  onPress={() => {
                    tap();
                    setActiveRange(r);
                  }}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.rangeChipText, { color: active ? THEME.chipActiveText : THEME.chipIdleText }]}>{r}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* ── BODY ─────────────────────────────────────────────────── */}
        <View style={styles.body}>
          <View style={styles.filterRow}>
            {FILTERS.map(f => {
              const active = f === activeFilter;
              return (
                <TouchableOpacity
                  key={f}
                  style={[styles.filterChip, { backgroundColor: active ? THEME.chipActiveBg : THEME.chipIdleBg }]}
                  onPress={() => {
                    tap();
                    setActiveFilter(f);
                  }}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.filterChipText, { color: active ? THEME.chipActiveText : THEME.chipIdleText }]}>{f}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {controller.error ? (
            <View style={styles.errorBanner}>
              <Icon name="alert-circle-outline" size={15} color="#B91C1C" />
              <Text style={styles.errorText} numberOfLines={2}>
                {controller.error}
              </Text>
              <TouchableOpacity onPress={controller.onRefresh}>
                <Text style={styles.errorRetry}>Retry</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          {controller.loading && controller.campaigns.length === 0 ? (
            <View style={styles.loadingBox}>
              <ActivityIndicator color={BRAND} />
              <Text style={styles.loadingText}>Loading your clearouts…</Text>
            </View>
          ) : filteredCampaigns.length === 0 ? (
            <View style={styles.emptyCard}>
              <View style={styles.emptyIconWrap}>
                <Icon name="sprout-outline" size={26} color={BRAND} />
              </View>
              <Text style={styles.emptyTitle}>
                {activeFilter === 'All' ? 'No clearouts yet' : `No ${activeFilter.toLowerCase()} clearouts`}
              </Text>
              <Text style={styles.emptyBody}>
                Start a clearout and Sprout will list, reprice, and negotiate to hit your goal by the deadline.
              </Text>
              <TouchableOpacity style={styles.emptyCta} onPress={openCreate} activeOpacity={0.9}>
                <Text style={styles.emptyCtaText}>Start a clearout</Text>
              </TouchableOpacity>
            </View>
          ) : (
            filteredCampaigns.map(c => <CampaignCard key={c.id} campaign={c} onPress={() => openCampaign(c)} />)
          )}
        </View>
      </ScrollView>

      {/* ── Floating top bar (pills float on the themed background) ──── */}
      <View pointerEvents="box-none" style={[styles.topBar, { height: insets.top + 54 }]}>
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          <BlurView intensity={Platform.OS === 'ios' ? 14 : 8} tint={THEME.blur} style={StyleSheet.absoluteFill} />
          <LinearGradient
            colors={[THEME.bgFrom, `${THEME.bgFrom}00`]}
            locations={[0, 1]}
            style={StyleSheet.absoluteFill}
          />
        </View>
        <View style={[styles.topBarRow, { marginTop: insets.top + 2 }]}>
          <TouchableOpacity
            style={[styles.overviewPill, { backgroundColor: THEME.pillBg }]}
            onPress={() => {
              tap();
              setMenuOpen(true);
            }}
            activeOpacity={0.85}
          >
            <Icon name="menu" size={15} color={THEME.strong} />
            <Text style={[styles.overviewText, { color: THEME.strong }]}>Summary</Text>
            <Icon name="chevron-down" size={15} color={THEME.faint} />
          </TouchableOpacity>
          <View style={styles.topBarActions}>
            <TouchableOpacity
              style={[styles.iconPill, { backgroundColor: THEME.pillBg }]}
              onPress={() => tap()}
              activeOpacity={0.85}
            >
              <Icon name="calendar-blank-outline" size={17} color={THEME.strong} />
            </TouchableOpacity>
            <TouchableOpacity style={[styles.newBtn, { backgroundColor: THEME.newBg }]} onPress={openCreate} activeOpacity={0.85}>
              <Icon name="plus" size={15} color="#FFFFFF" />
              <Text style={styles.newBtnText}>New</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>

      {/* ── Overview quick-actions menu ──────────────────────────── */}
      {menuOpen ? (
        <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
          <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setMenuOpen(false)} />
          <View style={[styles.overviewMenu, { top: insets.top + 50 }]}>
            <TouchableOpacity style={styles.menuItem} onPress={() => { setMenuOpen(false); openCreate(); }} activeOpacity={0.7}>
              <Icon name="plus-circle-outline" size={18} color="#3F3F46" />
              <Text style={styles.menuItemText}>New clearout</Text>
            </TouchableOpacity>
            <View style={styles.menuDivider} />
            <TouchableOpacity style={styles.menuItem} onPress={() => { setMenuOpen(false); controller.onRefresh(); }} activeOpacity={0.7}>
              <Icon name="refresh" size={18} color="#3F3F46" />
              <Text style={styles.menuItemText}>Refresh</Text>
            </TouchableOpacity>
            <View style={styles.menuDivider} />
            <TouchableOpacity style={styles.menuItem} onPress={() => { setMenuOpen(false); navigation.navigate('Inventory'); }} activeOpacity={0.7}>
              <Icon name="package-variant-closed" size={18} color="#3F3F46" />
              <Text style={styles.menuItemText}>Go to inventory</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}

      <NewClearoutSheet
        visible={createOpen}
        creating={creating}
        onClose={() => setCreateOpen(false)}
        onSubmit={handleCreate}
      />
    </View>
  );
};

// ── Campaign card ────────────────────────────────────────────────────────
const CampaignCard: React.FC<{ campaign: CampaignSummary; onPress: () => void }> = ({ campaign, onPress }) => {
  const sold = campaign.stats?.soldCount || 0;
  const total = campaign.stats?.totalCount || 0;
  const negotiating = campaign.stats?.negotiating || 0;
  const progress = total > 0 ? Math.min(1, sold / total) : 0;
  const percent = Math.round(progress * 100);

  const daysLeft = useMemo(() => {
    if (!campaign.timeframeDays) return null;
    const created = new Date(campaign.createdAt).getTime();
    if (Number.isNaN(created)) return null;
    const elapsed = (Date.now() - created) / (24 * 60 * 60 * 1000);
    return Math.max(0, Math.ceil(campaign.timeframeDays - elapsed));
  }, [campaign.createdAt, campaign.timeframeDays]);

  const statusPill =
    campaign.status === 'completed'
      ? { text: 'Completed', bg: '#E7E7EA', fg: '#52525B' }
      : campaign.status === 'paused'
        ? { text: 'Paused', bg: '#FBEAD2', fg: '#A2611A' }
        : campaign.status === 'waiting_user'
          ? { text: 'Needs you', bg: '#DCEBFB', fg: '#1F5FA8' }
          : { text: 'Running', bg: '#EAF7CF', fg: '#4E6B12' };

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.92}>
      <View style={styles.cardHeader}>
        <View style={styles.cardThumb}>
          <Icon name="leaf" size={20} color={BRAND} />
        </View>
        <View style={styles.cardHeaderText}>
          <Text style={styles.cardTitle} numberOfLines={1}>
            {campaign.title}
          </Text>
          <View style={styles.cardMetaRow}>
            {daysLeft !== null ? (
              <View style={styles.daysBadge}>
                <Text style={styles.daysBadgeText}>{daysLeft}d Left</Text>
              </View>
            ) : null}
            <Text style={styles.cardSubMeta}>
              {sold}/{total} sold
            </Text>
          </View>
        </View>
        {negotiating > 0 ? (
          <View style={styles.pendingBadge}>
            <Text style={styles.pendingBadgeCount}>{negotiating}</Text>
            <Text style={styles.pendingBadgeText}>Pending</Text>
          </View>
        ) : (
          <View style={[styles.statusPill, { backgroundColor: statusPill.bg }]}>
            <Text style={[styles.statusPillText, { color: statusPill.fg }]}>{statusPill.text}</Text>
          </View>
        )}
      </View>

      <View style={styles.progressOuter}>
        <View style={[styles.progressInner, { width: `${Math.max(percent, 3)}%` }]}>
          <Text style={styles.progressLabel} numberOfLines={1}>
            {percent}% sold
          </Text>
        </View>
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#F6F7F4' },

  // Floating glass top bar
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
  },
  topBarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
  },
  overviewPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#FFFFFF',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.06)',
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  overviewText: { color: '#27272A', fontFamily: FONT.semibold, fontSize: 14 },
  overviewMenu: {
    position: 'absolute',
    left: 16,
    minWidth: 200,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    paddingVertical: 6,
    shadowColor: '#000',
    shadowOpacity: 0.16,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  menuItem: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 13 },
  menuItemText: { color: '#27272A', fontFamily: FONT.semibold, fontSize: 15 },
  menuDivider: { height: 1, backgroundColor: '#F1F2EE', marginHorizontal: 12 },
  newBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: BRAND,
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 9,
    shadowColor: BRAND,
    shadowOpacity: 0.3,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  newBtnText: { color: '#FFFFFF', fontFamily: FONT.semibold, fontSize: 14 },
  topBarActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  iconPill: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },

  // Hero (themed)
  hero: { paddingHorizontal: 18, paddingTop: 4, paddingBottom: 8 },
  greeting: { fontFamily: FONT.bold, fontSize: 25, marginBottom: 6 },
  briefingHeadline: { fontFamily: FONT.semibold, fontSize: 17, marginBottom: 10, lineHeight: 23 },
  briefingProse: { fontSize: 17, lineHeight: 27, marginTop: 1 },

  dashedDivider: {
    marginTop: 18,
    marginBottom: 16,
    borderBottomWidth: 1,
    borderColor: 'rgba(0,0,0,0.08)',
    borderStyle: 'dashed',
  },

  statsRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  salesToday: { fontFamily: FONT.semibold, fontSize: 15 },
  salesDelta: { fontFamily: FONT.bold, fontSize: 15 },

  chartWrap: { height: 110, marginTop: 8, marginHorizontal: -18, justifyContent: 'center' },
  chart: { paddingRight: 0 },
  chartBaseline: {
    position: 'absolute',
    left: 18,
    right: 18,
    top: '50%',
    borderBottomWidth: 1,
    borderColor: 'rgba(0,0,0,0.07)',
    borderStyle: 'dashed',
  },

  rangeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 },
  rangeChip: { borderRadius: 999, paddingHorizontal: 11, paddingVertical: 6 },
  rangeChipActive: { backgroundColor: '#18181B' },
  rangeChipText: { color: '#9CA3AF', fontFamily: FONT.semibold, fontSize: 12 },
  rangeChipTextActive: { color: '#FFFFFF' },

  // Body
  body: { paddingHorizontal: 16, paddingTop: 18 },
  filterRow: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  filterChip: { borderRadius: 999, paddingHorizontal: 16, paddingVertical: 8, backgroundColor: '#EBEDE7' },
  filterChipActive: { backgroundColor: '#1B1B1F' },
  filterChipText: { color: '#52525B', fontFamily: FONT.semibold, fontSize: 13 },
  filterChipTextActive: { color: '#FFFFFF' },

  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FEF2F2',
    borderColor: '#FECACA',
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 14,
  },
  errorText: { flex: 1, color: '#B91C1C', fontFamily: FONT.medium, fontSize: 12 },
  errorRetry: { color: '#DC2626', fontFamily: FONT.bold, fontSize: 12 },

  loadingBox: { alignItems: 'center', paddingVertical: 48, gap: 12 },
  loadingText: { color: '#71717A', fontFamily: FONT.medium, fontSize: 13 },

  emptyCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 22,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#EEEFEA',
  },
  emptyIconWrap: {
    width: 56,
    height: 56,
    borderRadius: 18,
    backgroundColor: 'rgba(147,200,34,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  emptyTitle: { color: '#18181B', fontFamily: FONT.bold, fontSize: 18, marginBottom: 6 },
  emptyBody: { color: '#71717A', fontFamily: FONT.regular, fontSize: 14, lineHeight: 20, textAlign: 'center', marginBottom: 18 },
  emptyCta: { backgroundColor: BRAND, borderRadius: 14, paddingHorizontal: 20, paddingVertical: 13 },
  emptyCtaText: { color: '#FFFFFF', fontFamily: FONT.bold, fontSize: 14 },

  // Card
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#EEEFEA',
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 1,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  cardThumb: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: 'rgba(147,200,34,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  cardHeaderText: { flex: 1 },
  cardTitle: { color: '#18181B', fontFamily: FONT.bold, fontSize: 15, marginBottom: 5 },
  cardMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  daysBadge: { backgroundColor: 'rgba(147,200,34,0.18)', borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 },
  daysBadgeText: { color: '#4E6B12', fontFamily: FONT.bold, fontSize: 11 },
  cardSubMeta: { color: '#71717A', fontFamily: FONT.medium, fontSize: 12 },

  pendingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#8A5A18',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  pendingBadgeCount: {
    color: '#8A5A18',
    backgroundColor: '#FFFFFF',
    fontFamily: FONT.bold,
    fontSize: 11,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    textAlign: 'center',
    overflow: 'hidden',
    lineHeight: 16,
  },
  pendingBadgeText: { color: '#FFFFFF', fontFamily: FONT.semibold, fontSize: 12 },

  statusPill: { borderRadius: 999, paddingHorizontal: 11, paddingVertical: 6 },
  statusPillText: { fontFamily: FONT.semibold, fontSize: 12 },

  progressOuter: { height: 34, borderRadius: 12, backgroundColor: '#F1F2EE', overflow: 'hidden', justifyContent: 'center' },
  progressInner: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: BRAND,
    borderRadius: 12,
    justifyContent: 'center',
    paddingHorizontal: 12,
    minWidth: 60,
  },
  progressLabel: { color: '#FFFFFF', fontFamily: FONT.bold, fontSize: 12 },

  // FAB
  fab: {
    position: 'absolute',
    right: 20,
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: BRAND,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: BRAND,
    shadowOpacity: 0.4,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },

  // Modal
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalSheet: { backgroundColor: '#FFFFFF', borderTopLeftRadius: 26, borderTopRightRadius: 26, paddingHorizontal: 22, paddingTop: 10 },
  modalHandle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: '#E4E4E7', marginBottom: 16 },
  modalTitle: { color: '#18181B', fontFamily: FONT.bold, fontSize: 20 },
  modalSubtitle: { color: '#71717A', fontFamily: FONT.regular, fontSize: 14, marginTop: 4, marginBottom: 18 },
  fieldLabel: { color: '#3F3F46', fontFamily: FONT.semibold, fontSize: 13, marginBottom: 7, marginTop: 4 },
  fieldRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E4E4E7',
    borderRadius: 14,
    paddingHorizontal: 14,
    marginBottom: 14,
  },
  fieldPrefix: { color: '#71717A', fontFamily: FONT.semibold, fontSize: 16, marginRight: 4 },
  fieldSuffix: { color: '#71717A', fontFamily: FONT.medium, fontSize: 14 },
  fieldInput: { flex: 1, color: '#18181B', fontFamily: FONT.semibold, fontSize: 16, paddingVertical: 14 },
  aggrRow: { flexDirection: 'row', gap: 8, marginBottom: 22 },
  aggrChip: { flex: 1, alignItems: 'center', borderRadius: 12, paddingVertical: 11, backgroundColor: '#F1F2EE' },
  aggrChipActive: { backgroundColor: BRAND },
  aggrChipText: { color: '#52525B', fontFamily: FONT.semibold, fontSize: 13 },
  aggrChipTextActive: { color: '#FFFFFF' },
  modalActions: { flexDirection: 'row', gap: 12 },
  modalCancel: { flex: 1, alignItems: 'center', borderRadius: 14, paddingVertical: 15, backgroundColor: '#F1F2EE' },
  modalCancelText: { color: '#3F3F46', fontFamily: FONT.semibold, fontSize: 15 },
  modalCreate: { flex: 2, alignItems: 'center', borderRadius: 14, paddingVertical: 15, backgroundColor: BRAND },
  modalCreateDisabled: { opacity: 0.6 },
  modalCreateText: { color: '#FFFFFF', fontFamily: FONT.bold, fontSize: 15 },
});

export default SproutHomeScreen;
