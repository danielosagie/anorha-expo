import React, { useState, useEffect, useCallback } from 'react';
import { BRAND_PRIMARY } from '../design/tokens';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  Linking,
  Modal,
  TextInput,
  Alert,
  Animated,
  AppState,
  StatusBar,
  Platform,
} from 'react-native';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { ChevronRight, RefreshCw } from 'lucide-react-native';
import { useAuth } from '@clerk/expo';
import PageHeader from '../components/ui/PageHeader';
import TierSelectorModal from '../components/TierSelectorModal';
import { API_BASE_URL } from '../config/env';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { capture, AnalyticsEvents } from '../lib/analytics';
import { ApiError, apiJson } from '../lib/apiClient';
import { openBillingUrl, withMobileReturn } from '../lib/billingReturn';
import { decideTopUpPoll } from '../lib/topUpPolling';
import { billingCheckoutFeedback, decideBillingBrowserOutcome } from '../lib/billingCheckoutOutcome';
import {
  deriveBillingState,
  formatBillingDate,
  formatBillingTimestamp,
  isCheckoutBlocked,
} from '../utils/billingState';
import {
  getInvoiceReceiptUrl,
  parseBillingInvoicesResponse,
  parseBillingSummaryPayload,
  parsePartnerPaymentMethodResponse,
  parseUpcomingInvoiceResponse,
  type BillingInvoicePayload,
  type BillingPayloadResult,
  type BillingSummaryPayload,
  type PartnerPaymentMethodPayload,
  type UpcomingInvoicePayload,
} from '../utils/billingPayload';
import { createLogger } from '../utils/logger';
const log = createLogger('BillingScreen');


const API_BASE_RAW = API_BASE_URL;
const API_BASE = API_BASE_RAW.replace(/\/$/, '').endsWith('/api')
  ? API_BASE_RAW.replace(/\/$/, '')
  : `${API_BASE_RAW.replace(/\/$/, '')}/api`;

const ANORHA_GREEN = BRAND_PRIMARY;
const WHITE_BG = '#FFFFFF';
const TOP_UP_POLL_INTERVAL_MS = 2_000;
const TOP_UP_POLL_TIMEOUT_MS = 30_000;
const TOP_UP_SUMMARY_REQUEST_TIMEOUT_MS = 5_000;

type BillingResourceStatus = 'loading' | 'ready' | 'error';
type TopUpPhase = 'idle' | 'starting' | 'waiting';
type TopUpFeedback =
  | { kind: 'confirmed'; amountCents: number; animationKey: number }
  | { kind: 'cancelled' }
  | { kind: 'could_not_verify' };
type TopUpCheckoutSession = {
  url: string;
  snapshot: BillingSummaryPayload | null;
  amountCents: number;
  runId: number;
};

function formatCurrency(value: number, currency = 'USD'): string {
  return value.toLocaleString('en-US', { style: 'currency', currency });
}

async function fetchBillingResource<T>(
  url: string,
  headers: Record<string, string>,
  parse: (payload: unknown) => BillingPayloadResult<T>,
): Promise<BillingPayloadResult<T>> {
  try {
    const response = await fetch(url, { headers });
    if (!response.ok) return { ok: false, field: `http.${response.status}` };
    return parse(await response.json());
  } catch {
    return { ok: false, field: 'request' };
  }
}

function formatTopUpAmount(cents: number): string {
  return cents % 100 === 0 ? `$${cents / 100}` : formatCurrency(cents / 100);
}

const wait = (milliseconds: number) =>
  new Promise<void>(resolve => setTimeout(resolve, milliseconds));

// Raw usage keys → plain-English, transparent labels. Deliberately contains NO internal
// tool/vendor names (model providers, search/scrape services, …) so none can be recovered
// from the shipped bundle. Unknown keys are bucketed by generic intent words below, and the
// raw key is never humanized into the UI (it could carry an internal name).
const FEATURE_LABELS: Record<string, string> = {
  ai_quick_scan: 'Photo scans',
  product_photo_scan: 'Photo scans',
  ai_recognize_match: 'Product matching',
  auto_match: 'Product matching',
  auto_match_products: 'Product matching',
  product_search: 'Product matching',
  ebay_pricing_research: 'Price research',
  ebay_pricing: 'Price research',
  ai_text_generation: 'Listing details',
  web_research: 'Web research',
  ai_shipping_vision: 'Shipping estimates',
  shipping_vision: 'Shipping estimates',
  ai_insight_generation: 'Business insights',
  ai_receipt_parsing: 'Receipt scans',
  ai_manifest_analysis: 'Manifest scans',
  ai_liquidation_research: 'Clearout research',
  sync: 'Inventory sync',
  import: 'Product imports',
  export: 'Product exports',
};

function getFeatureDisplayName(key: string): string {
  const norm = String(key || '').toLowerCase().trim();
  if (FEATURE_LABELS[norm]) return FEATURE_LABELS[norm];
  // Unknown keys are bucketed by generic intent (no tool/vendor names), so nothing internal leaks.
  if (/ship/.test(norm)) return 'Shipping estimates'; // before vision: "shipping_vision_*" is shipping
  if (/(scrape|crawl|web|research|search)/.test(norm)) return 'Web research';
  if (/(generat|text|writ|caption)/.test(norm)) return 'Listing details';
  if (/(vision|photo|scan|image)/.test(norm)) return 'Photo scans';
  if (/(match|recogni)/.test(norm)) return 'Product matching';
  if (/(pric|comp)/.test(norm)) return 'Price research';
  if (/(sync|import|export|inventory)/.test(norm)) return 'Inventory sync';
  if (/insight/.test(norm)) return 'Business insights';
  if (/receipt/.test(norm)) return 'Receipt scans';
  if (/manifest/.test(norm)) return 'Manifest scans';
  if (/(liquidat|clearout)/.test(norm)) return 'Clearout research';
  // Never humanize the raw key (it may carry an internal name). Use a generic label instead.
  return 'AI usage';
}

const HealthBar = ({ used, limit, fillColor }: { used: number, limit: number, fillColor: string }) => {
  const fillAnim = React.useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    const percentage = limit > 0 ? Math.min(100, (used / limit) * 100) : 0;
    Animated.timing(fillAnim, {
      toValue: percentage,
      duration: 1000,
      useNativeDriver: false,
    }).start();
  }, [used, limit]);

  return (
    <View style={styles.progressTrack}>
      <Animated.View style={[
        styles.progressFill,
        {
          backgroundColor: fillColor,
          width: fillAnim.interpolate({
            inputRange: [0, 100],
            outputRange: ['0%', '100%']
          })
        }
      ]} />
    </View>
  );
};

