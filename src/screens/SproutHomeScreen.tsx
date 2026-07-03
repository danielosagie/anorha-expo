import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  Image,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useAuth, useUser } from '@clerk/expo';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { LineChart } from 'react-native-chart-kit';
import * as Haptics from 'expo-haptics';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { Moon, Sun } from 'lucide-react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { StreamingText } from '../components/StreamingText';
import { UpNextRow, type IconName } from '../components/quest/LobbyKit';
import { HybridConversationDataAdapter } from '../features/liquidationConversation/HybridConversationDataAdapter';
import { useLiquidationConversationController } from '../features/liquidationConversation/useLiquidationConversationController';
import type { CampaignSummary } from '../features/liquidationConversation/types';
import { NewClearoutSheet, NewClearoutInput } from '../components/liquidation/NewClearoutSheet';
import { DateRangeSheet, DateRange, todayRange } from '../components/liquidation/DateRangeSheet';
import { useOrg } from '../context/OrgContext';
import { useIsNight } from '../hooks/useIsNight';
import { useOrgNudges } from '../hooks/useOrgNudges';
import { usePlatformConnections } from '../context/PlatformConnectionsContext';
import { useProfileProductCount } from '../hooks/useProfileProductCount';

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
type BriefingRowData = { id: string; label: string; chip: BriefingChip; status: string };

const CHIP_STYLE: Record<BriefingChip, { bg: string; fg: string; text: string }> = {
  SOLD: { bg: '#EAF7CF', fg: '#4E6B12', text: 'SOLD' },
  OFFER: { bg: '#FBEAD2', fg: '#A2611A', text: 'OFFER' },
  REPRICE: { bg: '#E7E7EA', fg: '#3F3F46', text: 'REPRICE' },
  ASK: { bg: '#DCEBFB', fg: '#1F5FA8', text: 'NEEDS YOU' },
  LISTED: { bg: '#E6F0FB', fg: '#2563A8', text: 'LISTED' },
};

// ── Adaptive home theme: green by day, dark by night (anorha Figma mockup) ─
// Layout is a hero block (rounded-24 bottom) over a contrasting body in both
// modes: green hero / light body by day, #0F1603 hero / #1C1E15 body at night.
type Palette = {
  bgFrom: string; bgTo: string;
  heroTop: string; bodyBg: string;
  strong: string; dim: string; faint: string;
  pillBg: string; pillBorder: string; newBg: string;
  chart: string; divider: string;
  chipIdleBg: string; chipIdleText: string; chipActiveBg: string; chipActiveText: string;
  chipBorder: string;
  rangeIdleText: string; rangeActiveBg: string; rangeActiveText: string;
  blur: 'light' | 'dark';
};

const DAY_THEME: Palette = {
  bgFrom: '#9AC53C', bgTo: '#6F9C26',
  heroTop: '#9AC53C', bodyBg: '#F6F7F4',
  strong: '#FFFFFF', dim: 'rgba(255,255,255,0.6)', faint: 'rgba(255,255,255,0.78)',
  pillBg: 'rgba(255,255,255,0.18)', pillBorder: 'rgba(0,0,0,0.06)', newBg: 'rgba(20,30,8,0.30)',
  chart: 'rgba(255,255,255,0.95)', divider: 'rgba(255,255,255,0.34)',
  chipIdleBg: '#EBEDE7', chipIdleText: '#52525B',
  chipActiveBg: '#FFFFFF', chipActiveText: '#18181B', chipBorder: 'rgba(0,0,0,0.08)',
  rangeIdleText: 'rgba(255,255,255,0.78)', rangeActiveBg: '#FFFFFF', rangeActiveText: '#43631A',
  blur: 'light',
};

