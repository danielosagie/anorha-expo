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
} from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { useNavigation } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '@clerk/clerk-expo';
import Card from '../components/Card';
import TierSelectorModal from '../components/TierSelectorModal';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { capture, AnalyticsEvents } from '../lib/analytics';

const API_BASE_RAW = process.env.EXPO_PUBLIC_API_BASE_URL || 'https://api.sssync.app';
const API_BASE = API_BASE_RAW.replace(/\/$/, '').endsWith('/api')
  ? API_BASE_RAW.replace(/\/$/, '')
  : `${API_BASE_RAW.replace(/\/$/, '')}/api`;

const ANORHA_GREEN = BRAND_PRIMARY;
const CREAM_BG = '#FEF4DD'; // Deprecated, using #ffffff natively
const WHITE_BG = '#FFFFFF';

function safeNumber(value: any, fallback = 0): number {
  const num = typeof value === 'string' ? Number(value) : value;
  return Number.isFinite(num) ? num : fallback;
}

function formatCurrency(value: number): string {
  return value.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

function getFeatureDisplayName(key: string): string {
  const displayNames: Record<string, string> = {
    ai_quick_scan: 'Photo Scan',
    ai_recognize_match: 'Auto-Match',
    ai_generate_groq: 'AI Generation',
    ai_generate_scrape_credits: 'Web Research',
    ai_insight_generation: 'Insights',
    ai_receipt_parsing: 'Receipt Processing',
    ai_manifest_analysis: 'Manifest Analysis',
    ai_liquidation_research: 'Liquidation Research',
    ebay_pricing_research: 'eBay Pricing Research',
    ai_shipping_vision: 'Shipping Vision',
    match_serpapi_search: 'Product Search',
    generation_firecrawl: 'Web Scraping',
    sync: 'Inventory Sync',
    import: 'Product Import',
    export: 'Product Export',
  };
  return displayNames[key] || key.replace(/^ai_/, '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
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
  const theme = useTheme();
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
        console.error('No auth token available');
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
      console.error('Failed to refresh billing data:', error);
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
  const usageHistoryEntries = featureEntries
    .map(([key, value]: [string, any]) => {
      const totalCostCents = safeNumber(value?.totalCost ?? value?.total_cost ?? value?.total_cost_cents);
      const totalQuantity = safeNumber(
        value?.totalQuantity ?? value?.total_quantity ?? value?.quantity ?? value?.count
      );
      const displayName = value?.displayName || getFeatureDisplayName(key);
      return { key, displayName, totalCostCents, totalQuantity };
    })
    .filter((entry) => entry.totalCostCents > 0 || entry.totalQuantity > 0)
    .sort((a, b) => b.totalCostCents - a.totalCostCents);

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
      console.error('Failed to open portal:', error);
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
      console.error('Failed to add payment method:', error);
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
      console.error('Top-up error:', error);
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
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Icon name="chevron-left" size={32} color={theme.colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: theme.colors.text }]}>My Subscription</Text>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>

        {/* Subscription Info Card */}
        <View style={styles.cardGroup}>
          <View style={styles.listItem}>
            <View>
              <Text style={styles.listLabel}>Current Plan</Text>
              <Text style={[styles.listValue, { color: theme.colors.text }]}>{planTitle.split('·')[0].trim() || 'Free Trial'}</Text>
              <Text style={styles.listSubValue}>{subscriptionStatus === 'active' ? 'Subscribed' : 'Inactive'}</Text>
            </View>
          </View>
          <View style={styles.separator} />
          <View style={styles.listItem}>
            <View>
              <Text style={styles.listLabel}>Expiration Date</Text>
              <Text style={[styles.listValue, { color: theme.colors.text }]}>
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
              <Text style={[styles.listValue, { color: theme.colors.text }]}>Manage Subscription</Text>
              <Icon name="chevron-right" size={24} color="#C7C7CC" />
            </TouchableOpacity>
          ) : (
            <TouchableOpacity style={styles.listItemAction} onPress={() => setShowTierSelector(true)}>
              <Text style={[styles.listValue, { color: theme.colors.text }]}>Upgrade</Text>
              <Icon name="chevron-right" size={24} color="#C7C7CC" />
            </TouchableOpacity>
          )}
        </View>

        {hasSummaryData && (
          <>
            <Text style={styles.sectionHeader}>Usage this month</Text>
            <View style={styles.cardGroup}>
              <View style={styles.usageItem}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
                  <Text style={[styles.listValue, { color: theme.colors.text, fontWeight: '600' }]}>AI Credits</Text>
                  <Text style={styles.listSubValue}>
                    {formatCurrency(aiUsedDollars)} of {formatCurrency(aiAllowanceDollars)}
                  </Text>
                </View>
                <HealthBar used={aiUsedCents} limit={aiAllowanceCents} fillColor={ANORHA_GREEN} />
                {aiOverageDollars > 0 && <Text style={{ fontSize: 13, color: '#DC2626', marginTop: 8, fontWeight: '500' }}>+ {formatCurrency(aiOverageDollars)} overage</Text>}
              </View>
              <View style={styles.separator} />
              <View style={styles.usageItem}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
                  <Text style={[styles.listValue, { color: theme.colors.text, fontWeight: '600' }]}>Team Members</Text>
                  <Text style={styles.listSubValue}>{teamMembersCount} / {teamMembersIncluded} spots</Text>
                </View>
                <HealthBar used={teamMembersCount} limit={teamMembersIncluded} fillColor={'#3B82F6'} />
                {teamMembersExtra > 0 && <Text style={{ fontSize: 13, color: '#3B82F6', marginTop: 8, fontWeight: '500' }}>+ {teamMembersExtra} extra member(s) ({formatCurrency(teamMembersCost)})</Text>}
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
                          <Text style={[styles.listValue, { fontWeight: '600' }]}>
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
                <View style={{ height: 1, backgroundColor: '#E5E5EA', marginVertical: 8 }} />
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={[styles.listValue, { fontWeight: '700' }]}>Estimated Total</Text>
                  <Text style={[styles.listValue, { fontWeight: '700' }]}>{formatCurrency(totalCostEstimate)}</Text>
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
                    <Text style={[styles.listValue, { fontWeight: '600' }]}>{formatCurrency(amt / 100)}</Text>
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
                          <Text style={[styles.listValue, { color: theme.colors.text }]}>
                            {d.toLocaleDateString()}
                          </Text>
                          <Text style={styles.listSubValue}>{(inv.status || 'paid').toUpperCase()}</Text>
                        </View>
                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                          <Text style={[styles.listValue, { color: theme.colors.text, marginRight: 8, fontWeight: '500' }]}>
                            {formatCurrency(amt / 100)}
                          </Text>
                          <Icon name="chevron-right" size={24} color="#C7C7CC" />
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
            <View>
              <Text style={[styles.listValue, { color: theme.colors.text }]}>Report Subscription Issue</Text>
              <Text style={[styles.listSubValue, { marginTop: 4 }]}>Send details and an optional screenshot to our support team.</Text>
            </View>
            <Icon name="chevron-right" size={24} color="#C7C7CC" />
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
  container: { flex: 1, backgroundColor: '#F2F2F7' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 12,
  },
  backBtn: { padding: 4, marginRight: 8 },
  headerTitle: { fontSize: 18, fontWeight: '600', marginLeft: -8 },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 32 },
  cardGroup: {
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: '#E5E5EA',
    marginBottom: 24,
  },
  listItem: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  listItemAction: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  usageItem: {
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  listLabel: {
    fontSize: 13,
    color: '#8E8E93',
    fontWeight: '600',
    marginBottom: 4,
  },
  listValue: {
    fontSize: 17,
  },
  listSubValue: {
    fontSize: 14,
    color: '#8E8E93',
    marginTop: 2,
  },
  separator: {
    height: 1,
    backgroundColor: '#E5E5EA',
    marginLeft: 16,
  },
  sectionHeader: {
    fontSize: 18,
    fontWeight: '600',
    color: '#000',
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  progressTrack: {
    height: 8,
    borderRadius: 4,
    backgroundColor: '#E5E5EA',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 4,
    backgroundColor: ANORHA_GREEN,
  },
});