const SegmentedCreditBar = ({
  total,
  planTotal,
  used,
  remaining,
  topupRemaining,
  topupTotal,
  animationKey,
}: {
  total: number;
  planTotal: number;
  used: number;
  remaining: number;
  topupRemaining: number;
  topupTotal: number;
  animationKey?: number;
}) => {
  const confirmationAnim = React.useRef(new Animated.Value(1)).current;
  const safeTotal = Math.max(0, total);
  const safeUsed = Math.min(safeTotal, Math.max(0, used));
  const safeRemaining = Math.min(safeTotal - safeUsed, Math.max(0, remaining));
  const safeTopupRemaining = Math.min(
    safeRemaining,
    Math.max(0, topupTotal),
    Math.max(0, topupRemaining),
  );
  const safePlanRemaining = Math.min(
    Math.max(0, planTotal),
    Math.max(0, safeRemaining - safeTopupRemaining),
  );
  const unaccounted = Math.max(
    0,
    safeTotal - safeUsed - safePlanRemaining - safeTopupRemaining,
  );

  React.useEffect(() => {
    if (animationKey === undefined) return;
    confirmationAnim.setValue(0.6);
    Animated.timing(confirmationAnim, {
      toValue: 1,
      duration: 700,
      useNativeDriver: true,
    }).start();
  }, [animationKey, confirmationAnim]);

  return (
    <View style={[styles.progressTrack, styles.segmentedCreditTrack]}>
      {safeUsed > 0 ? (
        <View style={[styles.creditSegment, styles.creditUsed, { flexGrow: safeUsed }]} />
      ) : null}
      {safePlanRemaining > 0 ? (
        <View style={[styles.creditSegment, styles.creditPlan, { flexGrow: safePlanRemaining }]} />
      ) : null}
      {safeTopupRemaining > 0 ? (
        <Animated.View
          style={[
            styles.creditSegment,
            styles.creditTopup,
            { flexGrow: safeTopupRemaining },
            animationKey === undefined
              ? null
              : {
                  opacity: confirmationAnim,
                  transform: [{ scaleX: confirmationAnim }],
                },
          ]}
        />
      ) : null}
      {unaccounted > 0 ? (
        <View style={[styles.creditSegment, { flexGrow: unaccounted }]} />
      ) : null}
    </View>
  );
};

const BillingMessageCard = ({ label }: { label: string }) => (
  <View style={styles.cardGroup}>
    <View style={styles.listItem}>
      <Text style={styles.listSubValue}>{label}</Text>
    </View>
  </View>
);