const NIGHT_THEME: Palette = {
  bgFrom: '#0F1603', bgTo: '#0F1603',
  heroTop: '#0F1603', bodyBg: '#1C1E15',
  strong: '#FFFFFF', dim: 'rgba(255,255,255,0.4)', faint: 'rgba(255,255,255,0.8)',
  pillBg: 'rgba(244,244,245,0.2)', pillBorder: 'rgba(0,0,0,0.25)', newBg: 'rgba(255,255,255,0.2)',
  chart: 'rgba(255,255,255,0.92)', divider: 'rgba(255,255,255,0.9)',
  chipIdleBg: 'rgba(255,255,255,0.2)', chipIdleText: '#CECECE',
  chipActiveBg: '#FFFFFF', chipActiveText: '#000000', chipBorder: 'transparent',
  rangeIdleText: 'rgba(244,244,238,0.6)', rangeActiveBg: '#F4F4EE', rangeActiveText: '#1F2218',
  blur: 'dark',
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

// Render briefing prose with numeric VALUES lifted into inline pill-chips (the
// nutrition-summary look). Everything else flows as normal text; chips + words
// share one flex-wrap row so they stay inline. Punctuation glues to its word.
const isBriefingValue = (t: string) => /\d/.test(t);

type BriefingToken = { kind: 'text' | 'chip'; text: string };
const briefingDisplay = (segments: Seg[]): BriefingToken[] => {
  const out: BriefingToken[] = [];
  const pushText = (raw: string) => {
    const t = raw.trim();
    if (!t) return;
    const last = out[out.length - 1];
    if (last && last.kind === 'text' && /^[,.;:!?]+$/.test(t)) {
      last.text = last.text.replace(/\s+$/, '') + t + ' ';
    } else {
      out.push({ kind: 'text', text: t + ' ' });
    }
  };
  segments.forEach((s) => {
    s.text.split(/(\s+)/).forEach((tok) => {
      if (/^\s*$/.test(tok)) return;
      if (isBriefingValue(tok)) out.push({ kind: 'chip', text: tok.trim() });
      else pushText(tok);
    });
  });
  return out;
};

// ── Demo mode ──────────────────────────────────────────────────────────────
// Flip to false for production. When true the home renders a FULL, ACTIVE state
// (mock campaigns + a Sprout message) so the design can be reviewed without real
// data. When false the screen behaves normally (real campaigns / onboarding).
const DEMO = false;

// Card-level dollar figures aren't on CampaignSummary yet, so the card accepts
// them optionally and falls back to item counts when absent.
type CardCampaign = CampaignSummary & { raised?: number; goal?: number };

const daysAgoISO = (days: number): string => new Date(Date.now() - days * 86400000).toISOString();

const DEMO_CAMPAIGNS: CardCampaign[] = [
  { id: 'demo-1', title: 'Sneaker Vault Clearout', status: 'active', primaryThreadId: 't1', createdAt: daysAgoISO(11), updatedAt: daysAgoISO(0), timeframeDays: 14, stats: { soldCount: 9, totalCount: 43, negotiating: 2 }, raised: 500, goal: 750, imageUrl: 'https://picsum.photos/seed/sneaker1/120/120' },
  { id: 'demo-2', title: 'Vintage Denim Drop', status: 'active', primaryThreadId: 't2', createdAt: daysAgoISO(8), updatedAt: daysAgoISO(0), timeframeDays: 30, stats: { soldCount: 18, totalCount: 60, negotiating: 0 }, raised: 1240, goal: 2000, imageUrl: 'https://picsum.photos/seed/denim2/120/120' },
  { id: 'demo-3', title: 'Electronics Liquidation', status: 'waiting_user', primaryThreadId: 't3', createdAt: daysAgoISO(20), updatedAt: daysAgoISO(0), timeframeDays: 30, stats: { soldCount: 30, totalCount: 50, negotiating: 1 }, raised: 3120, goal: 4000, imageUrl: 'https://picsum.photos/seed/tech3/120/120' },
  { id: 'demo-c1', title: 'Holiday Markdown', status: 'completed', primaryThreadId: 't4', createdAt: daysAgoISO(40), updatedAt: daysAgoISO(5), timeframeDays: 21, stats: { soldCount: 43, totalCount: 43 }, raised: 600, goal: 600, imageUrl: 'https://picsum.photos/seed/holiday4/120/120' },
  { id: 'demo-c2', title: 'Garage Overflow', status: 'completed', primaryThreadId: 't5', createdAt: daysAgoISO(50), updatedAt: daysAgoISO(9), timeframeDays: 30, stats: { soldCount: 13, totalCount: 43 }, raised: 420, goal: 500, imageUrl: 'https://picsum.photos/seed/garage5/120/120' },
];

const DEMO_EVENTS = [
  { id: 'e1', label: 'Offer 1', time: '9:31 PM' },
  { id: 'e2', label: 'Negotiation 1', time: '3:54 AM' },
  { id: 'e3', label: 'Negotiation 2', time: '5:12 AM' },
];

// ── Sprout's proactive message: morning recap, evening recap, or a midday
//    check-in. This is what makes the home feel like Sprout is talking to you.
type SproutMessage = { time: string; lead: string; body: Seg[] };

const seg = (text: string, strong = true): Seg => ({ text, strong });

// ── Hero action card (Figma 4746:3753) — the one strong action under the ledger.
//    Doc-chip tilted -7°, translucent black card, white Review-style pill on the right.
const HeroActionCard = ({
  title,
  subtitle,
  chip,
  onPress,
}: {
  title: string;
  subtitle?: string;
  chip: string;
  onPress: () => void;
}) => (
  <TouchableOpacity style={styles.reportCard} activeOpacity={0.85} onPress={onPress}>
    <View style={styles.reportIconWrap}>
      <LinearGradient
        colors={['rgba(255,255,255,0.31)', 'rgba(153,153,153,0.31)']}
        style={styles.reportIconChip}
      >
        <Icon name="file-document-outline" size={30} color="#FFFFFF" />
      </LinearGradient>
    </View>
    <View style={styles.reportTextCol}>
      <Text style={styles.reportTitle} numberOfLines={2}>{title}</Text>
      {!!subtitle && <Text style={styles.reportSub} numberOfLines={1}>{subtitle}</Text>}
    </View>
    <View style={styles.reportChip}>
      <Text style={styles.reportChipText}>{chip}</Text>
    </View>
  </TouchableOpacity>
);

// Demo ledger matching the mockup exactly.
const DEMO_LEDGER: BriefingRowData[] = [
  { id: 'd1', label: '1 Offer (+$124)', chip: 'SOLD', status: 'Sold' },
  { id: 'd2', label: 'Repriced 40 items (-3%)', chip: 'REPRICE', status: 'Monitoring' },
  { id: 'd3', label: 'Negotiation 2', chip: 'OFFER', status: 'Scheduled' },
];

const sproutMessageForHour = (hour: number, _name: string): SproutMessage => {
  // Evening recap (5pm–10pm)
  if (hour >= 17 && hour < 22) {
    return {
      time: '6:40 PM',
      lead: "Here's your evening recap",
      body: [
        seg('Good day — we '), seg('sold 9 items'), seg(' for '), seg('$500'),
        seg('. I '), seg('repriced 4'), seg(' slow movers and '), seg('views are up 18%'),
        seg('. '), seg('2 offers', true), seg(' are waiting on your call.'),
      ],
    };
  }
  // Late-night / overnight recap (10pm–5am)
  if (hour >= 22 || hour < 5) {
    return {
      time: '9:31 PM',
      lead: '3 things happened while you slept',
      body: [
        seg('I '), seg('closed 2 negotiations'), seg(' on electronics and '),
        seg('scheduled a pickup'), seg(' for '), seg('6:15 PM'), seg('. An '), seg('offer of $1,140'),
        seg(' came in — '), seg('about 86%'), seg(' of market.'),
      ],
    };
  }
  // Morning briefing (5am–noon)
  if (hour < 12) {
    return {
      time: '8:05 AM',
      lead: "Here's your overnight recap",
      body: [
        seg("I "), seg('sold 3 items'), seg(', banked '), seg('$240'),
        seg(', and '), seg('1 buyer', true), seg(' wants to negotiate. Want me to counter at '), seg('92%'), seg('?'),
      ],
    };
  }
  // Midday check-in (noon–5pm)
  return {
    time: '1:20 PM',
    lead: 'A quick midday check-in',
    body: [
      seg("Steady so far — "), seg('5 sales'), seg(' and '), seg('$310'),
      seg(' today. I '), seg('relisted 2 items'), seg(' that stalled. Nothing needs you right now.'),
    ],
  };
};

const SproutHomeScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const { getToken } = useAuth();
  const { user } = useUser();

  // Name shown in the greeting. Fall through Clerk first/full name → username →
  // the email handle before the generic 'there', so accounts that never set a
  // first name (e.g. email/password sign-ups that skipped the old onboarding)
  // still read as a person instead of a bare "Good morning, there".
  const firstName =
    user?.firstName ||
    user?.fullName?.trim()?.split(/\s+/)[0] ||
    user?.username ||
    user?.primaryEmailAddress?.emailAddress?.split('@')[0] ||
    'there';
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

  // Date range (header pill → Shopify-style presets/custom sheet)
  const [rangeOpen, setRangeOpen] = useState(false);
  const [dateRange, setDateRange] = useState<DateRange>(todayRange());

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

  // Periodic insight (LLM nudges, 6h cache) — the recommendation layer the home
  // blurb surfaces when there's no fresher digest/briefing to show.
  const { currentOrg, isLoading: isOrgLoading } = useOrg();
  const { insight } = useOrgNudges(!isOrgLoading ? currentOrg?.id : undefined);
  const { liveConnections } = usePlatformConnections();
  const { productCount, loading: productCountLoading } = useProfileProductCount();
  // Setup state drives the empty dashboard: an established seller (has a platform
  // AND items) who simply hasn't started a clearout should NOT see first-run
  // onboarding — only the "Start a clearout" CTA. `setupUnknown` suppresses the
  // pre-bridge flash where productCount is still 0 (initial value) and the
  // 3-step checklist would briefly paint "Add your first items" as incomplete.
  const hasSetup = (liveConnections?.length || 0) > 0 && (productCount || 0) > 0;
  // "Unknown" until the org is resolved AND the count has settled — the count
  // gates on currentOrg (see AppDataContext.refreshProductCount), so before the
  // org loads productCount is its 0 default and would flash the checklist.
  const setupUnknown = isOrgLoading || productCountLoading || !currentOrg?.id;
  // Only surface ACTIONABLE headlines — status noise ("Insights paused") stays off the hero.
  const rawHeadline = insight?.topDIN?.headline?.trim();
  const insightHeadline =
    rawHeadline && !/paused|unavailable|disabled|error/i.test(rawHeadline) ? rawHeadline : undefined;

  // Insight handoff → chat. The backend scopes by StrategyId; mobile threads key on
  // session ids, so match against the loaded campaigns and fall back to the newest —
  // the prompt text itself carries the exact scope either way.
  const handoffTarget = useMemo(() => {
    const h = insight?.handoff;
    if (!h?.prompt) return null;
    const match = controller.campaigns.find((c) => c.id === h.campaignId);
    const campaignId = match?.id || controller.campaigns[0]?.id;
    if (!campaignId) return null;
    return { campaignId, prompt: h.prompt, label: h.label || 'Dig in' };
  }, [insight?.handoff, controller.campaigns]);

  // Live pulse: when the briefing is quiet, show Sprout's most recent real action
  // so "Sprout is watching" is backed by evidence instead of vibes.
  const lastAction = controller.campaignOverview?.recentActions?.[0];
  const lastActivityLine = useMemo(() => {
    if (!lastAction) return null;
    const t = Date.parse(lastAction.createdAt);
    if (!Number.isFinite(t)) return null;
    const mins = Math.max(1, Math.round((Date.now() - t) / 60000));
    const ago = mins < 60 ? `${mins}m ago` : mins < 1440 ? `${Math.round(mins / 60)}h ago` : `${Math.round(mins / 1440)}d ago`;
    const what = String(lastAction.actionType || 'checked in').replace(/_/g, ' ');
    return `Last action: ${what} · ${ago}`;
  }, [lastAction]);

  // Sprout's scheduled 12h digest (backend cron) + the honest "next report" countdown.
  const latestDigest = controller.campaignOverview?.latestDigest;
  const nextReportHours = useMemo(() => {
    const at = latestDigest?.nextReportAt ? Date.parse(latestDigest.nextReportAt) : NaN;
    if (!Number.isFinite(at)) return null;
    const hours = Math.ceil((at - Date.now()) / (60 * 60 * 1000));
    return hours > 0 && hours <= 12 ? hours : null;
  }, [latestDigest?.nextReportAt]);

  const isNight = useIsNight();
  // ── The hero "message" from Sprout — whatever's in the green box: the scheduled
  //    digest, else the current insight, else the honest "watching" line. It types in
  //    ONLY when genuinely new (first open, or a fresh message); on remount / navigation
  //    back it renders instantly and never replays — exactly like a normal chat app.
  const heroMessage = useMemo<{ id: string; text: string } | null>(() => {
    if (DEMO) return null; // demo has its own scripted body
    if (latestDigest) return { id: `digest:${latestDigest.createdAt}`, text: latestDigest.text };
    if (controller.loading) return null; // don't stream the transient "Catching you up…"
    if (insightHeadline) return { id: `insight:${insightHeadline}`, text: insightHeadline };
    return {
      id: isNight ? 'quiet:night' : 'quiet:day',
      text: isNight ? 'All quiet while you slept. Sprout is watching.' : 'All quiet so far. Sprout is watching.',
    };
  }, [DEMO, latestDigest, controller.loading, insightHeadline, isNight]);

  const [seenLoaded, setSeenLoaded] = useState(false);
  const [lastSeenMsgId, setLastSeenMsgId] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    AsyncStorage.getItem('sprout:lastSeenHeroMsgId')
      .then((v) => { if (alive) { setLastSeenMsgId(v); setSeenLoaded(true); } })
      .catch(() => { if (alive) setSeenLoaded(true); });
    return () => { alive = false; };
  }, []);
  const shouldStreamHero = seenLoaded && !!heroMessage && heroMessage.id !== lastSeenMsgId;
  const markHeroSeen = useCallback(() => {
    if (!heroMessage) return;
    setLastSeenMsgId(heroMessage.id);
    AsyncStorage.setItem('sprout:lastSeenHeroMsgId', heroMessage.id).catch(() => {});
  }, [heroMessage?.id]);

  // ── "While you slept" briefing rows, derived from the active campaign overview
  const briefingRows = useMemo<BriefingRowData[]>(() => {
    const o = controller.campaignOverview;
    if (!o) return [];
    const rows: BriefingRowData[] = [];
    const s = o.summary24h;
    const soldRevenue = Number(s.revenue || 0);
    if (s.sold > 0) rows.push({ id: 'sold', label: `${s.sold} ${s.sold === 1 ? 'Sale' : 'Sales'}${soldRevenue > 0 ? ` (+$${Math.round(soldRevenue).toLocaleString()})` : ''}`, chip: 'SOLD', status: 'Sold' });
    if (s.negotiating > 0) rows.push({ id: 'neg', label: `${s.negotiating} ${s.negotiating === 1 ? 'Offer' : 'Offers'} In`, chip: 'OFFER', status: 'Needs you' });
    if (s.repriced > 0) rows.push({ id: 'rep', label: `Repriced ${s.repriced} ${s.repriced === 1 ? 'item' : 'items'}`, chip: 'REPRICE', status: 'Monitoring' });
    if (s.listed > 0) rows.push({ id: 'list', label: `${s.listed} ${s.listed === 1 ? 'Listing' : 'Listings'} Live`, chip: 'LISTED', status: 'Live' });
    for (const item of o.needsInput.slice(0, 2)) {
      rows.push({ id: `ask-${item.id}`, label: item.title, chip: 'ASK', status: 'Needs you' });
    }
    return rows.slice(0, 4);
  }, [controller.campaignOverview]);

  // ── Timestamped event rows under the briefing (mock: "Offer 1 · 9:31 PM").
  //    Real recentActions only; numbered per kind; newest 3.
  const eventRows = useMemo(() => {
    const interesting = (controller.campaignOverview?.recentActions || []).filter((a) =>
      /offer|negotiat|sold|reprice|list/i.test(String(a.actionType || '')),
    );
    const counts: Record<string, number> = {};
    return interesting.slice(0, 3).map((a) => {
      const type = String(a.actionType || '');
      const kind = /offer/i.test(type)
        ? 'Offer'
        : /negotiat/i.test(type)
          ? 'Negotiation'
          : /sold/i.test(type)
            ? 'Sale'
            : /reprice/i.test(type)
              ? 'Reprice'
              : 'Listing';
      counts[kind] = (counts[kind] || 0) + 1;
      const t = Date.parse(a.createdAt);
      const time = Number.isFinite(t)
        ? new Date(t).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
        : '';
      return { id: a.id, label: `${kind} ${counts[kind]}`, time };
    });
  }, [controller.campaignOverview?.recentActions]);

  // ── Chart series: cumulative revenue from recent actions. REAL data only —
  //    when there aren't ≥2 revenue points, the chart (and range chips) hide
  //    entirely instead of drawing a decorative fake line.
  const chartSeries = useMemo<number[]>(() => {
    const pointCount = activeRange === '1D' ? 8 : activeRange === '1W' ? 12 : 16;
    const actions = (controller.campaignOverview?.recentActions || []).filter(
      a => Number(a.revenueImpact || 0) !== 0,
    );
    if (actions.length < 2) return [];
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
  }, [controller.campaignOverview, activeRange]);

  // Demo mode swaps in mock campaigns so the full/active home is reviewable.
  const baseCampaigns: CardCampaign[] = DEMO ? DEMO_CAMPAIGNS : controller.campaigns;
  const filteredCampaigns = useMemo(() => {
    if (activeFilter === 'Running') {
      return baseCampaigns.filter(c => c.status === 'active' || c.status === 'waiting_user');
    }
    if (activeFilter === 'Completed') {
      return baseCampaigns.filter(c => c.status === 'completed');
    }
    return baseCampaigns;
  }, [baseCampaigns, activeFilter]);

  // Mockup groups the list: live clearouts first, then a dimmed COMPLETED section.
  const runningCampaigns = useMemo(
    () => filteredCampaigns.filter(c => c.status !== 'completed'),
    [filteredCampaigns],
  );
  const completedCampaigns = useMemo(
    () => filteredCampaigns.filter(c => c.status === 'completed'),
    [filteredCampaigns],
  );

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

  // ── Long-press to select campaigns → bulk pause / delete ──────────────
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());

  const exitSelect = useCallback(() => {
    setSelectMode(false);
    setSelectedIds(new Set());
  }, []);

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const beginSelect = useCallback((id: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
    setSelectMode(true);
    setSelectedIds(new Set([id]));
  }, []);

  // While selecting, the floating action pill takes the navigator's place — hide
  // the tab bar so the two don't stack at the bottom.
  useEffect(() => {
    navigation.setOptions({ tabBarStyle: selectMode ? { display: 'none' } : undefined });
    return () => { navigation.setOptions({ tabBarStyle: undefined }); };
  }, [selectMode, navigation]);

  const onCardPress = useCallback((c: CampaignSummary) => {
    if (selectMode) {
      tap();
      toggleSelect(c.id);
    } else {
      openCampaign(c);
    }
  }, [selectMode, tap, toggleSelect, openCampaign]);

  const pauseSelected = useCallback(async () => {
    const ids = Array.from(selectedIds);
    if (!ids.length) return;
    tap(Haptics.ImpactFeedbackStyle.Medium);
    exitSelect();
    try {
      await Promise.all(ids.map(id => controller.setCampaignStatus(id, 'paused')));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
    } catch (e: any) {
      Alert.alert('Could not pause', String(e?.message || e));
    }
  }, [selectedIds, tap, exitSelect, controller]);

  const deleteSelected = useCallback(() => {
    const ids = Array.from(selectedIds);
    if (!ids.length) return;
    Alert.alert(
      `Delete ${ids.length} clearout${ids.length === 1 ? '' : 's'}?`,
      'This removes the campaign and its chats. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            exitSelect();
            try {
              await Promise.all(ids.map(id => controller.deleteCampaign(id)));
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
            } catch (e: any) {
              Alert.alert('Could not delete', String(e?.message || e));
            }
          },
        },
      ],
    );
  }, [selectedIds, exitSelect, controller]);

  const handleCreate = useCallback(async (input: NewClearoutInput) => {
    setCreating(true);
    try {
      const campaign = await adapter.createCampaign({
        title: input.title,
        targetRevenue: input.targetRevenue,
        timeframeDays: input.timeframeDays,
        aggressiveness: input.aggressiveness,
        inventoryScope: input.productIds.length ? 'specific' : 'all',
        productIds: input.productIds,
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
  const THEME = isNight ? NIGHT_THEME : DAY_THEME;
  const briefingSegments = useMemo(() => briefingToSegments(briefingRows), [briefingRows]);

  // Sprout's proactive message (morning/evening recap or midday check-in).
  const sproutMsg = useMemo(() => sproutMessageForHour(new Date().getHours(), firstName), [firstName]);

  // Hero stats + events: demo values when previewing, real otherwise.
  const heroSold = DEMO ? 9 : soldToday;
  const heroRevenue = DEMO ? 500 : revenue24h;
  const displayEvents = DEMO ? DEMO_EVENTS : eventRows;
  // Show Sprout's message when there's a real digest, when previewing, or when
  // there's overnight activity to recap. Otherwise the quiet line stands in.
  const showSproutMessage = DEMO || !!latestDigest || briefingRows.length > 0;
  const ledgerRows = DEMO ? DEMO_LEDGER : briefingRows;

  const reportTitle = useMemo(() => {
    const h = new Date().getHours();
    if (h < 12) return 'Morning Report';
    if (h < 17) return 'Midday Report';
    return 'Evening Report';
  }, []);

  // Review → hand the full report to Sprout: opens the thread and fires one
  // create_report-shaped task; the document card comes back openable/shareable.
  const openReport = useCallback(() => {
    const campaignId = handoffTarget?.campaignId || controller.campaigns[0]?.id;
    if (!campaignId) return;
    tap();
    navigation.navigate('CampaignThreadScreen', {
      campaignId,
      initialPrompt:
        'Give me the full report: everything that happened since I last checked, what it means, and the next moves — as a report document.',
    });
  }, [handoffTarget?.campaignId, controller.campaigns, navigation, tap]);

  return (
    <View style={[styles.screen, { backgroundColor: THEME.bodyBg }]}>
      <StatusBar barStyle="light-content" />

      {/* ── Static header: edge-to-edge, pinned at top, rounded bottom ── */}
      <View style={[styles.header, { backgroundColor: THEME.heroTop, paddingTop: insets.top + 2 }]}>
        {!isNight && (
          <LinearGradient colors={[THEME.bgTo, THEME.bgTo]} style={StyleSheet.absoluteFill} pointerEvents="none" />
        )}
        {/* Top bar: date-range pill + New, no background of its own */}
        <View style={styles.topBarRow}>
          <TouchableOpacity
            style={[styles.overviewPill, { backgroundColor: THEME.pillBg, borderColor: THEME.pillBorder }]}
            onPress={() => {
              tap();
              setRangeOpen(true);
            }}
            activeOpacity={0.85}
          >
            <Icon name="calendar-blank-outline" size={15} color={THEME.strong} />
            <Text style={[styles.overviewText, { color: THEME.strong }]}>{dateRange.label}</Text>
            <Icon name="chevron-down" size={15} color={THEME.faint} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.newBtn, { backgroundColor: THEME.newBg, borderColor: THEME.pillBorder }]}
            onPress={openCreate}
            activeOpacity={0.85}
          >
            <Icon name="plus" size={15} color="#FFFFFF" />
            <Text style={[styles.newBtnText, { color: THEME.strong }]}>New</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.hero}>
          <View style={styles.greetingRow}>
            <Text style={[styles.greeting, { color: THEME.strong }]} numberOfLines={1}>
              {greeting}, {firstName}
            </Text>
            {isNight ? <Moon size={20} color={THEME.faint} /> : <Sun size={20} color={THEME.faint} />}
          </View>

          {showSproutMessage ? (
            // Sprout's recap — the efficient ledger (Figma 4746:3113): count headline,
            // event → status rows, then ONE strong action: the full report.
            <View style={styles.sproutMsg}>
              <View style={styles.leadRow}>
                <Text style={[styles.sproutLead, { color: THEME.strong }]}>
                  {ledgerRows.length > 0
                    ? `${ledgerRows.length} ${ledgerRows.length === 1 ? 'thing' : 'things'} happened ${isNight ? 'while you slept' : 'while you were away'}`
                    : sproutMsg.lead}
                </Text>
                <Icon name="bell-badge-outline" size={22} color={THEME.strong} />
              </View>
              {ledgerRows.length > 0 ? (
                <View style={styles.ledger}>
                  {ledgerRows.map((row) => (
                    <View key={row.id} style={styles.ledgerRow}>
                      <Text style={[styles.ledgerLabel, { color: THEME.strong }]} numberOfLines={1}>
                        {row.label}
                      </Text>
                      <Text style={[styles.ledgerStatus, { color: THEME.strong }]}>{row.status}</Text>
                    </View>
                  ))}
                </View>
              ) : latestDigest && !DEMO && seenLoaded ? (
                // No ledger rows — the scheduled digest stands in, typed only when new.
                <StreamingText
                  text={latestDigest.text}
                  shouldStream={shouldStreamHero}
                  onComplete={markHeroSeen}
                  speed={42}
                  style={[styles.briefingProse, { color: THEME.strong, fontFamily: FONT.regular }]}
                />
              ) : null}
              {(DEMO || controller.campaigns.length > 0) && (
                <HeroActionCard
                  title={reportTitle}
                  subtitle="Here's what you missed"
                  chip="Review"
                  onPress={openReport}
                />
              )}
              {!DEMO && nextReportHours != null && (
                <Text style={[styles.nextReport, { color: THEME.faint }]}>
                  Next report in {nextReportHours}h
                </Text>
              )}
            </View>
          ) : (
            <>
              {/* The quiet-state message (the periodic insight when there is one, else
                  the honest "watching" line) types in on first open / when it's new,
                  just like the digest and the chat. Instant on remount, never replays. */}
              {controller.loading ? (
                <Text style={[styles.briefingHeadline, { color: THEME.faint }]}>Catching you up…</Text>
              ) : seenLoaded && heroMessage ? (
                <StreamingText
                  text={heroMessage.text}
                  shouldStream={shouldStreamHero}
                  onComplete={markHeroSeen}
                  speed={42}
                  style={[styles.briefingProse, { color: THEME.strong, fontFamily: FONT.regular }]}
                />
              ) : null}
              {!controller.loading && lastActivityLine && (
                <Text style={[styles.nextReport, { color: THEME.faint }]}>{lastActivityLine}</Text>
              )}
              {/* Handoff: the insight ships a ready-to-send task for Sprout — one tap
                  opens the campaign thread and fires it as a normal message. */}
              {!controller.loading && handoffTarget && (
                <HeroActionCard
                  title={insightHeadline || 'Sprout has a move'}
                  chip={handoffTarget.label}
                  onPress={() => {
                    tap();
                    navigation.navigate('CampaignThreadScreen', {
                      campaignId: handoffTarget.campaignId,
                      initialPrompt: handoffTarget.prompt,
                    });
                  }}
                />
              )}
            </>
          )}

          <View style={[styles.dashedDivider, { borderColor: THEME.divider }]} />

          {/* Timestamped events ("Offer 1 · 9:31 PM") */}
          {displayEvents.length > 0 && (
            <View style={styles.eventRows}>
              {displayEvents.map((e) => (
                <View key={e.id} style={styles.eventRow}>
                  <Text style={[styles.eventLabel, { color: THEME.faint }]}>{e.label}</Text>
                  <Text style={[styles.eventTime, { color: THEME.strong }]}>{e.time}</Text>
                </View>
              ))}
            </View>
          )}

          {/* Hero stats — sales today + revenue */}
          <View style={styles.statsRow}>
            <Text style={[styles.salesToday, { color: THEME.strong }]}>
              {heroSold} {heroSold === 1 ? 'sale' : 'sales'} today
            </Text>
            <Text style={[styles.salesDelta, { color: THEME.strong }]}>+{currency(heroRevenue)}</Text>
          </View>

          {/* Sparkline — only when there is real revenue history to plot */}
          {chartSeries.length >= 2 && (
          <>
          <View style={styles.chartWrap} pointerEvents="none">
            <LineChart
              data={{ labels: [], datasets: [{ data: chartSeries }] }}
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
                  style={[styles.rangeChip, { backgroundColor: active ? THEME.rangeActiveBg : 'transparent' }]}
                  onPress={() => {
                    tap();
                    setActiveRange(r);
                  }}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.rangeChipText, { color: active ? THEME.rangeActiveText : THEME.rangeIdleText }]}>{r}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          </>
          )}
        </View>
      </View>

      {/* ── Scrolling list below the static header ──────────────────── */}
      <ScrollView
        style={styles.scroll}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: insets.bottom + 120 }}
      >
        {/* ── BODY ─────────────────────────────────────────────────── */}
        <View style={styles.body}>
          {/* No point filtering when there's nothing made yet — during onboarding the
              setup feed is the whole focus. Bar appears once the first clearout exists. */}
          {controller.campaigns.length > 0 && (
          <View style={styles.filterRow}>
            {FILTERS.map(f => {
              const active = f === activeFilter;
              return (
                <TouchableOpacity
                  key={f}
                  style={[
                    styles.filterChip,
                    {
                      backgroundColor: active ? THEME.chipActiveBg : THEME.chipIdleBg,
                      borderColor: active ? THEME.chipBorder : 'transparent',
                    },
                  ]}
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
          )}

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
              <Text style={[styles.loadingText, isNight && { color: 'rgba(244,244,238,0.6)' }]}>Loading your clearouts…</Text>
            </View>
          ) : filteredCampaigns.length === 0 ? (
            setupUnknown ? (
              // Org / item-count not resolved yet — hold on a quiet spinner
              // instead of flashing the first-run checklist to an established seller.
              <View style={styles.loadingBox}>
                <ActivityIndicator color={BRAND} />
              </View>
            ) : (activeFilter === 'All' && !hasSetup) ? (
              // First-run onboarding checklist — ONLY for a genuinely new seller
              // (no platform connected or no items yet). An established seller who
              // just hasn't started a clearout skips straight to the CTA below.
              <View style={[styles.emptyCard, isNight && styles.emptyCardNight, { alignItems: 'stretch' }]}>
                <Text style={[styles.emptyTitle, isNight && { color: '#F4F4EE' }, { textAlign: 'left' }]}>
                  Get set up
                </Text>
                <Text style={[styles.emptyBody, isNight && { color: 'rgba(244,244,238,0.6)' }, { textAlign: 'left', marginBottom: 12 }]}>
                  Three steps and Sprout takes it from there.
                </Text>
                {(() => {
                  // Staged progression: the first incomplete step is "up next" (green),
                  // earlier steps read done, later ones sit quiet — suggested one by one,
                  // fading in as a soft stack. Nothing is truly locked (tap any to jump).
                  const steps: Array<{ key: string; icon: IconName; label: string; sub: string; done: boolean; onPress: () => void }> = [
                    {
                      key: 'platform',
                      icon: 'storefront-outline',
                      label: 'Connect a platform',
                      sub: 'Shopify, Square, eBay and more',
                      done: (liveConnections?.length || 0) > 0,
                      onPress: () => navigation.navigate('Connections'),
                    },
                    {
                      key: 'items',
                      icon: 'camera-outline',
                      label: 'Add your first items',
                      sub: 'Snap a photo, Sprout finds the match',
                      done: (productCount || 0) > 0,
                      onPress: () => navigation.navigate('AddProduct'),
                    },
                    {
                      key: 'clearout',
                      icon: 'rocket-launch-outline',
                      label: 'Start a clearout',
                      sub: 'Set a goal, Sprout lists and negotiates',
                      done: false,
                      onPress: openCreate,
                    },
                  ];
                  const activeIdx = steps.findIndex((s) => !s.done);
                  return steps.map((step, i) => {
                    const state: 'done' | 'active' | 'locked' = step.done
                      ? 'done'
                      : i === activeIdx
                        ? 'active'
                        : 'locked';
                    return (
                      <Animated.View key={step.key} entering={FadeInDown.delay(i * 60).duration(360)}>
                        <UpNextRow
                          icon={step.icon}
                          title={step.label}
                          sub={step.sub}
                          state={state}
                          onPress={step.onPress}
                          night={isNight}
                          whiteActive
                        />
                      </Animated.View>
                    );
                  });
                })()}
              </View>
            ) : (
              <View style={[styles.emptyCard, isNight && styles.emptyCardNight]}>
                <View style={[styles.emptyIconWrap, isNight && { backgroundColor: 'rgba(147,200,34,0.16)' }]}>
                  <Icon name="sprout-outline" size={26} color={BRAND} />
                </View>
                <Text style={[styles.emptyTitle, isNight && { color: '#F4F4EE' }]}>
                  {activeFilter === 'All' ? 'Ready to clear out?' : `No ${activeFilter.toLowerCase()} clearouts`}
                </Text>
                <TouchableOpacity style={styles.emptyCta} onPress={openCreate} activeOpacity={0.9}>
                  <Text style={styles.emptyCtaText}>Start a clearout</Text>
                </TouchableOpacity>
              </View>
            )
          ) : (
            <>
              {runningCampaigns.map(c => (
                <CampaignCard
                  key={c.id}
                  campaign={c}
                  isNight={isNight}
                  onPress={() => onCardPress(c)}
                  onLongPress={() => beginSelect(c.id)}
                  selectMode={selectMode}
                  selected={selectedIds.has(c.id)}
                />
              ))}
              {runningCampaigns.length > 0 && completedCampaigns.length > 0 && (
                <View style={styles.completedHeader}>
                  <Text style={styles.completedLabel}>COMPLETED</Text>
                  <View style={[styles.completedDivider, isNight && { opacity: 0.35 }]} />
                </View>
              )}
              {completedCampaigns.map(c => (
                <CampaignCard
                  key={c.id}
                  campaign={c}
                  isNight={isNight}
                  onPress={() => onCardPress(c)}
                  onLongPress={() => beginSelect(c.id)}
                  selectMode={selectMode}
                  selected={selectedIds.has(c.id)}
                />
              ))}
            </>
          )}
        </View>
      </ScrollView>

      <DateRangeSheet
        visible={rangeOpen}
        current={dateRange}
        onApply={setDateRange}
        onClose={() => setRangeOpen(false)}
      />

      <NewClearoutSheet
        visible={createOpen}
        creating={creating}
        onClose={() => setCreateOpen(false)}
        onSubmit={handleCreate}
      />

      {/* Selection action pill — floats in the navigator's spot on long-press
          (the tab bar hides while selecting). Bulk pause / delete. */}
      {selectMode ? (
        <View style={[styles.selectBar, isNight && styles.selectBarNight, { bottom: Math.max(18, insets.bottom) }]}>
          <TouchableOpacity
            style={[styles.selectCancel, isNight && styles.selectCancelNight]}
            onPress={exitSelect}
            activeOpacity={0.7}
          >
            <Icon name="close" size={18} color={isNight ? '#E4E4E7' : '#52525B'} />
          </TouchableOpacity>
          <Text style={[styles.selectCount, isNight && styles.selectCountNight]}>
            {selectedIds.size} selected
          </Text>
          <View style={styles.selectActions}>
            <TouchableOpacity
              style={[styles.selectAction, isNight && styles.selectActionNight, selectedIds.size === 0 && styles.selectActionDisabled]}
              onPress={pauseSelected}
              disabled={selectedIds.size === 0}
              activeOpacity={0.8}
            >
              <Icon name="pause" size={16} color={isNight ? '#E4E4E7' : '#3F3F46'} />
              <Text style={[styles.selectActionText, isNight && styles.selectActionTextNight]}>Pause</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.selectAction, styles.selectActionDanger, selectedIds.size === 0 && styles.selectActionDisabled]}
              onPress={deleteSelected}
              disabled={selectedIds.size === 0}
              activeOpacity={0.8}
            >
              <Icon name="trash-can-outline" size={16} color="#FFFFFF" />
              <Text style={[styles.selectActionText, styles.selectActionDangerText]}>Delete</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}
    </View>
  );
};

