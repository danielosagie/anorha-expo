import React, { useState, useEffect, useCallback } from 'react';
import { BRAND_PRIMARY } from '../design/tokens';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Linking,
  Modal,
  TextInput,
  Alert,
  Animated,
  AppState,
  StatusBar,
} from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { useNavigation } from '@react-navigation/native';
import { ChevronRight } from 'lucide-react-native';
import { useAuth } from '@clerk/clerk-expo';
import PageHeader from '../components/ui/PageHeader';
import TierSelectorModal from '../components/TierSelectorModal';
import { API_BASE_URL } from '../config/env';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { capture, AnalyticsEvents } from '../lib/analytics';
import { createLogger } from '../utils/logger';
const log = createLogger('BillingScreen');


const API_BASE_RAW = API_BASE_URL;
const API_BASE = API_BASE_RAW.replace(/\/$/, '').endsWith('/api')
  ? API_BASE_RAW.replace(/\/$/, '')
  : `${API_BASE_RAW.replace(/\/$/, '')}/api`;

const ANORHA_GREEN = BRAND_PRIMARY;
const WHITE_BG = '#FFFFFF';

function safeNumber(value: any, fallback = 0): number {
  const num = typeof value === 'string' ? Number(value) : value;
  return Number.isFinite(num) ? num : fallback;
}

