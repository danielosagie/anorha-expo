import React, { useState, useEffect, useCallback } from 'react';
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
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '@clerk/clerk-expo';
import Card from '../components/Card';
import TierSelectorModal from '../components/TierSelectorModal';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const API_BASE_RAW = process.env.EXPO_PUBLIC_API_BASE_URL || 'https://api.sssync.app';
const API_BASE = API_BASE_RAW.replace(/\/$/, '').endsWith('/api')
  ? API_BASE_RAW.replace(/\/$/, '')
  : `${API_BASE_RAW.replace(/\/$/, '')}/api`;

const ANORHA_GREEN = '#647653';
const CREAM_BG = '#FEF4DD';

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
    match_serpapi_search: 'Product Search',
    generation_firecrawl: 'Web Scraping',
    sync: 'Inventory Sync',
    import: 'Product Import',
    export: 'Product Export',
  };
  return displayNames[key] || key.replace(/^ai_/, '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

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

  const planFromSummary =
    summary?.subscription?.CurrentPlan || summary?.tier_name || summary?.subscription?.current_plan;
  const subscriptionStatus = summary?.subscription?.Status || summary?.subscription?.status;
  const planName = (planFromSummary as 'Growth' | 'Teams' | undefined) || undefined;

  const aiScansUsed = safeNumber(summary?.ai_scans_used);
  const aiScansLimit = safeNumber(summary?.ai_scans_limit, planName === 'Teams' ? 80 : 40);
  const aiCreditsUsed = safeNumber(summary?.ai_credits_used, aiScansUsed);
  const aiCreditsLimit = safeNumber(summary?.ai_credits_limit, aiScansLimit);
  const aiOverageCents = safeNumber(summary?.ai_credits_overage_cents, 0);
  const aiOverageDollars = aiOverageCents / 100;
  const aiUnitCents = safeNumber(summary?.ai_credit_unit_cents, planName === 'Teams' ? 15 : 20);
  const teamMembersCount = safeNumber(summary?.team_members_count);
  const teamMembersIncluded = safeNumber(summary?.team_members_included);
  const teamMembersExtra = Math.max(0, safeNumber(summary?.team_members_extra));
  const teamMembersCost = safeNumber(summary?.team_members_cost);
  const totalThisMonth = safeNumber(summary?.total);
  const displayedTeamMembersCost = teamMembersCost;
  const displayedTotal = totalThisMonth;
  const pricePerScan = aiUnitCents / 100;

  let planTitle = 'No active plan';
  let planDescription = 'Choose a plan to unlock live sync, AI scanning, and team features.';
  if (planName === 'Growth') {
    planTitle = 'Growth · $20/month';
    planDescription = `${teamMembersIncluded || 2} users/partners included, unlimited platforms & inventory, AI: ${aiScansLimit || 40} scans included then ${formatCurrency(pricePerScan)}/scan.`;
  } else if (planName === 'Teams') {
    planTitle = 'Teams · $60/month';
    planDescription = `${teamMembersIncluded || 5} users/partners (+$10/spot after), unlimited platforms & inventory, AI: ${aiScansLimit || 80} scans included then ${formatCurrency(pricePerScan)}/scan.`;
  }

  const featureUsage = summary?.usage || {};
  const featureEntries = Object.entries(featureUsage || {});
  const hasFeatureUsage = featureEntries.some(
    ([, value]: [string, any]) =>
      (value.totalQuantity || value.count || 0) > 0 || (value.totalCost || 0) > 0
  );
  const hasAiUsage = aiCreditsUsed > 0 || aiScansUsed > 0;
  const hasAnyUsage = hasAiUsage || hasFeatureUsage;

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
        await Linking.openURL(data.url);
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

  return (
    <View style={[styles.container, { backgroundColor: CREAM_BG, paddingTop: insets.top }]}>
      <View style={[styles.header, { borderBottomColor: '#E5E7EB' }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
            <Icon name="arrow-left" size={24} color={theme.colors.text} />
          </TouchableOpacity>
          <View>
            <Text style={[styles.headerTitle, { color: theme.colors.text }]}>Billing</Text>
            <Text style={[styles.subtitle, { color: theme.colors.textSecondary }]}>Subscription & credits</Text>
          </View>
        </View>
      </View>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl refreshing={isRefreshing} onRefresh={refreshBillingData} colors={[ANORHA_GREEN]} />
        }
      >
        <Text style={[styles.description, { color: theme.colors.textSecondary }]}>
          Manage your subscription, usage, and billing information
        </Text>

        <View style={styles.actionsRow}>
          <TouchableOpacity
            style={[styles.primaryButton, hasActiveSubscription && styles.primaryButtonSecondary]}
            onPress={hasActiveSubscription ? handleManageSubscription : () => setShowTierSelector(true)}
          >
            <Icon name="open-in-new" size={18} color="#fff" style={{ marginRight: 6 }} />
            <Text style={styles.primaryButtonText}>
              {hasActiveSubscription ? 'Manage Subscription' : 'Subscribe Now'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.refreshButton, { backgroundColor: "#fff",borderColor: '#E5E7EB' }]}
            onPress={refreshBillingData}
            disabled={isRefreshing}
          >
            {isRefreshing ? (
              <ActivityIndicator size="small" color={ANORHA_GREEN} />
            ) : (
              <Icon name="refresh" size={18} color={theme.colors.text} />
            )}
            <Text style={[styles.refreshText, { color: theme.colors.text }]}>
              {isRefreshing ? 'Refreshing...' : 'Refresh'}
            </Text>
          </TouchableOpacity>
        </View>

        {actionError ? (
          <View style={styles.errorBanner}>
            <Icon name="alert-circle" size={18} color="#92400e" />
            <Text style={styles.errorBannerText}>{actionError}</Text>
          </View>
        ) : null}

        {!hasSummaryData ? (
          <View style={styles.noDataBanner}>
            <Text style={styles.noDataBannerText}>
              Billing data is temporarily unavailable. Use Refresh to retry.
            </Text>
          </View>
        ) : null}

        <Card style={styles.card}>
          <View style={styles.cardHeaderColumn}>
            <View style={{ marginBottom: 12 }}>
              <Text style={[styles.planTitle, { color: theme.colors.text }]}>{planTitle}</Text>
              <Text style={[styles.planDescription, { color: theme.colors.textSecondary }]}>
                {planDescription}
              </Text>
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={[styles.periodText, { color: theme.colors.textSecondary }]}>
                {summary?.subscription?.CurrentPeriodEnd
                  ? `Ends ${new Date(summary.subscription.CurrentPeriodEnd).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                  })}`
                  : 'No active subscription'}
              </Text>
              <View
                style={[
                  styles.badge,
                  subscriptionStatus === 'active' ? { backgroundColor: ANORHA_GREEN } : { backgroundColor: '#9ca3af' },
                ]}
              >
                <Text style={styles.badgeText}>{subscriptionStatus === 'active' ? 'Active' : 'Inactive'}</Text>
              </View>
            </View>
          </View>
          <View style={styles.paramList}>
            <View style={styles.paramRow}>
              <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <View style={[styles.usageIconBubble, { backgroundColor: ANORHA_GREEN + '15' }]}>
                  <Icon name="account-group" size={18} color={ANORHA_GREEN} />
                </View>
                <View>
                  <Text style={[styles.paramTitle, { color: theme.colors.text }]}>Team Members</Text>
                  <Text style={[styles.paramSubtitle, { color: theme.colors.textSecondary }]}>
                    {teamMembersCount} ({teamMembersIncluded} included, {teamMembersExtra} extra)
                  </Text>
                </View>
              </View>
              <Text style={[styles.paramValue, { color: theme.colors.text }]}>
                {displayedTeamMembersCost > 0 ? `$${displayedTeamMembersCost.toFixed(2)}` : 'Included'}
              </Text>
            </View>

            {hasAiUsage && (
              <View style={styles.paramRow}>
                <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <View style={[styles.usageIconBubble, { backgroundColor: '#eab30815' }]}>
                    <Icon name="lightning-bolt" size={18} color="#eab308" />
                  </View>
                  <View>
                    <Text style={[styles.paramTitle, { color: theme.colors.text }]}>AI Credits</Text>
                    <Text style={[styles.paramSubtitle, { color: theme.colors.textSecondary }]}>
                      {aiCreditsUsed} / {aiCreditsLimit} credits used
                    </Text>
                  </View>
                </View>
                <Text style={[styles.paramValue, { color: theme.colors.text }]}>
                  {aiOverageDollars > 0 ? `$${aiOverageDollars.toFixed(2)}` : 'Included'}
                </Text>
              </View>
            )}

            {hasFeatureUsage &&
              featureEntries.slice(0, 3).map(([key, value]: [string, any]) => (
                <View key={key} style={styles.paramRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.paramTitle, { color: theme.colors.text }]}>
                      {getFeatureDisplayName(key)}
                    </Text>
                    <Text style={[styles.paramSubtitle, { color: theme.colors.textSecondary }]}>
                      {value.totalQuantity || value.count || 0} units
                    </Text>
                  </View>
                  <Text style={[styles.paramValue, { color: theme.colors.text }]}>
                    ${((value.totalCost || 0) / 100).toFixed(2)}
                  </Text>
                </View>
              ))}

            {!hasAnyUsage && (
              <View style={[styles.paramRow, { justifyContent: 'center', borderBottomWidth: 0 }]}>
                <Text style={{ color: theme.colors.textSecondary, fontStyle: 'italic' }}>
                  No usage this month
                </Text>
              </View>
            )}

            <View style={styles.totalRow}>
              <Text style={[styles.totalLabel, { color: theme.colors.text }]}>Total This Month</Text>
              <Text style={[styles.totalValue, { color: ANORHA_GREEN }]}>
                ${displayedTotal.toFixed(2)}
              </Text>
            </View>
          </View>
        </Card>

        <Card style={styles.card}>
          <Text style={[styles.cardTitle, { color: theme.colors.text }]}>Current Usage</Text>
          <Text style={[styles.cardDescription, { color: theme.colors.textSecondary }]}>
            Usage for the current billing period
          </Text>
          <View style={styles.usageRow}>
            <Text style={[styles.usageLabel, { color: theme.colors.text }]}>AI Credits</Text>
            <Text style={[styles.usageValue, { color: theme.colors.text }]}>
              {aiCreditsUsed} / {aiCreditsLimit} credits
              {aiOverageDollars > 0 ? (
                <Text style={{ color: theme.colors.textSecondary }}> (${aiOverageDollars.toFixed(2)} overage)</Text>
              ) : null}
            </Text>
          </View>
          <View style={[styles.progressTrack, { backgroundColor: '#e5e7eb' }]}>
            <View
              style={[
                styles.progressFill,
                {
                  width: `${aiCreditsLimit > 0 ? Math.min(100, (aiCreditsUsed / aiCreditsLimit) * 100) : 0}%`,
                  backgroundColor: '#eab308',
                },
              ]}
            />
          </View>
          <TouchableOpacity
            style={[styles.addCreditsButton, { borderColor: ANORHA_GREEN }]}
            onPress={() => setShowCreditsModal(true)}
          >
            <Icon name="plus-circle-outline" size={18} color="#fff" style={{ marginRight: 6 }} />
            <Text style={styles.addCreditsButtonText}>Add Credits</Text>
          </TouchableOpacity>
        </Card>

        {isPartner ? (
          <Card style={[styles.card, styles.partnerCard]}>
            <Text style={[styles.cardTitle, { color: theme.colors.text }]}>Unlock Full Features</Text>
            <Text style={[styles.cardDescription, { color: theme.colors.textSecondary }]}>
              Upgrade to your own plan for full sync + AI features, or add a payment method for per-usage AI
            </Text>
            <TouchableOpacity
              style={[styles.upgradeButton, { borderColor: '#000' }]}
              onPress={() => setShowTierSelector(true)}
            >
              <Text style={styles.upgradeButtonText}>Upgrade</Text>
            </TouchableOpacity>
            {partnerPaymentMethod?.hasPaymentMethod ? (
              <View style={[styles.paymentMethodRow, { borderColor: '#E5E7EB' }]}>
                <Text style={[styles.paymentMethodText, { color: theme.colors.text }]}>
                  {partnerPaymentMethod.brand || 'Card'} •••• {partnerPaymentMethod.lastFour || '****'}
                </Text>
                {partnerPaymentMethod.expiresAt ? (
                  <Text style={[styles.paymentMethodExpiry, { color: theme.colors.textSecondary }]}>
                    Expires {partnerPaymentMethod.expiresAt}
                  </Text>
                ) : null}
                <TouchableOpacity onPress={handleAddPartnerPaymentMethod} disabled={isAddingPaymentMethod}>
                  <Text style={[styles.linkText, { color: ANORHA_GREEN }]}>
                    {isAddingPaymentMethod ? 'Loading...' : 'Update'}
                  </Text>
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity
                style={[styles.addCardButton, { borderColor: ANORHA_GREEN }]}
                onPress={handleAddPartnerPaymentMethod}
                disabled={isAddingPaymentMethod}
              >
                <Text style={styles.addCardButtonText}>
                  {isAddingPaymentMethod ? 'Loading...' : 'Add Card'}
                </Text>
              </TouchableOpacity>
            )}
          </Card>
        ) : null}

        <Card style={styles.card}>
          <Text style={[styles.cardTitle, { color: theme.colors.text }]}>
            {upcoming?.upcoming ? 'Upcoming Invoice' : 'No Upcoming Invoice'}
          </Text>
          {upcoming?.upcoming ? (
            <View style={styles.upcomingRow}>
              <Text style={[styles.upcomingAmount, { color: theme.colors.text }]}>
                {(() => {
                  const total = upcoming.upcoming.total;
                  const amount =
                    typeof total === 'object'
                      ? (total?.price_amount || total?.amount || 0) / 100
                      : (total || 0) / 100;
                  return amount.toLocaleString(undefined, { style: 'currency', currency: 'USD' });
                })()}
              </Text>
              <Text style={[styles.upcomingDue, { color: theme.colors.textSecondary }]}>
                Due {new Date(upcoming.upcoming.due_date || Date.now()).toLocaleDateString()}
              </Text>
            </View>
          ) : (
            <Text style={[styles.noUpcoming, { color: theme.colors.textSecondary }]}>
              You have no upcoming invoice.
            </Text>
          )}
        </Card>

        <Card style={styles.card}>
          <Text style={[styles.cardTitle, { color: theme.colors.text }]}>Invoice History</Text>
          <Text style={[styles.cardDescription, { color: theme.colors.textSecondary }]}>
            Your billing history and payment records
          </Text>
          {invoices?.invoices && invoices.invoices.length > 0 ? (
            invoices.invoices.map((inv: any) => (
              <TouchableOpacity
                key={inv.id}
                style={[styles.invoiceRow, { borderColor: '#E5E7EB' }]}
                onPress={() => openInvoiceUrl(inv)}
              >
                <View>
                  <Text style={[styles.invoiceDate, { color: theme.colors.text }]}>
                    {(() => {
                      const created = inv.created_at || inv.created;
                      if (!created) return 'N/A';
                      const timestamp =
                        typeof created === 'number' && created < 10000000000 ? created * 1000 : created;
                      return new Date(timestamp).toLocaleDateString();
                    })()}
                  </Text>
                  <Text style={[styles.invoiceNumber, { color: theme.colors.textSecondary }]}>
                    {inv.number || 'Invoice'}
                  </Text>
                </View>
                <View style={styles.invoiceRight}>
                  <View
                    style={[
                      styles.invoiceBadge,
                      inv.status === 'paid' ? { backgroundColor: `${ANORHA_GREEN}20`, borderColor: ANORHA_GREEN } : {},
                    ]}
                  >
                    <Text style={[styles.invoiceBadgeText, inv.status === 'paid' && { color: ANORHA_GREEN }]}>
                      {inv.status || 'open'}
                    </Text>
                  </View>
                  <Text style={[styles.invoiceAmount, { color: theme.colors.text }]}>
                    {(() => {
                      const amount = inv.total_amount ?? inv.total ?? 0;
                      return (amount / 100).toLocaleString(undefined, {
                        style: 'currency',
                        currency: (inv.currency || 'usd').toUpperCase(),
                        minimumFractionDigits: 2,
                      });
                    })()}
                  </Text>
                  {(inv.hosted_invoice_url || inv.hosted_url || inv.url) ? (
                    <Icon name="open-in-new" size={16} color={theme.colors.textSecondary} />
                  ) : null}
                </View>
              </TouchableOpacity>
            ))
          ) : (
            <View style={styles.emptyStateContainer}>
              <View style={[styles.emptyStateIconBubble, { backgroundColor: ANORHA_GREEN + '15' }]}>
                <Icon name="receipt" size={32} color={ANORHA_GREEN} />
              </View>
              <Text style={[styles.emptyStateTitle, { color: theme.colors.text, fontSize: 16 }]}>No invoices yet</Text>
              <Text style={[styles.emptyStateDescription, { color: theme.colors.textSecondary }]}>
                Your monthly subscription and usage invoices will appear here.
              </Text>
            </View>
          )}
        </Card>
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

      <Modal visible={showCreditsModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: theme.colors.background }]}>
            <Text style={[styles.modalTitle, { color: theme.colors.text }]}>Add Credits</Text>
            <Text style={[styles.modalSubtitle, { color: theme.colors.textSecondary }]}>
              Choose an amount to add to your balance
            </Text>
            <View style={styles.creditAmounts}>
              {[10, 25, 50, 100].map((amt) => (
                <TouchableOpacity
                  key={amt}
                  style={[
                    styles.creditAmountBtn,
                    selectedCreditAmount === amt && styles.creditAmountBtnSelected,
                    { borderColor: '#E5E7EB' },
                  ]}
                  onPress={() => setSelectedCreditAmount(amt)}
                >
                  <Text
                    style={[
                      styles.creditAmountBtnText,
                      { color: theme.colors.text },
                      selectedCreditAmount === amt && styles.creditAmountBtnTextSelected,
                    ]}
                  >
                    ${amt}
                  </Text>
                </TouchableOpacity>
              ))}
              <TouchableOpacity
                style={[styles.creditAmountBtn, { borderColor: '#E5E7EB' }]}
                onPress={() => setSelectedCreditAmount(75)}
              >
                <Text style={[styles.creditAmountBtnText, { color: theme.colors.text }]}>Custom</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.modalSubmit, !selectedCreditAmount && styles.modalSubmitDisabled]}
                onPress={handleAddCredits}
                disabled={!selectedCreditAmount || isTopUpLoading}
              >
                <Text style={styles.modalSubmitText}>
                  {isTopUpLoading ? 'Processing...' : `Add $${selectedCreditAmount || 0} Credits`}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setShowCreditsModal(false)}>
                <Text style={[styles.modalCancel, { color: theme.colors.textSecondary }]}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: { padding: 4, marginRight: 8 },
  headerTitle: { fontSize: 18, fontWeight: '600' },
  scroll: { flex: 1 },
  scrollContent: { padding: 12, paddingBottom: 32 },
  description: { fontSize: 13, marginBottom: 16 },
  actionsRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 },
  primaryButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: ANORHA_GREEN,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: ANORHA_GREEN,
  },
  primaryButtonSecondary: { backgroundColor: ANORHA_GREEN },
  primaryButtonText: { color: '#fff', fontSize: 14, fontWeight: '500' },
  refreshButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 2,
    gap: 6,
  },
  refreshText: { fontSize: 13 },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    padding: 12,
    marginBottom: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#fcd34d',
    backgroundColor: '#fef3c7',
  },
  errorBannerText: { flex: 1, fontSize: 13, color: '#92400e' },
  noDataBanner: {
    padding: 12,
    marginBottom: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#fde047',
    backgroundColor: '#fef9c3',
  },
  noDataBannerText: { fontSize: 13, color: '#854d0e' },
  card: { marginBottom: 16 },
  cardHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 },
  planTitle: { fontSize: 16, fontWeight: '600' },
  planDescription: { fontSize: 12, marginTop: 4 },
  periodText: { fontSize: 12 },
  badge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, marginTop: 4 },
  badgeText: { color: '#fff', fontSize: 12, fontWeight: '500' },
  cardHeaderColumn: { flexDirection: 'column' },
  paramList: { marginTop: 8 },
  paramRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e5e7eb',
  },
  paramTitle: { fontSize: 14, fontWeight: '600' },
  paramSubtitle: { fontSize: 12, marginTop: 2 },
  paramValue: { fontSize: 14, fontWeight: '600' },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
  },
  totalLabel: { fontSize: 16, fontWeight: '700' },
  totalValue: { fontSize: 20, fontWeight: '700' },
  cardTitle: { fontSize: 15, fontWeight: '600', marginBottom: 4 },
  cardDescription: { fontSize: 12, marginBottom: 12 },
  usageRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 },
  usageLabel: { fontSize: 12, fontWeight: '600' },
  usageValue: { fontSize: 12 },
  progressTrack: { height: 12, borderRadius: 6, overflow: 'hidden', marginBottom: 12 },
  progressFill: { height: '100%', borderRadius: 6 },
  addCreditsButton: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: ANORHA_GREEN,
    borderWidth: 2,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
  },
  addCreditsButtonText: { color: '#fff', fontSize: 14 },
  partnerCard: { borderColor: '#fde047', backgroundColor: '#fefce8' },
  upgradeButton: {
    alignSelf: 'stretch',
    backgroundColor: '#374151',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 8,
    marginBottom: 12,
    alignItems: 'center',
  },
  upgradeButtonText: { color: '#FFF', fontSize: 16, fontWeight: '600' },
  paymentMethodRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    padding: 12,
    borderWidth: 1,
    borderRadius: 8,
  },
  paymentMethodText: { fontSize: 14 },
  paymentMethodExpiry: { fontSize: 12 },
  linkText: { fontSize: 14, fontWeight: '500' },
  addCardButton: {
    alignSelf: 'flex-start',
    borderWidth: 2,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
  },
  addCardButtonText: { fontSize: 14, color: ANORHA_GREEN, fontWeight: '500' },
  upcomingRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  upcomingAmount: { fontSize: 20, fontWeight: '700' },
  upcomingDue: { fontSize: 13 },
  noUpcoming: { fontSize: 13 },
  invoiceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
  },
  invoiceDate: { fontSize: 14, fontWeight: '500' },
  invoiceNumber: { fontSize: 12, marginTop: 2 },
  invoiceRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  invoiceBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#d1d5db',
  },
  invoiceBadgeText: { fontSize: 11 },
  invoiceAmount: { fontSize: 14, fontWeight: '500' },
  noInvoices: { fontSize: 13, textAlign: 'center', paddingVertical: 24 },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    padding: 24,
  },
  modalContent: { borderRadius: 12, padding: 20 },
  modalTitle: { fontSize: 17, fontWeight: '600', marginBottom: 4 },
  modalSubtitle: { fontSize: 13, marginBottom: 16 },
  creditAmounts: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  creditAmountBtn: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 2,
  },
  creditAmountBtnSelected: { backgroundColor: ANORHA_GREEN, borderColor: ANORHA_GREEN },
  creditAmountBtnText: { fontSize: 14 },
  creditAmountBtnTextSelected: { color: '#fff' },
  modalActions: { gap: 12 },
  modalSubmit: {
    backgroundColor: ANORHA_GREEN,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  modalSubmitDisabled: { backgroundColor: '#9ca3af', opacity: 0.8 },
  modalSubmitText: { color: '#fff', fontWeight: '600' },
  modalCancel: { fontSize: 14, textAlign: 'center' },
  subtitle: {
    fontSize: 13,
    fontWeight: '500',
    marginTop: 2,
  },
  usageIconBubble: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyStateContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    marginTop: 8,
  },
  emptyStateIconBubble: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  emptyStateTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 4,
    textAlign: 'center',
  },
  emptyStateDescription: {
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
    maxWidth: '90%',
  },
});