// ── Campaign card ────────────────────────────────────────────────────────
const CampaignCard: React.FC<{
  campaign: CardCampaign;
  onPress: () => void;
  onLongPress?: () => void;
  selectMode?: boolean;
  selected?: boolean;
  isNight?: boolean;
}> = React.memo(({ campaign, onPress, onLongPress, selectMode, selected, isNight }) => {
  const sold = campaign.stats?.soldCount || 0;
  const total = campaign.stats?.totalCount || 0;
  const negotiating = campaign.stats?.negotiating || 0;
  const progress = total > 0 ? Math.min(1, sold / total) : 0;
  const percent = Math.round(progress * 100);

  // Goal bar fills by dollars when we have them, else by items sold.
  const hasDollars = campaign.raised != null && campaign.goal != null && campaign.goal > 0;
  const goalPct = hasDollars
    ? Math.min(100, Math.round((campaign.raised! / campaign.goal!) * 100))
    : percent;

  const daysLeft = useMemo(() => {
    if (!campaign.timeframeDays) return null;
    const created = new Date(campaign.createdAt).getTime();
    if (Number.isNaN(created)) return null;
    const elapsed = (Date.now() - created) / (24 * 60 * 60 * 1000);
    return Math.max(0, Math.ceil(campaign.timeframeDays - elapsed));
  }, [campaign.createdAt, campaign.timeframeDays]);

  // When the agent next wakes to check this campaign — shown on the Running pill so
  // the seller knows it's actively watched and when the next pass lands.
  const nextCheckLabel = useMemo(() => {
    if (!campaign.nextWakeAt) return null;
    const ms = new Date(campaign.nextWakeAt).getTime() - Date.now();
    if (Number.isNaN(ms)) return null;
    if (ms <= 60_000) return 'checking now';
    const mins = Math.round(ms / 60000);
    if (mins < 60) return `next check ${mins}m`;
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return `next check ${hrs}h`;
    return `next check ${Math.round(hrs / 24)}d`;
  }, [campaign.nextWakeAt]);

  // Completed cards keep the LIGHT card skin at half opacity in both modes —
  // per the mockup they read as receipts, not live surfaces.
  const isCompleted = campaign.status === 'completed';

  const statusPill =
    campaign.status === 'paused'
      ? isNight
        ? { text: 'Paused', bg: 'rgba(162,97,26,0.22)', fg: '#E8B380' }
        : { text: 'Paused', bg: '#FBEAD2', fg: '#A2611A' }
      : campaign.status === 'waiting_user'
        ? isNight
          ? { text: 'Needs you', bg: 'rgba(31,95,168,0.28)', fg: '#9CC4F0' }
          : { text: 'Needs you', bg: '#DCEBFB', fg: '#1F5FA8' }
        : isNight
          ? { text: nextCheckLabel || 'Running', bg: 'rgba(147,200,34,0.18)', fg: '#C9E588' }
          : { text: nextCheckLabel || 'Running', bg: '#EAF7CF', fg: '#4E6B12' };

  // First campaign item's image (backend list enrichment); green leaf fallback.
  const thumbUrl = campaign.imageUrl;

  const titleColor = isCompleted ? '#09090B' : isNight ? '#FFFFFF' : '#000000';
  const subColor = isCompleted ? '#666666' : isNight ? '#71717A' : '#666666';
  // Days badge: solid green by day, muted olive on the dark night card.
  const daysBadgeBg = isCompleted ? '#7F7F7F' : isNight ? '#494B44' : '#93C822';
  // Pending pill: amber by day, muted olive at night (matches mockup variants).
  const pendingBg = isNight ? '#494B44' : '#A56300';
  // Green pill frame + fill (Figma 4607:2327/2328). The pill floats on the card
  // surface; the ticks are a separate gray strip to its right (no track behind).
  // At 0% the pill reads gray (nothing raised yet) rather than a misleading green.
  const goalBorder = goalPct === 0 ? '#666' : isCompleted ? '#6BA03A' : '#3A5A24';
  const goalFillBg = goalPct === 0 ? '#999' : isCompleted ? '#95BF46' : '#7BB304';
  const tickColor = isCompleted ? '#D9D9D9' : isNight ? '#585858' : '#D4D4D4';

  return (
    <TouchableOpacity
      style={[
        styles.card,
        isCompleted ? styles.cardCompleted : isNight ? styles.cardNight : styles.cardDay,
        isCompleted && { opacity: 0.55 },
        selected && styles.cardSelected,
      ]}
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={280}
      activeOpacity={0.92}
    >
      {selectMode ? (
        <View style={[styles.selectDot, selected && styles.selectDotOn]}>
          {selected ? <Icon name="check" size={14} color="#FFFFFF" /> : null}
        </View>
      ) : null}
      <View style={styles.cardHeader}>
        <View style={[styles.cardThumb, isNight && !isCompleted && styles.cardThumbNight]}>
          {thumbUrl ? (
            <Image source={{ uri: thumbUrl }} style={styles.cardThumbImage} />
          ) : (
            <Icon name="leaf" size={20} color={BRAND} />
          )}
        </View>
        <View style={styles.cardHeaderText}>
          <Text style={[styles.cardTitle, { color: titleColor }]} numberOfLines={1}>
            {campaign.title}
          </Text>
          <View style={styles.cardMetaRow}>
            {isCompleted ? (
              <View style={[styles.daysBadge, { backgroundColor: daysBadgeBg }]}>
                <Text style={styles.daysBadgeText}>Completed</Text>
              </View>
            ) : daysLeft !== null ? (
              <View style={[styles.daysBadge, { backgroundColor: daysBadgeBg }]}>
                <Text style={styles.daysBadgeText}>{daysLeft}d Left</Text>
              </View>
            ) : null}
            <Text style={[styles.cardSubMeta, { color: subColor }]}>
              {' - '}{sold}/{total} sold
            </Text>
          </View>
        </View>
        {isCompleted ? (
          <Text style={styles.percentText}>
            {percent}%<Text style={styles.percentDim}>/100%</Text>
          </Text>
        ) : negotiating > 0 ? (
          <View style={[styles.pendingBadge, { backgroundColor: pendingBg }]}>
            <View style={styles.pendingBadgeCircle}>
              <Text style={[styles.pendingBadgeCount, { color: pendingBg }]}>{negotiating}</Text>
            </View>
            <Text style={styles.pendingBadgeText}>Pending Offers</Text>
          </View>
        ) : (
          <View style={[styles.statusPill, { backgroundColor: statusPill.bg }]}>
            <Text style={[styles.statusPillText, { color: statusPill.fg }]}>{statusPill.text}</Text>
          </View>
        )}
      </View>

      {/* Goal bar: the green pill (with its label) on the left grows by sold %, and
          the gray ticks sit OUTSIDE it to the right, filling the remainder and
          shrinking as the pill grows. */}
      <View style={styles.goalRow}>
        <View style={[styles.goalFill, { width: `${goalPct}%`, backgroundColor: goalFillBg, borderColor: goalBorder }]}>
          <Text style={styles.goalLabel} numberOfLines={1}>
            {hasDollars ? currency(campaign.raised!) : `${goalPct}%`}
          </Text>
        </View>
        <View style={styles.tickRow} pointerEvents="none">
          {Array.from({ length: 28 }).map((_, i) => (
            <View key={i} style={[styles.tick, { backgroundColor: tickColor }]} />
          ))}
        </View>
      </View>
    </TouchableOpacity>
  );
});

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#F6F7F4' },

  // ── Long-press selection ──────────────────────────────
  cardSelected: {
    borderWidth: 2,
    borderColor: BRAND,
  },
  selectDot: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: '#C4C4CC',
    backgroundColor: 'rgba(255,255,255,0.85)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 5,
  },
  selectDotOn: {
    borderColor: BRAND,
    backgroundColor: BRAND,
  },
  // Floats in the navigator's spot (rounded on all sides, detached from the
  // edges) — not a full-width bottom sheet. `bottom` is set inline to match the
  // tab bar's safe-area offset.
  selectBar: {
    position: 'absolute',
    left: 16,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: '#FFFFFF',
    borderRadius: 28,
    borderWidth: 1.5,
    borderColor: 'rgba(0, 0, 0, 0.07)',
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 8 },
    elevation: 24,
  },
  selectBarNight: {
    backgroundColor: 'rgba(28, 30, 24, 0.94)',
    borderColor: 'rgba(255, 255, 255, 0.10)',
  },
  selectCancel: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F1F1EE',
  },
  selectCancelNight: {
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
  },
  selectCount: {
    flex: 1,
    fontSize: 14,
    color: '#18181B',
    fontFamily: 'Inter_600SemiBold',
  },
  selectCountNight: {
    color: '#F4F4EE',
  },
  selectActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  selectAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 14,
    backgroundColor: '#F1F1EE',
  },
  selectActionNight: {
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
  },
  selectActionText: {
    fontSize: 13,
    color: '#3F3F46',
    fontFamily: 'Inter_600SemiBold',
  },
  selectActionTextNight: {
    color: '#E4E4E7',
  },
  selectActionDanger: {
    backgroundColor: '#DC2626',
  },
  selectActionDangerText: {
    color: '#FFFFFF',
  },
  selectActionDisabled: {
    opacity: 0.45,
  },

  // Static header: edge-to-edge, rounded bottom; the list scrolls beneath it.
  header: {
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
    overflow: 'hidden',
    paddingBottom: 14,
    zIndex: 10,
  },
  scroll: { flex: 1 },
  topBarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 4,
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
  overviewText: { color: '#27272A', fontFamily: FONT.semibold, fontSize: 15 },
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
    borderRadius: 18,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  newBtnText: { color: '#FFFFFF', fontFamily: FONT.medium, fontSize: 14 },
  topBarActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  iconPill: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },

  // Hero (themed)
  hero: { paddingHorizontal: 18, paddingTop: 6, paddingBottom: 16 },
  greetingRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  greeting: { flexShrink: 1, fontFamily: FONT.semibold, fontSize: 17 },

  // Sprout message — frames the briefing as a message from the agent.
  sproutMsg: { marginBottom: 4 },
  sproutHead: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 8 },
  sproutAvatar: {
    width: 22, height: 22, borderRadius: 11, backgroundColor: BRAND,
    alignItems: 'center', justifyContent: 'center',
  },
  sproutName: { fontFamily: FONT.semibold, fontSize: 14 },
  sproutTime: { fontFamily: FONT.medium, fontSize: 13, marginLeft: 2 },
  sproutLead: { fontFamily: FONT.semibold, fontSize: 17, lineHeight: 24, marginBottom: 4 },

  briefingHeadline: { fontFamily: FONT.semibold, fontSize: 17, marginBottom: 10, lineHeight: 25 },
  briefingProse: { fontSize: 17, lineHeight: 25, marginTop: 1 },
  // Nutrition-summary style: values become inline pill-chips in a flowing row.
  briefingWrap: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', marginTop: 2 },
  briefingWord: { fontSize: 17, lineHeight: 28, fontFamily: FONT.regular },
  briefingChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.16)',
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 2,
    marginRight: 5,
    marginVertical: 2,
  },
  briefingChipText: { fontSize: 16, fontFamily: FONT.semibold },
  nextReport: { fontSize: 13, marginTop: 8, fontFamily: FONT.semibold },

  // ── Ledger + report card (Figma 4746:3113 hero) ──────────────────────────
  leadRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  ledger: { marginTop: 8, gap: 14 },
  ledgerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  ledgerLabel: { fontSize: 18, lineHeight: 20, fontFamily: FONT.medium, flexShrink: 1, marginRight: 12 },
  ledgerStatus: { fontSize: 18, lineHeight: 20, fontFamily: FONT.medium },
  reportCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.2)',
    borderWidth: 1.5,
    borderColor: 'rgba(0,0,0,0.25)',
    borderRadius: 16,
    paddingVertical: 12,
    paddingLeft: 14,
    paddingRight: 12,
    marginTop: 14,
    gap: 12,
  },
  reportIconWrap: { transform: [{ rotate: '-7deg' }] },
  reportIconChip: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.32)',
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 9,
  },
  reportTextCol: { flex: 1, gap: 3 },
  reportTitle: { fontFamily: FONT.medium, fontSize: 16, lineHeight: 18, color: '#FFFFFF' },
  reportSub: { fontFamily: FONT.medium, fontSize: 14, lineHeight: 16, color: '#F4F4F5' },
  reportChip: {
    backgroundColor: 'rgba(244,244,245,0.2)',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.25)',
    borderRadius: 20,
    height: 32,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reportChipText: { fontFamily: FONT.semibold, fontSize: 14, color: '#FFFFFF' },
  eventRows: { marginBottom: 14, gap: 10 },
  eventRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  eventLabel: { fontSize: 17, fontFamily: FONT.medium },
  eventTime: { fontSize: 17, fontFamily: FONT.medium },

  dashedDivider: {
    marginTop: 18,
    marginBottom: 16,
    borderBottomWidth: 1,
    borderColor: 'rgba(0,0,0,0.08)',
    borderStyle: 'dashed',
  },

  statsRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  salesToday: { fontFamily: FONT.semibold, fontSize: 17 },
  salesDelta: { fontFamily: FONT.semibold, fontSize: 17 },

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
  rangeChipText: { color: '#9CA3AF', fontFamily: FONT.semibold, fontSize: 12 },

  // Body
  body: { paddingHorizontal: 16, paddingTop: 18 },
  filterRow: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  filterChip: { borderRadius: 12, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 7, backgroundColor: '#EBEDE7' },
  filterChipText: { fontFamily: FONT.medium, fontSize: 14, lineHeight: 18 },

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
  emptyCardNight: {
    backgroundColor: '#22271C',
    borderColor: '#333333',
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

  // Card (anorha mockup: radius 18, 2px border, header row + bordered goal bar)
  card: {
    borderRadius: 18,
    borderWidth: 2,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  cardDay: { backgroundColor: '#FFFFFF', borderColor: '#E4E4E7' },
  cardNight: { backgroundColor: '#22271C', borderColor: '#333333', shadowOpacity: 0.18 },
  cardCompleted: { backgroundColor: '#FBFBFB', borderColor: '#E4E4E7' },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 15,
    paddingVertical: 12,
  },
  cardThumb: {
    width: 42,
    height: 42,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: 'rgba(217,217,217,0.5)',
    backgroundColor: 'rgba(147,200,34,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  cardThumbNight: { backgroundColor: 'rgba(153,153,153,0.35)' },
  cardThumbImage: { width: 42, height: 42, borderRadius: 4 },
  cardHeaderText: { flex: 1 },
  cardTitle: { color: '#18181B', fontFamily: FONT.medium, fontSize: 16, lineHeight: 20, marginBottom: 5 },
  cardMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  daysBadge: { backgroundColor: '#494B44', borderRadius: 4, paddingHorizontal: 9, paddingVertical: 2 },
  daysBadgeText: { color: '#FFFFFF', fontFamily: FONT.medium, fontSize: 13 },
  cardSubMeta: { color: '#71717A', fontFamily: FONT.medium, fontSize: 14 },

  percentText: { color: '#09090B', fontFamily: FONT.medium, fontSize: 14 },
  percentDim: { color: '#71717A', fontFamily: FONT.regular },

  pendingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#8A5A18',
    borderRadius: 12,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  pendingBadgeCircle: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pendingBadgeCount: { fontFamily: FONT.semibold, fontSize: 13 },
  pendingBadgeText: { color: '#FFFFFF', fontFamily: FONT.medium, fontSize: 13 },

  statusPill: { borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4 },
  statusPillText: { fontFamily: FONT.medium, fontSize: 13 },

  goalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 15,
    paddingBottom: 16,
  },
  // Green "button" pill on the card surface: grows by sold %, label inside, green
  // border. minWidth keeps the label legible at 0%. Width is set inline.
  goalFill: {
    minWidth: 56,
    height: 40,
    borderRadius: 9,
    borderWidth: 1.5,
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  goalLabel: { color: '#FFFFFF', fontFamily: FONT.medium, fontSize: 14, lineHeight: 20 },
  // Gray ticks = the empty remainder, OUTSIDE the pill to its right; flex:1 fills the
  // leftover space and shrinks as the pill grows.
  tickRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 35,
  },
  tick: { width: 3, height: 24, borderRadius: 1.5 },

  completedHeader: { marginTop: 8, marginBottom: 12, gap: 10 },
  completedLabel: { color: '#71717A', fontFamily: FONT.medium, fontSize: 14, letterSpacing: 0.4 },
  completedDivider: { height: 2, backgroundColor: '#E4E4E7' },

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