function formatCurrency(value: number): string {
  return value.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

// Vendor / internal names we never surface to a seller (Groq, Serpapi, Firecrawl, …).
const VENDOR_WORDS = /\b(groq|serpapi|firecrawl|openai|gpt|gemini|claude|anthropic|whisper|llm|kimi|moonshot|deepseek|scrape|credits?)\b/gi;

// Raw usage keys (and their vendor-named variants) → plain-English, transparent labels.
// Synonyms intentionally share a label so the history groups into clean lines.
const FEATURE_LABELS: Record<string, string> = {
  ai_quick_scan: 'Photo scans',
  product_photo_scan: 'Photo scans',
  ai_recognize_match: 'Product matching',
  auto_match: 'Product matching',
  auto_match_products: 'Product matching',
  match_serpapi_search: 'Product matching',
  product_search: 'Product matching',
  ebay_pricing_research: 'Price research',
  ebay_pricing: 'Price research',
  ai_generate_groq: 'Listing details',
  generation_groq: 'Listing details',
  ai_text_generation: 'Listing details',
  ai_generate_scrape_credits: 'Web research',
  generation_firecrawl: 'Web research',
  generation_firecrawl_scrape: 'Web research',
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
  // Unknown key — bucket by intent so an unmapped vendor name can never leak.
  if (/(scrape|firecrawl|serpapi|web|research|search)/.test(norm)) return 'Web research';
  if (/(generat|groq|gpt|llm|text|writ|kimi|deepseek)/.test(norm)) return 'Listing details';
  if (/ship/.test(norm)) return 'Shipping estimates'; // before vision: "shipping_vision_*" is shipping, not a photo scan
  if (/(vision|photo|scan|image)/.test(norm)) return 'Photo scans';
  if (/(match|recogni)/.test(norm)) return 'Product matching';
  if (/(pric|comp|ebay)/.test(norm)) return 'Price research';
  if (/(sync|import|export|inventory)/.test(norm)) return 'Inventory sync';
  if (/insight/.test(norm)) return 'Business insights';
  if (/receipt/.test(norm)) return 'Receipt scans';
  if (/manifest/.test(norm)) return 'Manifest scans';
  if (/(liquidat|clearout)/.test(norm)) return 'Clearout research';
  // Last resort: humanize but scrub any vendor word.
  const cleaned = norm.replace(/^ai_/, '').replace(/_/g, ' ').replace(VENDOR_WORDS, '').replace(/\s+/g, ' ').trim();
  return cleaned ? cleaned.replace(/\b\w/g, c => c.toUpperCase()) : 'AI usage';
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

export default function BillingScreen() {
  const navigation = useNavigation();
  const { getToken } = useAuth();
  const insets = useSafeAreaInsets();

  const [summary, setSummary] = useState<any>(null);
  const [invoices, setInvoices] = useState<any>(null);
  const [upcoming, setUpcoming] = useState<any>({ upcoming: null });
  const [hasActiveSubscription, setHasActiveSubscription] = useState(false);
  const [partnerPaymentMethod, setPartnerPaymentMethod] = useState<{
    hasPaymentMethod: boolean;
    lastFour?: string;
    brand?: string;
    expiresAt?: string;
  } | null>(null);
  const [userRole, setUserRole] = useState<'owner' | 'employee' | 'partner' | 'org:admin' | undefined>(undefined);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showTierSelector, setShowTierSelector] = useState(false);
  const [showCreditsModal, setShowCreditsModal] = useState(false);
  const [selectedCreditAmount, setSelectedCreditAmount] = useState<number | null>(50);
  const [isTopUpLoading, setIsTopUpLoading] = useState(false);
  const [isAddingPaymentMethod, setIsAddingPaymentMethod] = useState(false);

  const isPartner = userRole === 'partner';
  const hasSummaryData = !!summary && typeof summary === 'object';

  const refreshBillingData = useCallback(async () => {
    setIsRefreshing(true);
    setActionError(null);
    try {
      const token = await getToken();
      if (!token) {
        log.error('No auth token available');
        return;
      }
      const headers = {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      };

      const [summaryRes, invoicesRes, upcomingRes, partnerPaymentRes] = await Promise.all([
        fetch(`${API_BASE}/billing/summary`, { headers }),
        fetch(`${API_BASE}/billing/invoices?limit=12`, { headers }),
        fetch(`${API_BASE}/billing/upcoming`, { headers }),
        isPartner ? fetch(`${API_BASE}/billing/partner/payment-method`, { headers }) : Promise.resolve(null),
      ]);

      if (summaryRes?.ok) {
        const newSummary = await summaryRes.json();
        setSummary(newSummary);
        setHasActiveSubscription(newSummary?.subscription?.Status === 'active');
      }
      if (invoicesRes?.ok) {
        const newInvoices = await invoicesRes.json();
        setInvoices(newInvoices);
      }
      if (upcomingRes?.ok) {
        const newUpcoming = await upcomingRes.json();
        setUpcoming(newUpcoming);
      }
      if (partnerPaymentRes?.ok) {
        const data = await partnerPaymentRes.json();
        setPartnerPaymentMethod(data);
      }
    } catch (error) {
      log.error('Failed to refresh billing data:', error);
    } finally {
      setIsRefreshing(false);
    }
  }, [getToken, isPartner]);

  useEffect(() => {
    refreshBillingData();
  }, []);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') refreshBillingData();
    });
    return () => sub.remove();
  }, [refreshBillingData]);

  const planFromSummary =
    summary?.subscription?.CurrentPlan || summary?.tier_name || summary?.subscription?.current_plan;
  const subscriptionStatus = summary?.subscription?.Status || summary?.subscription?.status;
  const planName = (planFromSummary as 'Growth' | 'Teams' | undefined) || undefined;

  const aiScansLimit = safeNumber(summary?.ai_scans_limit, planName === 'Teams' ? 80 : 40);
  const aiUnitCents = safeNumber(summary?.ai_credit_unit_cents, planName === 'Teams' ? 15 : 20);
  const aiCreditsUsedLegacy = safeNumber(summary?.ai_credits_used);
  const aiCreditsLimitLegacy = safeNumber(summary?.ai_credits_limit, aiScansLimit);
  const aiAllowanceCents = safeNumber(
    summary?.ai_credits_cents ?? summary?.ai_allowance_cents,
    aiCreditsLimitLegacy * aiUnitCents
  );
  const teamMembersCount = safeNumber(summary?.team_members_count);
  const teamMembersIncluded = safeNumber(summary?.team_members_included);
  const teamMembersExtra = Math.max(0, safeNumber(summary?.team_members_extra));
  const teamMembersCost = safeNumber(summary?.team_members_cost);
  const pricePerScan = aiUnitCents / 100;

  let planTitle = 'No active plan';
  let planDescription = 'Choose a plan to unlock live sync, AI scanning, and team features.';
  let basePrice = 0;
  if (planName === 'Growth') {
    planTitle = 'Growth · $20/month';
    basePrice = 20;
    planDescription = `${teamMembersIncluded || 2} users/partners included, unlimited platforms & inventory, AI: ${aiScansLimit || 40} scans included then ${formatCurrency(pricePerScan)}/scan.`;
  } else if (planName === 'Teams') {
    planTitle = 'Teams · $60/month';
    basePrice = 60;
    planDescription = `${teamMembersIncluded || 5} users/partners (+$10/spot after), unlimited platforms & inventory, AI: ${aiScansLimit || 80} scans included then ${formatCurrency(pricePerScan)}/scan.`;
  }

  const featureUsage = summary?.usage || {};
  const featureEntries = Object.entries(featureUsage || {});
  // Group by the friendly label (always derived from the key, never the backend's raw
  // displayName) so vendor names can't leak and synonyms collapse into one clean line.
  const usageHistoryEntries = Object.values(
    featureEntries.reduce((acc, [key, value]: [string, any]) => {
      const totalCostCents = safeNumber(value?.totalCost ?? value?.total_cost ?? value?.total_cost_cents);
      const totalQuantity = safeNumber(
        value?.totalQuantity ?? value?.total_quantity ?? value?.quantity ?? value?.count
      );
      if (totalCostCents <= 0 && totalQuantity <= 0) return acc;
      const displayName = getFeatureDisplayName(key);
      const existing = acc[displayName];
      if (existing) {
        existing.totalCostCents += totalCostCents;
        existing.totalQuantity += totalQuantity;
      } else {
        acc[displayName] = { key: displayName, displayName, totalCostCents, totalQuantity };
      }
      return acc;
    }, {} as Record<string, { key: string; displayName: string; totalCostCents: number; totalQuantity: number }>)
  ).sort((a, b) => b.totalCostCents - a.totalCostCents);

  const totalUsageHistoryCents = usageHistoryEntries.reduce((sum, entry) => sum + entry.totalCostCents, 0);
  const aiUsedCents = summary?.ai_used_cents == null
    ? (totalUsageHistoryCents || (aiCreditsUsedLegacy * aiUnitCents))
    : safeNumber(summary?.ai_used_cents);
  const aiOverageCents = safeNumber(
    summary?.ai_overage_cents ?? summary?.ai_credits_overage_cents,
    Math.max(0, aiUsedCents - aiAllowanceCents)
  );
  const aiOverageDollars = aiOverageCents / 100;
  const aiUsedDollars = aiUsedCents / 100;
  const aiAllowanceDollars = aiAllowanceCents / 100;
  const totalCostEstimate = basePrice + teamMembersCost + aiOverageDollars;

  const handleManageSubscription = async () => {
    setActionError(null);
    try {
      const token = await getToken();
      if (!token) return;
      const res = await fetch(`${API_BASE}/billing/portal`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      });
      if (!res.ok) {
        const text = await res.text();
        setActionError(text || 'Unable to open subscription portal.');
        return;
      }
      const data = await res.json().catch(() => null);
      if (data?.url) {
        capture(AnalyticsEvents.BILLING_PORTAL_OPENED);
        await WebBrowser.openBrowserAsync(data.url);
        refreshBillingData();
      } else {
        setActionError('Unable to open subscription portal.');
      }
    } catch (error) {
      log.error('Failed to open portal:', error);
      setActionError('Unable to open subscription portal.');
    }
  };

  const handleAddPartnerPaymentMethod = async () => {
    setIsAddingPaymentMethod(true);
    try {
      const token = await getToken();
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

  const handleAddCredits = async () => {
    if (!selectedCreditAmount) return;
    setIsTopUpLoading(true);
    try {
      const token = await getToken();
      if (!token) return;
      const res = await fetch(`${API_BASE}/billing/allowance/topup`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ amountCents: selectedCreditAmount * 100 }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.checkoutUrl) {
          setShowCreditsModal(false);
          await Linking.openURL(data.checkoutUrl);
        }
      }
    } catch (error) {
      log.error('Top-up error:', error);
    } finally {
      setIsTopUpLoading(false);
    }
  };

  const openInvoiceUrl = (inv: any) => {
    const url = inv.hosted_invoice_url || inv.hosted_url || inv.url;
    if (url) Linking.openURL(url);
  };

  const supportContext = {
    planName: planName || 'Unknown',
    subscriptionStatus: subscriptionStatus || 'inactive',
    aiAllowanceCents,
    aiUsedCents,
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={{ paddingTop: insets.top + 8, paddingHorizontal: 18, paddingBottom: insets.bottom + 120 }}
        showsVerticalScrollIndicator={false}
      >
        <PageHeader title="Billing" onBack={() => navigation.goBack()} />

        {/* Subscription Info Card */}
        <View style={styles.cardGroup}>
          <View style={styles.listItem}>
            <View>
              <Text style={styles.listLabel}>Current Plan</Text>
              <Text style={styles.listValue}>{planTitle.split('·')[0].trim() || 'Free Trial'}</Text>
              <Text style={styles.listSubValue}>{subscriptionStatus === 'active' ? 'Subscribed' : 'Inactive'}</Text>
            </View>
          </View>
          <View style={styles.separator} />
          <View style={styles.listItem}>
            <View>
              <Text style={styles.listLabel}>Expiration Date</Text>
              <Text style={styles.listValue}>
                {summary?.subscription?.CurrentPeriodEnd
                  ? new Date(summary.subscription.CurrentPeriodEnd).toLocaleDateString('en-US', {
                    month: 'long',
                    day: 'numeric',
                    year: 'numeric',
                  })
                  : 'N/A'}
              </Text>
            </View>
          </View>
          <View style={styles.separator} />
          {hasActiveSubscription ? (
            <TouchableOpacity style={styles.listItemAction} onPress={handleManageSubscription}>
              <Text style={styles.listValue}>Manage Subscription</Text>
              <ChevronRight size={20} color="#D4D4D8" />
            </TouchableOpacity>
          ) : (
            <TouchableOpacity style={styles.listItemAction} onPress={() => setShowTierSelector(true)}>
              <Text style={styles.listValue}>Upgrade</Text>
              <ChevronRight size={20} color="#D4D4D8" />
            </TouchableOpacity>
          )}
        </View>

        {hasSummaryData && (
          <>
            <Text style={styles.sectionHeader}>Usage this month</Text>
            <View style={styles.cardGroup}>
              <View style={styles.usageItem}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
                  <Text style={styles.listValue}>AI Credits</Text>
                  <Text style={styles.listSubValue}>
                    {formatCurrency(aiUsedDollars)} of {formatCurrency(aiAllowanceDollars)}
                  </Text>
                </View>
                <HealthBar used={aiUsedCents} limit={aiAllowanceCents} fillColor={ANORHA_GREEN} />
                {aiOverageDollars > 0 && <Text style={{ fontSize: 13, color: '#DC2626', marginTop: 8, fontFamily: 'Inter_500Medium' }}>+ {formatCurrency(aiOverageDollars)} overage</Text>}
              </View>
              <View style={styles.separator} />
              <View style={styles.usageItem}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
                  <Text style={styles.listValue}>Team Members</Text>
                  <Text style={styles.listSubValue}>{teamMembersCount} / {teamMembersIncluded} spots</Text>
                </View>
                <HealthBar used={teamMembersCount} limit={teamMembersIncluded} fillColor={'#3B82F6'} />
                {teamMembersExtra > 0 && <Text style={{ fontSize: 13, color: '#3B82F6', marginTop: 8, fontFamily: 'Inter_500Medium' }}>+ {teamMembersExtra} extra member(s) ({formatCurrency(teamMembersCost)})</Text>}
              </View>
            </View>

            {usageHistoryEntries.length > 0 && (
              <>
                <Text style={styles.sectionHeader}>Usage History</Text>
                <View style={styles.cardGroup}>
                  {usageHistoryEntries.map((entry, idx) => (
                    <React.Fragment key={entry.key}>
                      {idx > 0 && <View style={styles.separator} />}
                      <View style={styles.listItem}>
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                          <Text style={styles.listValue}>{entry.displayName}</Text>
                          <Text style={styles.listValue}>
                            {formatCurrency(entry.totalCostCents / 100)}
                          </Text>
                        </View>
                        <Text style={styles.listSubValue}>
                          {entry.totalQuantity} {entry.totalQuantity === 1 ? 'use' : 'uses'}
                        </Text>
                      </View>
                    </React.Fragment>
                  ))}
                </View>
              </>
            )}
          </>
        )}

        {hasActiveSubscription && (
          <>
            <Text style={styles.sectionHeader}>Cost Breakdown</Text>
            <View style={styles.cardGroup}>
              <View style={styles.listItem}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                  <Text style={styles.listValue}>Base Plan ({planTitle.split('·')[0].trim()})</Text>
                  <Text style={styles.listValue}>{formatCurrency(basePrice)}</Text>
                </View>
                {teamMembersCost > 0 && (
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                    <Text style={styles.listValue}>Extra Team Members</Text>
                    <Text style={styles.listValue}>{formatCurrency(teamMembersCost)}</Text>
                  </View>
                )}
                {aiOverageDollars > 0 && (
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                    <Text style={styles.listValue}>AI Overage</Text>
                    <Text style={styles.listValue}>{formatCurrency(aiOverageDollars)}</Text>
                  </View>
                )}
                <View style={{ height: 1, backgroundColor: '#F1F1EE', marginVertical: 8 }} />
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={styles.listValueBold}>Estimated Total</Text>
                  <Text style={styles.listValueBold}>{formatCurrency(totalCostEstimate)}</Text>
                </View>
              </View>
            </View>
          </>
        )}

        {/* Upcoming Invoice */}
        {(() => {
          const invData = upcoming?.upcoming || upcoming;
          if (!invData || (!invData.amount_due && !invData.total)) return null;
          const dateStr = invData.next_payment_attempt || invData.period_end || invData.created_at || invData.created;
          const d = typeof dateStr === 'string' ? new Date(dateStr) : new Date((dateStr || 0) * 1000);
          const amt = invData.amount_due || invData.total || 0;
          return (
            <>
              <Text style={styles.sectionHeader}>Upcoming Invoice</Text>
              <View style={styles.cardGroup}>
                <View style={styles.listItem}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                    <Text style={styles.listValue}>Amount Due</Text>
                    <Text style={styles.listValue}>{formatCurrency(amt / 100)}</Text>
                  </View>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text style={styles.listSubValue}>Next Payment</Text>
                    <Text style={styles.listSubValue}>{d.toLocaleDateString()}</Text>
                  </View>
                </View>
              </View>
            </>
          );
        })()}

        {/* Invoices List */}
        {(() => {
          const arr = invoices?.data || invoices;
          if (!Array.isArray(arr) || arr.length === 0) return null;
          return (
            <>
              <Text style={styles.sectionHeader}>Invoices</Text>
              <View style={styles.cardGroup}>
                {arr.slice(0, 5).map((inv: any, idx: number) => {
                  const dateStr = inv.created || inv.created_at;
                  const d = typeof dateStr === 'string' ? new Date(dateStr) : new Date((dateStr || 0) * 1000);
                  const amt = inv.amount_paid ?? inv.total ?? 0;
                  return (
                    <React.Fragment key={inv.id || idx}>
                      {idx > 0 && <View style={styles.separator} />}
                      <TouchableOpacity style={styles.listItemAction} onPress={() => openInvoiceUrl(inv)}>
                        <View>
                          <Text style={styles.listValue}>
                            {d.toLocaleDateString()}
                          </Text>
                          <Text style={styles.listSubValue}>{(inv.status || 'paid').toUpperCase()}</Text>
                        </View>
                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                          <Text style={[styles.listValue, { marginRight: 8 }]}>
                            {formatCurrency(amt / 100)}
                          </Text>
                          <ChevronRight size={20} color="#D4D4D8" />
                        </View>
                      </TouchableOpacity>
                    </React.Fragment>
                  );
                })}
              </View>
            </>
          );
        })()}

        <Text style={styles.sectionHeader}>Support</Text>
        <View style={styles.cardGroup}>
          <TouchableOpacity
            style={styles.listItemAction}
            onPress={() => (navigation as any).navigate('BillingSupport', { context: supportContext })}
          >
            <View style={{ flex: 1, paddingRight: 8 }}>
              <Text style={styles.listValue}>Report Subscription Issue</Text>
              <Text style={[styles.listSubValue, { marginTop: 4 }]}>Send details and an optional screenshot to our support team.</Text>
            </View>
            <ChevronRight size={20} color="#D4D4D8" />
          </TouchableOpacity>
        </View>

      </ScrollView>

      <TierSelectorModal
        visible={showTierSelector}
        onClose={() => setShowTierSelector(false)}
        onSuccess={() => {
          setShowTierSelector(false);
          refreshBillingData();
        }}
        hasSubscription={hasActiveSubscription}
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
  usageItem: {
    paddingVertical: 14,
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
});