export default function BillingScreen() {
  const navigation = useNavigation();
  const route = useRoute<any>();
  const { getToken } = useAuth();
  // Clerk's getToken can be a new function each render (see App.tsx getClerkToken).
  // Read it through a ref so refreshBillingData keeps a stable identity: with the raw
  // getToken in its deps, the useFocusEffect below re-fired on EVERY render while
  // focused, and its setIsRefreshing(true) caused that render, hanging the JS thread
  // in an unbounded effect/render/network loop (the frozen-app bug).
  const getTokenRef = React.useRef(getToken);
  getTokenRef.current = getToken;
  const insets = useSafeAreaInsets();

  const [summary, setSummary] = useState<BillingSummaryPayload | null>(null);
  const [summaryStatus, setSummaryStatus] = useState<BillingResourceStatus>('loading');
  const [invoices, setInvoices] = useState<BillingInvoicePayload[]>([]);
  const [invoicesStatus, setInvoicesStatus] = useState<BillingResourceStatus>('loading');
  const [upcoming, setUpcoming] = useState<UpcomingInvoicePayload | null>(null);
  const [upcomingStatus, setUpcomingStatus] = useState<BillingResourceStatus>('loading');
  const [partnerPaymentMethod, setPartnerPaymentMethod] = useState<PartnerPaymentMethodPayload | null>(null);
  const [userRole, setUserRole] = useState<'owner' | 'employee' | 'partner' | 'org:admin' | undefined>(undefined);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [isBillingActionLoading, setIsBillingActionLoading] = useState(false);
  const [showTierSelector, setShowTierSelector] = useState(false);
  const [showCreditsModal, setShowCreditsModal] = useState(false);
  const [selectedCreditAmount, setSelectedCreditAmount] = useState<number | null>(50);
  const [topUpPhase, setTopUpPhase] = useState<TopUpPhase>('idle');
  const [topUpFeedback, setTopUpFeedback] = useState<TopUpFeedback | null>(null);
  const [isAddingPaymentMethod, setIsAddingPaymentMethod] = useState(false);
  const topUpLockedRef = React.useRef(false);
  const topUpRunIdRef = React.useRef(0);
  const pendingCheckoutRef = React.useRef<TopUpCheckoutSession | null>(null);
  const processingCheckoutRef = React.useRef<{
    snapshot: BillingSummaryPayload;
    amountCents: number;
  } | null>(null);

  const isPartner = userRole === 'partner';
  const hasSummaryData = summaryStatus === 'ready' && summary !== null;
  const isTopUpBusy = topUpPhase !== 'idle';
  const topUpTruthFeedback = topUpFeedback && topUpFeedback.kind !== 'confirmed'
    ? billingCheckoutFeedback(topUpFeedback.kind)
    : null;

  const refreshBillingData = useCallback(async () => {
    setIsRefreshing(true);
    setActionError(null);
    try {
      const token = await getTokenRef.current();
      if (!token) {
        log.error('No auth token available');
        setSummary(null);
        setSummaryStatus('error');
        setInvoices([]);
        setInvoicesStatus('error');
        setUpcoming(null);
        setUpcomingStatus('error');
        return;
      }
      const headers = {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      };

      const [summaryResult, invoicesResult, upcomingResult, partnerPaymentResult] = await Promise.all([
        fetchBillingResource(`${API_BASE}/billing/summary`, headers, parseBillingSummaryPayload),
        fetchBillingResource(`${API_BASE}/billing/invoices?limit=12`, headers, parseBillingInvoicesResponse),
        fetchBillingResource(`${API_BASE}/billing/upcoming`, headers, parseUpcomingInvoiceResponse),
        isPartner
          ? fetchBillingResource(
              `${API_BASE}/billing/partner/payment-method`,
              headers,
              parsePartnerPaymentMethodResponse,
            )
          : Promise.resolve(null),
      ]);

      if (summaryResult.ok) {
        const newSummary = summaryResult.value;
        setSummary(newSummary);
        setSummaryStatus('ready');
        const processingCheckout = processingCheckoutRef.current;
        if (processingCheckout
          && decideTopUpPoll(processingCheckout.snapshot, newSummary) === 'confirmed') {
          processingCheckoutRef.current = null;
          setTopUpFeedback({
            kind: 'confirmed',
            amountCents: processingCheckout.amountCents,
            animationKey: Date.now(),
          });
        }
      } else {
        log.error(`Billing summary unavailable at ${summaryResult.field}`);
        setSummary(null);
        setSummaryStatus('error');
      }
      if (invoicesResult.ok) {
        setInvoices(invoicesResult.value);
        setInvoicesStatus('ready');
      } else {
        log.error(`Billing invoices unavailable at ${invoicesResult.field}`);
        setInvoices([]);
        setInvoicesStatus('error');
      }
      if (upcomingResult.ok) {
        setUpcoming(upcomingResult.value);
        setUpcomingStatus('ready');
      } else {
        log.error(`Upcoming invoice unavailable at ${upcomingResult.field}`);
        setUpcoming(null);
        setUpcomingStatus('error');
      }
      if (partnerPaymentResult?.ok) {
        setPartnerPaymentMethod(partnerPaymentResult.value);
      } else if (partnerPaymentResult) {
        log.error(`Partner payment method unavailable at ${partnerPaymentResult.field}`);
        setPartnerPaymentMethod(null);
        setActionError('Payment unavailable.');
      }
    } catch (error) {
      log.error('Failed to refresh billing data:', error);
      setSummary(null);
      setSummaryStatus('error');
      setInvoices([]);
      setInvoicesStatus('error');
      setUpcoming(null);
      setUpcomingStatus('error');
    } finally {
      setIsRefreshing(false);
    }
  }, [isPartner]);

  useFocusEffect(useCallback(() => {
    void refreshBillingData();
  }, [refreshBillingData]));

  // BillingGateSheet's "Add credits" lands here with addCredits set.
  useEffect(() => {
    if (route?.params?.addCredits) {
      setShowCreditsModal(true);
      (navigation as any).setParams?.({ addCredits: undefined });
    }
  }, [route?.params?.addCredits]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') refreshBillingData();
    });
    return () => sub.remove();
  }, [refreshBillingData]);

  useEffect(() => () => {
    topUpRunIdRef.current += 1;
    topUpLockedRef.current = false;
  }, []);

  const planFromSummary =
    summary?.subscription?.CurrentPlan || summary?.subscription?.current_plan;
  const planName = (planFromSummary as 'Growth' | 'Teams' | undefined) || undefined;
  const billingState = deriveBillingState(summary, new Date());

  const computeAllowanceCents = summary?.ai_credits_cents
    ?? summary?.compute_allowance_cents
    ?? summary?.ai_allowance_cents
    ?? 0;
  const teamMembersCount = summary?.team_members_count ?? 0;
  const teamMembersIncluded = summary?.team_members_included ?? 0;
  const teamMembersExtra = Math.max(0, summary?.team_members_extra ?? 0);
  const teamMembersCost = summary?.team_members_cost ?? 0;

  const planTitle = summary?.subscription === null
    ? 'No active plan'
    : planName || 'Plan details';
  const aiOverageCents = summary?.ai_overage_cents ?? 0;
  const basePrice = Math.max(0, (summary?.total_cost_cents ?? 0) - aiOverageCents) / 100;

  const featureEntries = Object.entries(summary?.usage ?? {});
  // Group by the friendly label (always derived from the key, never the backend's raw
  // displayName) so vendor names can't leak and synonyms collapse into one clean line.
  const usageHistoryEntries = Object.values(
    featureEntries.reduce((acc, [key, value]) => {
      const totalCostCents = value.totalCost;
      const internalCostCents = value.internalCost;
      const totalQuantity = value.totalQuantity;
      if (totalCostCents <= 0 && totalQuantity <= 0) return acc;
      const displayName = getFeatureDisplayName(key);
      const existing = acc[displayName];
      if (existing) {
        existing.totalCostCents += totalCostCents;
        existing.internalCostCents += internalCostCents;
        existing.totalQuantity += totalQuantity;
      } else {
        acc[displayName] = { key: displayName, displayName, totalCostCents, internalCostCents, totalQuantity };
      }
      return acc;
    }, {} as Record<string, { key: string; displayName: string; totalCostCents: number; internalCostCents: number; totalQuantity: number }>)
  ).sort((a, b) => b.internalCostCents - a.internalCostCents);

  const computeUsedCents = summary?.compute_used_cents ?? 0;
  const computeUsagePercent = computeAllowanceCents > 0
    ? Math.max(0, Math.round((computeUsedCents / computeAllowanceCents) * 100))
    : 0;
  const creditBalance = summary?.ai_credits_cents !== undefined
    && summary.ai_allowance_cents !== undefined
    && summary.ai_used_cents !== undefined
    && summary.ai_remaining_cents !== undefined
    && summary.ai_topup_remaining_cents !== undefined
    && summary.ai_topup_total_cents !== undefined
    ? {
        total: summary.ai_credits_cents,
        planTotal: summary.ai_allowance_cents,
        used: summary.ai_used_cents,
        remaining: summary.ai_remaining_cents,
        topupRemaining: summary.ai_topup_remaining_cents,
        topupTotal: summary.ai_topup_total_cents,
      }
    : null;
  const aiOverageDollars = aiOverageCents / 100;
  const totalCostEstimate = ((summary?.total_cost_cents ?? 0) / 100) + teamMembersCost;
  const hasCostBreakdown = basePrice > 0 || teamMembersCost > 0 || aiOverageDollars > 0;

  const openBillingSupport = () => {
    (navigation as any).navigate('BillingSupport', {
      context: {
        planName: planName || 'Unknown',
        subscriptionStatus: billingState.subscription.state,
        aiAllowanceCents: computeAllowanceCents,
        aiUsedCents: computeUsedCents,
      },
    });
  };

  const handleManageSubscription = async () => {
    setActionError(null);
    setActionNotice(null);
    setIsBillingActionLoading(true);
    try {
      const data = await apiJson<{
        action?: string;
        url?: string | null;
      }>('/api/billing/portal', {
        method: 'POST',
      });
      if (data?.action === 'contact_support') {
        openBillingSupport();
        return;
      }
      if (data?.action === 'manage' && data?.url) {
        capture(AnalyticsEvents.BILLING_PORTAL_OPENED);
        await openBillingUrl(data.url);
        await refreshBillingData();
      } else {
        setActionError('Management unavailable.');
      }
    } catch (error) {
      if (error instanceof ApiError && error.body?.action === 'contact_support') {
        openBillingSupport();
        return;
      }
      log.error('Failed to open portal:', error);
      setActionError(error instanceof ApiError && error.body?.error === 'entitlement_not_found'
        ? 'No billing record.'
        : 'Management unavailable.');
    } finally {
      setIsBillingActionLoading(false);
    }
  };

  const cancelBillingSubscription = async () => {
    setActionError(null);
    setActionNotice(null);
    setIsBillingActionLoading(true);
    try {
      const data = await apiJson<{
        action?: string;
        url?: string | null;
        status?: string | null;
        currentPeriodEnd?: string | null;
      }>('/api/billing/cancel', {
        method: 'POST',
      });
      if (data?.action === 'contact_support') {
        openBillingSupport();
        return;
      }
      if (data?.action === 'manage' && data?.url) {
        await openBillingUrl(data.url);
        await refreshBillingData();
        return;
      }
      if (data?.action === 'canceled') {
        const paidThrough = formatBillingDate(data.currentPeriodEnd || null);
        const rawStatus = typeof data.status === 'string' ? data.status.replace(/_/g, ' ') : 'canceled';
        const statusLabel = rawStatus.charAt(0).toUpperCase() + rawStatus.slice(1);
        setActionNotice(paidThrough
          ? `${statusLabel}. Paid through ${paidThrough}.`
          : `${statusLabel}.`);
        await refreshBillingData();
        return;
      }
      setActionError('Cancellation unavailable.');
    } catch (error) {
      if (error instanceof ApiError && error.body?.action === 'contact_support') {
        openBillingSupport();
        return;
      }
      log.error('Failed to cancel subscription:', error);
      setActionError(error instanceof ApiError && error.body?.error === 'entitlement_not_found'
        ? 'No billing record.'
        : 'Cancellation unavailable.');
    } finally {
      setIsBillingActionLoading(false);
    }
  };

  const handleCancelSubscription = () => {
    Alert.alert('Cancel plan', 'Cancel this plan?', [
      { text: 'Keep plan', style: 'cancel' },
      { text: 'Continue', style: 'destructive', onPress: () => void cancelBillingSubscription() },
    ]);
  };

  const handleAddPartnerPaymentMethod = async () => {
    setIsAddingPaymentMethod(true);
    try {
      const token = await getTokenRef.current();
      if (!token) return;
      const response = await fetch(`${API_BASE}/billing/partner/payment-method`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      });
      if (response.ok) {
        const data = await response.json();
        if (data.checkoutUrl) await Linking.openURL(data.checkoutUrl);
      }
    } catch (error) {
      log.error('Failed to add payment method:', error);
    } finally {
      setIsAddingPaymentMethod(false);
    }
  };

  const releaseTopUpLock = (runId: number) => {
    if (runId !== topUpRunIdRef.current) return;
    topUpLockedRef.current = false;
    setTopUpPhase('idle');
  };

  const showTopUpCouldNotVerify = (session: TopUpCheckoutSession) => {
    if (session.runId !== topUpRunIdRef.current) return;
    processingCheckoutRef.current = session.snapshot
      ? { snapshot: session.snapshot, amountCents: session.amountCents }
      : null;
    setTopUpFeedback({ kind: 'could_not_verify' });
    releaseTopUpLock(session.runId);
  };

  const pollTopUpSummary = async (session: TopUpCheckoutSession) => {
    const deadline = Date.now() + TOP_UP_POLL_TIMEOUT_MS;
    let lastSummary: BillingSummaryPayload | null = null;

    while (session.runId === topUpRunIdRef.current && Date.now() < deadline) {
      const remainingMs = deadline - Date.now();
      try {
        const summaryPayload = await apiJson<unknown>('/api/billing/summary', {
          timeoutMs: Math.min(TOP_UP_SUMMARY_REQUEST_TIMEOUT_MS, remainingMs),
        });
        if (session.runId !== topUpRunIdRef.current) return;
        const summaryResult = parseBillingSummaryPayload(summaryPayload);
        if (!summaryResult.ok) {
          log.warn(`Top-up summary unavailable at ${summaryResult.field}`);
          showTopUpCouldNotVerify(session);
          return;
        }
        const nextSummary = summaryResult.value;

        const verdict = decideTopUpPoll(session.snapshot, nextSummary);
        if (verdict === 'failed') {
          showTopUpCouldNotVerify(session);
          return;
        }

        lastSummary = nextSummary;
        if (verdict === 'confirmed') {
          processingCheckoutRef.current = null;
          setSummary(nextSummary);
          setSummaryStatus('ready');
          setTopUpFeedback({
            kind: 'confirmed',
            amountCents: session.amountCents,
            animationKey: Date.now(),
          });
          releaseTopUpLock(session.runId);
          return;
        }
      } catch (error) {
        log.warn('Top-up confirmation unavailable:', error);
        showTopUpCouldNotVerify(session);
        return;
      }

      const delayMs = Math.min(TOP_UP_POLL_INTERVAL_MS, deadline - Date.now());
      if (delayMs > 0) await wait(delayMs);
    }

    if (session.runId !== topUpRunIdRef.current) return;
    if (lastSummary) {
      setSummary(lastSummary);
      setSummaryStatus('ready');
    }
    showTopUpCouldNotVerify(session);
  };

  const presentTopUpCheckout = async (session: TopUpCheckoutSession) => {
    try {
      // ASWebAuthenticationSession on iOS and a Custom Tab on Android share the
      // system browser session. The promise resolves for a deep-link return or close.
      const browserResult = await openBillingUrl(session.url);
      const browserOutcome = decideBillingBrowserOutcome(browserResult);
      if (session.runId !== topUpRunIdRef.current) return;
      if (browserOutcome.kind === 'cancelled') {
        processingCheckoutRef.current = null;
        setTopUpFeedback({ kind: 'cancelled' });
        releaseTopUpLock(session.runId);
        return;
      }
      if (!browserOutcome.shouldPoll) {
        showTopUpCouldNotVerify(session);
        return;
      }
    } catch (error) {
      log.error('Checkout browser error:', error);
      if (session.runId === topUpRunIdRef.current) {
        Alert.alert('Credits', 'Could not open checkout. Try again.');
        releaseTopUpLock(session.runId);
      }
      return;
    }

    await pollTopUpSummary(session);
  };

  const handleAddCredits = async () => {
    if (!selectedCreditAmount || topUpLockedRef.current) return;

    const amountCents = selectedCreditAmount * 100;
    const runId = topUpRunIdRef.current + 1;
    topUpRunIdRef.current = runId;
    topUpLockedRef.current = true;
    processingCheckoutRef.current = null;
    setTopUpFeedback(null);
    setTopUpPhase('starting');

    let snapshot = summary;
    try {
      const summaryPayload = await apiJson<unknown>('/api/billing/summary', {
        timeoutMs: TOP_UP_SUMMARY_REQUEST_TIMEOUT_MS,
      });
      if (runId !== topUpRunIdRef.current) return;
      const summaryResult = parseBillingSummaryPayload(summaryPayload);
      if (!summaryResult.ok) {
        throw new Error(`Billing summary unavailable at ${summaryResult.field}`);
      }
      snapshot = summaryResult.value;
      setSummary(snapshot);
      setSummaryStatus('ready');
    } catch (error) {
      // Checkout can still proceed with the screen's last known summary. If there is
      // no safe baseline, the poll helper will choose the honest processing state.
      log.warn('Fresh pre-checkout billing summary unavailable:', error);
    }

    try {
      const successUrl = withMobileReturn('https://app.anorha.app/billing?success=true');
      const cancelUrl = withMobileReturn('https://app.anorha.app/billing?canceled=true');
      const data = await apiJson<{
        success?: boolean;
        checkoutUrl?: string;
        error?: string;
      }>('/api/billing/allowance/topup', {
        method: 'POST',
        body: { amountCents, successUrl, cancelUrl },
      });

      if (runId !== topUpRunIdRef.current) return;
      if (!data?.success || !data.checkoutUrl) {
        throw new Error(data?.error || 'Checkout redirect unavailable');
      }

      const session: TopUpCheckoutSession = {
        url: data.checkoutUrl,
        snapshot,
        amountCents,
        runId,
      };
      setTopUpPhase('waiting');

      // iOS cannot present its auth browser while the React Native Modal is still
      // dismissing. onDismiss is the deterministic hand-off point.
      pendingCheckoutRef.current = session;
      setShowCreditsModal(false);
      if (Platform.OS !== 'ios') {
        pendingCheckoutRef.current = null;
        await presentTopUpCheckout(session);
      }
    } catch (error) {
      log.error('Top-up error:', error);
      if (runId === topUpRunIdRef.current) {
        Alert.alert('Credits', 'Could not start checkout. Try again.');
        releaseTopUpLock(runId);
      }
    }
  };

  const handleCreditsModalDismiss = async () => {
    const session = pendingCheckoutRef.current;
    pendingCheckoutRef.current = null;
    if (session) await presentTopUpCheckout(session);
  };

  const openInvoiceUrl = async (invoice: BillingInvoicePayload) => {
    const url = getInvoiceReceiptUrl(invoice);
    if (!url) {
      Alert.alert('Receipt unavailable');
      return;
    }
    try {
      await Linking.openURL(url);
    } catch (error) {
      log.error('Failed to open invoice receipt:', error);
      Alert.alert('Receipt unavailable');
    }
  };

  const periodEndLabel = formatBillingDate(billingState.subscription.currentPeriodEnd);
  const checkoutEligibleLabel = formatBillingTimestamp(billingState.checkout.eligibleAt);
  const resubscribeEligibleLabel = formatBillingTimestamp(billingState.resubscribe.eligibleAt);
  const subscriptionLabel = billingState.subscription.state === 'canceled_paid_through'
    ? periodEndLabel
      ? `Paid through ${periodEndLabel}`
      : 'Canceled'
    : billingState.subscription.state === 'active'
      ? 'Access active'
      : billingState.subscription.state === 'inactive'
        ? 'Inactive'
        : null;
  const providerLabel = billingState.entitlementProvider === 'polar'
    ? 'Managed through Polar'
    : billingState.entitlementProvider === 'shopify'
      ? 'Managed through Shopify'
      : billingState.entitlementProvider === 'manual'
        ? 'Support managed'
        : null;
  const billingNotice = billingState.handoff?.state === 'scheduled'
    ? checkoutEligibleLabel
      ? `Switch scheduled. Checkout ${checkoutEligibleLabel}.`
      : 'Switch scheduled.'
    : billingState.resubscribe.offered === true && billingState.resubscribe.eligible === false
      ? resubscribeEligibleLabel
        ? `Re-subscribe ${resubscribeEligibleLabel}.`
        : 'Re-subscribe unavailable.'
      : billingState.checkout.state === 'blocked' && checkoutEligibleLabel
        ? `Checkout ${checkoutEligibleLabel}.`
        : billingState.handoff?.state === 'ready'
          ? 'Switch ready.'
          : null;
  const hasKnownEntitlement = billingState.entitlementProvider !== 'unknown'
    && billingState.subscription.state !== 'none'
    && billingState.subscription.state !== 'unknown';
  const canAttemptManage = billingState.subscription.state !== 'none';
  const checkoutBlocked = isCheckoutBlocked(billingState.checkout.allowed);
  const showCancel = billingState.subscription.state === 'active';
  const resubscribeEnabled = billingState.resubscribe.offered === true
    && billingState.resubscribe.eligible !== false
    && !checkoutBlocked;

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={{ paddingTop: insets.top + 8, paddingHorizontal: 18, paddingBottom: insets.bottom + 120 }}
        showsVerticalScrollIndicator={false}
        refreshControl={(
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={() => void refreshBillingData()}
            tintColor={ANORHA_GREEN}
          />
        )}
      >
        <PageHeader title="Billing" onBack={() => navigation.goBack()} />

        {/* Subscription Info Card */}
        <View style={styles.cardGroup}>
          <View style={styles.listItem}>
            <View>
              <Text style={styles.listLabel}>Current Plan</Text>
              <Text style={styles.listValue}>
                {summaryStatus === 'loading'
                  ? 'Loading'
                  : summaryStatus === 'error'
                    ? 'Unavailable'
                    : planTitle}
              </Text>
              {subscriptionLabel ? <Text style={styles.listSubValue}>{subscriptionLabel}</Text> : null}
            </View>
          </View>
          {periodEndLabel ? (
            <>
              <View style={styles.separator} />
              <View style={styles.listItem}>
                <View>
                  <Text style={styles.listLabel}>
                    {billingState.subscription.state === 'canceled_paid_through' ? 'Paid through' : 'Period end'}
                  </Text>
                  <Text style={styles.listValue}>{periodEndLabel}</Text>
                </View>
              </View>
            </>
          ) : null}
          {providerLabel ? (
            <>
              <View style={styles.separator} />
              <View style={styles.listItem}>
                <Text style={styles.listLabel}>Billing</Text>
                <Text style={styles.listValue}>{providerLabel}</Text>
              </View>
            </>
          ) : null}
          {canAttemptManage ? (
            <>
              <View style={styles.separator} />
              <TouchableOpacity
                style={styles.listItemAction}
                onPress={handleManageSubscription}
                disabled={isBillingActionLoading}
              >
                <Text style={styles.listValue}>Manage plan</Text>
                <ChevronRight size={20} color="#D4D4D8" />
              </TouchableOpacity>
            </>
          ) : null}
          {billingState.resubscribe.offered === true ? (
            <>
              <View style={styles.separator} />
              <TouchableOpacity
                style={[styles.listItemAction, !resubscribeEnabled && styles.disabledAction]}
                onPress={() => setShowTierSelector(true)}
                disabled={!resubscribeEnabled || isBillingActionLoading}
              >
                <View>
                  <Text style={styles.listValue}>Re-subscribe</Text>
                  {!resubscribeEnabled && resubscribeEligibleLabel ? (
                    <Text style={styles.listSubValue}>Available {resubscribeEligibleLabel}</Text>
                  ) : null}
                </View>
                <ChevronRight size={20} color="#D4D4D8" />
              </TouchableOpacity>
            </>
          ) : billingState.checkout.action === 'schedule_handoff' ? (
            <>
              <View style={styles.separator} />
              <TouchableOpacity
                style={styles.listItemAction}
                onPress={() => setShowTierSelector(true)}
                disabled={isBillingActionLoading}
              >
                <Text style={styles.listValue}>Schedule switch</Text>
                <ChevronRight size={20} color="#D4D4D8" />
              </TouchableOpacity>
            </>
          ) : !hasKnownEntitlement ? (
            <>
              <View style={styles.separator} />
              <TouchableOpacity
                style={[
                  styles.listItemAction,
                  checkoutBlocked && styles.disabledAction,
                ]}
                onPress={() => setShowTierSelector(true)}
                disabled={checkoutBlocked || isBillingActionLoading}
              >
                <Text style={styles.listValue}>View plans</Text>
                <ChevronRight size={20} color="#D4D4D8" />
              </TouchableOpacity>
            </>
          ) : null}
          {showCancel ? (
            <>
              <View style={styles.separator} />
              <TouchableOpacity
                style={styles.listItemAction}
                onPress={handleCancelSubscription}
                disabled={isBillingActionLoading}
              >
                <Text style={styles.cancelActionText}>Cancel plan</Text>
                <ChevronRight size={20} color="#D4D4D8" />
              </TouchableOpacity>
            </>
          ) : null}
        </View>

        {billingNotice ? <Text style={styles.actionNoticeText}>{billingNotice}</Text> : null}
        {actionNotice ? <Text style={styles.actionNoticeText}>{actionNotice}</Text> : null}
        {actionError ? (
          <Text style={styles.actionErrorText}>{actionError}</Text>
        ) : null}

        <Text style={styles.sectionHeader}>Usage this month</Text>
        {hasSummaryData ? (
          <View style={styles.cardGroup}>
            <View style={styles.usageItem}>
              {creditBalance ? (
                <View style={styles.creditMetrics}>
                  <View style={styles.creditMetric}>
                    <Text style={styles.listLabel}>Credits</Text>
                    <Text style={styles.listValue} numberOfLines={1} adjustsFontSizeToFit>
                      {formatCurrency(creditBalance.total / 100)}
                    </Text>
                  </View>
                  <View style={[styles.creditMetric, styles.creditMetricCenter]}>
                    <Text style={styles.listLabel}>Used</Text>
                    <Text style={styles.listValue} numberOfLines={1} adjustsFontSizeToFit>
                      {formatCurrency(creditBalance.used / 100)}
                    </Text>
                  </View>
                  <View style={[styles.creditMetric, styles.creditMetricEnd]}>
                    <Text style={styles.listLabel}>Remaining</Text>
                    <Text style={styles.listValue} numberOfLines={1} adjustsFontSizeToFit>
                      {formatCurrency(creditBalance.remaining / 100)}
                    </Text>
                  </View>
                </View>
              ) : (
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
                  <Text style={styles.listValue}>AI usage</Text>
                  <Text style={styles.listSubValue}>{computeUsagePercent}% used</Text>
                </View>
              )}
              {topUpFeedback?.kind === 'confirmed' ? (
                <View style={styles.topUpConfirmation} accessibilityLiveRegion="polite">
                  <Text style={styles.topUpConfirmedText}>
                    {formatTopUpAmount(topUpFeedback.amountCents)} added
                  </Text>
                </View>
              ) : topUpFeedback?.kind === 'cancelled' ? (
                <Text accessibilityLiveRegion="polite" style={styles.topUpProcessingText}>
                  {topUpTruthFeedback?.message}
                </Text>
              ) : topUpFeedback?.kind === 'could_not_verify' ? (
                <View accessibilityLiveRegion="polite" style={styles.topUpVerificationRow}>
                  <Text style={styles.topUpProcessingText}>{topUpTruthFeedback?.message}</Text>
                  <TouchableOpacity
                    accessibilityRole="button"
                    accessibilityLabel="Re-check payment"
                    disabled={isRefreshing}
                    onPress={() => void refreshBillingData()}
                    style={styles.topUpRecheck}
                  >
                    <RefreshCw size={14} color={ANORHA_GREEN} />
                    <Text style={styles.topUpRecheckText}>Re-check</Text>
                  </TouchableOpacity>
                </View>
              ) : null}
              {creditBalance ? (
                <SegmentedCreditBar
                  total={creditBalance.total}
                  planTotal={creditBalance.planTotal}
                  used={creditBalance.used}
                  remaining={creditBalance.remaining}
                  topupRemaining={creditBalance.topupRemaining}
                  topupTotal={creditBalance.topupTotal}
                  animationKey={topUpFeedback?.kind === 'confirmed'
                    ? topUpFeedback.animationKey
                    : undefined}
                />
              ) : (
                <HealthBar
                  used={computeUsedCents}
                  limit={computeAllowanceCents}
                  fillColor={ANORHA_GREEN}
                />
              )}
              {aiOverageDollars > 0 ? (
                <Text style={{ fontSize: 13, color: '#DC2626', marginTop: 8, fontFamily: 'Inter_500Medium' }}>
                  + {formatCurrency(aiOverageDollars)} overage
                </Text>
              ) : null}
            </View>
            {creditBalance !== null && creditBalance.topupRemaining > 0 ? (
              <>
                <View style={styles.separator} />
                <View style={styles.listItemAction}>
                  <Text style={styles.listLabel}>Added credits</Text>
                  <Text style={[styles.listValue, styles.creditTopupValue]}>
                    {formatCurrency(creditBalance.topupRemaining / 100)}
                  </Text>
                </View>
              </>
            ) : null}
            <View style={styles.separator} />
            <View style={styles.usageItem}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
                <Text style={styles.listValue}>Team Members</Text>
                <Text style={styles.listSubValue}>{teamMembersCount} / {teamMembersIncluded} spots</Text>
              </View>
              <HealthBar used={teamMembersCount} limit={teamMembersIncluded} fillColor={'#3B82F6'} />
              {teamMembersExtra > 0 ? (
                <Text style={{ fontSize: 13, color: '#3B82F6', marginTop: 8, fontFamily: 'Inter_500Medium' }}>
                  + {teamMembersExtra} extra member(s) ({formatCurrency(teamMembersCost)})
                </Text>
              ) : null}
            </View>
            <View style={styles.separator} />
            <TouchableOpacity style={styles.listItemAction} onPress={() => setShowCreditsModal(true)}>
              <View>
                <Text style={styles.listValue}>Add credits</Text>
                {isTopUpBusy ? (
                  <Text style={styles.listSubValue}>Waiting on payment...</Text>
                ) : null}
              </View>
              <ChevronRight size={20} color="#D4D4D8" />
            </TouchableOpacity>
          </View>
        ) : (
          <BillingMessageCard label={summaryStatus === 'loading' ? 'Loading' : 'Usage unavailable'} />
        )}

        <Text style={styles.sectionHeader}>Usage by feature</Text>
        {hasSummaryData ? (
          usageHistoryEntries.length > 0 ? (
            <View style={styles.cardGroup}>
              {usageHistoryEntries.map((entry, idx) => (
                <React.Fragment key={entry.key}>
                  {idx > 0 ? <View style={styles.separator} /> : null}
                  <View style={styles.listItem}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                      <Text style={styles.listValue}>{entry.displayName}</Text>
                      <Text style={styles.listValue}>
                        {computeAllowanceCents > 0
                          ? `${Math.max(0, Math.round((entry.internalCostCents / computeAllowanceCents) * 100))}%`
                          : '0%'}
                      </Text>
                    </View>
                    <Text style={styles.listSubValue}>
                      {entry.totalQuantity} {entry.totalQuantity === 1 ? 'use' : 'uses'}
                    </Text>
                  </View>
                </React.Fragment>
              ))}
            </View>
          ) : (
            <BillingMessageCard label="No usage" />
          )
        ) : (
          <BillingMessageCard label={summaryStatus === 'loading' ? 'Loading' : 'Usage unavailable'} />
        )}

        <Text style={styles.sectionHeader}>Cost Breakdown</Text>
        {hasSummaryData ? (
          hasCostBreakdown ? (
            <View style={styles.cardGroup}>
              <View style={styles.listItem}>
                {basePrice > 0 ? (
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                    <Text style={styles.listValue}>Base Plan ({planTitle})</Text>
                    <Text style={styles.listValue}>{formatCurrency(basePrice)}</Text>
                  </View>
                ) : null}
                {teamMembersCost > 0 ? (
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                    <Text style={styles.listValue}>Extra Team Members</Text>
                    <Text style={styles.listValue}>{formatCurrency(teamMembersCost)}</Text>
                  </View>
                ) : null}
                {aiOverageDollars > 0 ? (
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                    <Text style={styles.listValue}>AI Overage</Text>
                    <Text style={styles.listValue}>{formatCurrency(aiOverageDollars)}</Text>
                  </View>
                ) : null}
                <View style={{ height: 1, backgroundColor: '#F1F1EE', marginVertical: 8 }} />
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={styles.listValueBold}>Estimated Total</Text>
                  <Text style={styles.listValueBold}>{formatCurrency(totalCostEstimate)}</Text>
                </View>
              </View>
            </View>
          ) : (
            <BillingMessageCard label="No charges" />
          )
        ) : (
          <BillingMessageCard label={summaryStatus === 'loading' ? 'Loading' : 'Costs unavailable'} />
        )}

        <Text style={styles.sectionHeader}>Upcoming Invoice</Text>
        {upcomingStatus === 'loading' ? (
          <BillingMessageCard label="Loading" />
        ) : upcomingStatus === 'error' ? (
          <BillingMessageCard label="Invoice unavailable" />
        ) : upcoming ? (
          <View style={styles.cardGroup}>
            <View style={styles.listItem}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                <Text style={styles.listValue}>Amount Due</Text>
                <Text style={styles.listValue}>{formatCurrency(upcoming.total / 100, upcoming.currency)}</Text>
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={styles.listSubValue}>Next Payment</Text>
                <Text style={styles.listSubValue}>
                  {new Date(upcoming.due_date).toLocaleDateString()}
                </Text>
              </View>
            </View>
          </View>
        ) : (
          <BillingMessageCard label="No upcoming invoice" />
        )}

        <Text style={styles.sectionHeader}>Invoices</Text>
        {invoicesStatus === 'loading' ? (
          <BillingMessageCard label="Loading" />
        ) : invoicesStatus === 'error' ? (
          <BillingMessageCard label="Invoices unavailable" />
        ) : invoices.length === 0 ? (
          <BillingMessageCard label="No invoices" />
        ) : (
          <View style={styles.cardGroup}>
            {invoices.map((invoice, idx) => {
              const receiptUrl = getInvoiceReceiptUrl(invoice);
              return (
                <React.Fragment key={invoice.id}>
                  {idx > 0 ? <View style={styles.separator} /> : null}
                  <TouchableOpacity
                    style={styles.listItemAction}
                    onPress={() => void openInvoiceUrl(invoice)}
                    disabled={!receiptUrl}
                    accessibilityState={{ disabled: !receiptUrl }}
                  >
                    <View>
                      <Text style={styles.listValue}>
                        {new Date(invoice.created * 1000).toLocaleDateString()}
                      </Text>
                      <Text style={styles.listSubValue}>{invoice.status.toUpperCase()}</Text>
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <Text style={[styles.listValue, { marginRight: 8 }]}>
                        {formatCurrency(invoice.total / 100, invoice.currency)}
                      </Text>
                      {receiptUrl ? (
                        <ChevronRight size={20} color="#D4D4D8" />
                      ) : (
                        <Text style={styles.listSubValue}>No receipt</Text>
                      )}
                    </View>
                  </TouchableOpacity>
                </React.Fragment>
              );
            })}
          </View>
        )}

        <Text style={styles.sectionHeader}>Support</Text>
        <View style={styles.cardGroup}>
          <TouchableOpacity
            style={styles.listItemAction}
            onPress={openBillingSupport}
          >
            <View style={{ flex: 1, paddingRight: 8 }}>
              <Text style={styles.listValue}>Report Subscription Issue</Text>
              <Text style={[styles.listSubValue, { marginTop: 4 }]}>Send details and an optional screenshot to our support team.</Text>
            </View>
            <ChevronRight size={20} color="#D4D4D8" />
          </TouchableOpacity>
        </View>

      </ScrollView>

      <Modal
        visible={showCreditsModal}
        animationType="slide"
        transparent={true}
        onRequestClose={() => {
          if (topUpPhase !== 'starting') setShowCreditsModal(false);
        }}
        onDismiss={handleCreditsModalDismiss}
      >
        <View style={styles.creditsOverlay}>
          <View style={styles.creditsSheet}>
            <View style={styles.creditsHandle} />
            <Text style={styles.creditsTitle}>Add credits</Text>
            <Text style={styles.creditsSubtitle}>More AI usage this month.</Text>
            <View style={styles.creditsChipRow}>
              {[5, 10, 25, 50].map(amount => (
                <TouchableOpacity
                  key={amount}
                  style={[
                    styles.creditsChip,
                    selectedCreditAmount === amount && styles.creditsChipSelected,
                    isTopUpBusy && styles.disabledAction,
                  ]}
                  onPress={() => setSelectedCreditAmount(amount)}
                  disabled={isTopUpBusy}
                >
                  <Text style={[styles.creditsChipText, selectedCreditAmount === amount && styles.creditsChipTextSelected]}>
                    ${amount}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <TouchableOpacity
              style={[styles.creditsButton, isTopUpBusy && styles.creditsButtonDisabled]}
              onPress={handleAddCredits}
              disabled={isTopUpBusy || !selectedCreditAmount}
            >
              {topUpPhase === 'starting' ? (
                <Text style={styles.creditsButtonText}>Opening checkout...</Text>
              ) : topUpPhase === 'waiting' ? (
                <Text style={styles.creditsButtonText}>Waiting on payment...</Text>
              ) : (
                <Text style={styles.creditsButtonText}>Continue</Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.creditsCancel, topUpPhase === 'starting' && styles.disabledAction]}
              onPress={() => setShowCreditsModal(false)}
              disabled={topUpPhase === 'starting'}
            >
              <Text style={styles.creditsCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <TierSelectorModal
        visible={showTierSelector}
        onClose={() => setShowTierSelector(false)}
        onSuccess={() => {
          setShowTierSelector(false);
          refreshBillingData();
        }}
        initialSummary={summary}
        usagePercent={computeUsagePercent}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F6F7F4' },
  scroll: { flex: 1 },
  cardGroup: {
    backgroundColor: WHITE_BG,
    borderRadius: 20,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: '#ECEBE6',
    marginBottom: 24,
  },
  listItem: {
    paddingVertical: 14,
  },
  listItemAction: {
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  disabledAction: {
    opacity: 0.45,
  },
  cancelActionText: {
    fontSize: 16,
    color: '#DC2626',
    fontFamily: 'Inter_600SemiBold',
  },
  usageItem: {
    paddingVertical: 14,
  },
  creditMetrics: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 10,
  },
  creditMetric: {
    flex: 1,
  },
  creditMetricCenter: {
    alignItems: 'center',
  },
  creditMetricEnd: {
    alignItems: 'flex-end',
  },
  segmentedCreditTrack: {
    flexDirection: 'row',
  },
  creditSegment: {
    flexBasis: 0,
    height: '100%',
  },
  creditUsed: {
    backgroundColor: ANORHA_GREEN,
  },
  creditPlan: {
    backgroundColor: '#DCE9C1',
  },
  creditTopup: {
    backgroundColor: '#3B82F6',
  },
  creditTopupValue: {
    color: '#3B82F6',
  },
  listLabel: {
    fontSize: 13,
    color: '#71717A',
    fontFamily: 'Inter_400Regular',
    marginBottom: 4,
  },
  listValue: {
    fontSize: 16,
    color: '#18181B',
    fontFamily: 'Inter_600SemiBold',
  },
  listValueBold: {
    fontSize: 16,
    color: '#18181B',
    fontFamily: 'Inter_700Bold',
  },
  listSubValue: {
    fontSize: 13,
    color: '#71717A',
    fontFamily: 'Inter_400Regular',
    marginTop: 2,
  },
  separator: {
    height: 1,
    backgroundColor: '#F1F1EE',
  },
  sectionHeader: {
    fontSize: 13,
    color: '#71717A',
    fontFamily: 'Inter_600SemiBold',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 10,
    marginLeft: 4,
  },
  progressTrack: {
    height: 8,
    borderRadius: 4,
    backgroundColor: '#F1F1EE',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 4,
    backgroundColor: ANORHA_GREEN,
  },
  topUpConfirmation: {
    marginBottom: 12,
  },
  topUpConfirmedText: {
    fontSize: 14,
    fontFamily: 'Inter_700Bold',
    color: '#4D7C0F',
    marginBottom: 8,
  },
  topUpProcessingText: {
    fontSize: 13,
    lineHeight: 18,
    fontFamily: 'Inter_500Medium',
    color: '#52525B',
    marginBottom: 8,
  },
  topUpVerificationRow: {
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  topUpRecheck: {
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  topUpRecheckText: {
    fontSize: 13,
    fontFamily: 'Inter_700Bold',
    color: ANORHA_GREEN,
  },
  actionErrorText: {
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
    color: '#DC2626',
    marginTop: -16,
    marginBottom: 24,
    marginLeft: 4,
  },
  actionNoticeText: {
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
    color: '#52525B',
    marginTop: -16,
    marginBottom: 24,
    marginLeft: 4,
  },
  creditsOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  creditsSheet: {
    backgroundColor: WHITE_BG,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 40,
  },
  creditsHandle: {
    width: 42,
    height: 5,
    borderRadius: 999,
    backgroundColor: '#D4D4D8',
    alignSelf: 'center',
    marginBottom: 18,
  },
  creditsTitle: {
    fontSize: 22,
    fontFamily: 'Inter_700Bold',
    color: '#18181B',
    textAlign: 'center',
  },
  creditsSubtitle: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: '#71717A',
    textAlign: 'center',
    marginTop: 6,
    marginBottom: 22,
  },
  creditsChipRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 20,
  },
  creditsChip: {
    flex: 1,
    paddingVertical: 14,
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#ECEBE6',
    backgroundColor: WHITE_BG,
  },
  creditsChipSelected: {
    borderColor: ANORHA_GREEN,
    backgroundColor: 'rgba(147,200,34,0.12)',
  },
  creditsChipText: {
    fontSize: 16,
    fontFamily: 'Inter_600SemiBold',
    color: '#71717A',
  },
  creditsChipTextSelected: {
    color: '#18181B',
  },
  creditsButton: {
    minHeight: 52,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: ANORHA_GREEN,
  },
  creditsButtonDisabled: {
    opacity: 0.65,
  },
  creditsButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontFamily: 'Inter_700Bold',
  },
  creditsCancel: {
    alignSelf: 'center',
    paddingVertical: 12,
    paddingHorizontal: 18,
    marginTop: 4,
  },
  creditsCancelText: {
    fontSize: 14,
    fontFamily: 'Inter_500Medium',
    color: '#71717A',
  },
});
