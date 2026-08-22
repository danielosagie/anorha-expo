// Privacy & Security: data policy summary plus the in-app account-erasure flow.

import React, { useContext, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronRight, FileText, ShieldCheck, Trash2 } from 'lucide-react-native';
import { BaseModal } from '../components/BaseModal';
import { PageHeader } from '../components/ui/PageHeader';
import { AuthContext } from '../context/AuthContext';
import { useOrg } from '../context/OrgContext';
import { apiJson, ApiError } from '../lib/apiClient';
import {
  deriveBillingState,
  formatBillingDate,
} from '../utils/billingState';
import {
  parseBillingSummaryPayload,
  type BillingSummaryPayload,
} from '../utils/billingPayload';

type DeletionResponse = {
  status?: 'scheduled' | 'deleted';
  requestId?: string;
};

const PrivacySecurityScreen = () => {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const authContext = useContext(AuthContext);
  const { currentOrg } = useOrg();

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [confirmName, setConfirmName] = useState('');
  const [reason, setReason] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [billingLoading, setBillingLoading] = useState(false);
  const [billingError, setBillingError] = useState<string | null>(null);
  const [billingSummary, setBillingSummary] = useState<BillingSummaryPayload | null>(null);

  const confirmationText = currentOrg?.name || 'DELETE';
  const billingState = deriveBillingState(billingSummary, new Date());
  const rawSubscriptionStatus = billingSummary?.subscription?.Status
    || billingSummary?.subscription?.status
    || null;
  const planName = billingSummary?.subscription?.CurrentPlan
    || billingSummary?.subscription?.current_plan
    || 'Paid plan';
  const hasActiveSubscription = billingState.subscription.state === 'active'
    || billingState.subscription.state === 'canceled_paid_through'
    || ['trialing', 'past_due', 'unpaid', 'incomplete'].includes(String(rawSubscriptionStatus || '').toLowerCase());
  const paidThrough = formatBillingDate(billingState.subscription.currentPeriodEnd);
  const billingVerified = billingSummary !== null && !billingLoading && !billingError;
  const confirmationMatches = confirmName.trim().toLowerCase() === confirmationText.toLowerCase();

  const loadBillingStatus = async () => {
    setBillingLoading(true);
    setBillingError(null);
    setBillingSummary(null);
    try {
      const payload = await apiJson<unknown>('/api/billing/summary');
      const parsed = parseBillingSummaryPayload(payload);
      if (!parsed.ok) throw new Error(`Invalid billing summary at ${parsed.field}`);
      setBillingSummary(parsed.value);
    } catch {
      setBillingError('Billing status is unavailable. Try again before deleting your account.');
    } finally {
      setBillingLoading(false);
    }
  };

  const openDeleteFlow = () => {
    setConfirmName('');
    setReason('');
    setDeleteOpen(true);
    void loadBillingStatus();
  };

  const closeDeleteFlow = () => {
    if (deleting) return;
    setDeleteOpen(false);
  };

  const confirmDelete = async () => {
    if (!billingVerified) {
      Alert.alert('Billing status required', 'Check your billing status before deleting your account.');
      return;
    }
    if (!confirmationMatches) {
      Alert.alert('Confirmation does not match', `Type ${confirmationText} exactly as shown.`);
      return;
    }
    setDeleting(true);
    try {
      // This versioned endpoint must return a durable request ID. The legacy
      // DELETE /api/users/me route can return 200 after only partial cleanup, so
      // it must never be treated as completed account erasure by the app.
      const result = await apiJson<DeletionResponse>('/api/users/me/erasure', {
        method: 'DELETE',
        body: {
          reason: reason.trim() || undefined,
          confirmation: confirmationText,
          activeSubscriptionAcknowledged: hasActiveSubscription,
        },
      });
      const accepted = (result?.status === 'scheduled' || result?.status === 'deleted')
        && typeof result?.requestId === 'string'
        && result.requestId.trim().length > 0;
      if (!accepted) {
        Alert.alert(
          'Deletion not confirmed',
          'The service did not confirm a complete deletion request. Your account has not been reported as deleted.',
        );
        return;
      }
      setDeleteOpen(false);
      await authContext?.signOut();
    } catch (error) {
      const message = error instanceof ApiError && error.status === 404
        ? 'Account deletion is not available on the server yet. Your account was not reported as deleted.'
        : 'The deletion request could not be completed. Your account was not reported as deleted.';
      Alert.alert('Deletion failed', message);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <View style={styles.root}>
      <StatusBar barStyle="dark-content" />
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + 8, paddingHorizontal: 18, paddingBottom: insets.bottom + 120 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <PageHeader title="Privacy & Security" onBack={() => navigation.goBack()} />

        <Text style={styles.section}>Your data</Text>
        <View style={styles.card}>
          <View style={styles.infoRow}>
            <View style={[styles.iconWrap, { backgroundColor: 'rgba(147,200,34,0.16)' }]}>
              <ShieldCheck size={20} color="#93C822" />
            </View>
            <Text style={styles.infoText}>
              Your listings, connections and usage data belong to your org. A completed account
              deletion removes them permanently.
            </Text>
          </View>
          <Pressable
            style={[styles.linkRow, styles.rowBorder]}
            onPress={() => navigation.navigate('DeleteAccountInfo')}
          >
            <View style={[styles.iconWrap, { backgroundColor: '#F1F1EE' }]}>
              <FileText size={20} color="#18181B" />
            </View>
            <Text style={styles.linkText}>Full data & deletion policy</Text>
            <ChevronRight size={20} color="#D4D4D8" />
          </Pressable>
        </View>

        <Text style={[styles.section, { marginTop: 26 }]}>Danger zone</Text>
        <View style={[styles.card, styles.dangerCard]}>
          <Pressable style={styles.linkRow} onPress={openDeleteFlow}>
            <View style={[styles.iconWrap, { backgroundColor: 'rgba(220,38,38,0.10)' }]}>
              <Trash2 size={20} color="#DC2626" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.dangerTitle}>Delete account</Text>
              <Text style={styles.dangerSub}>Request permanent deletion of your account and data</Text>
            </View>
            <ChevronRight size={20} color="#D4D4D8" />
          </Pressable>
        </View>
      </ScrollView>

      <BaseModal
        visible={deleteOpen}
        onClose={closeDeleteFlow}
        position="bottom"
        containerStyle={styles.modalCard}
      >
        <ScrollView
          style={styles.modalScroll}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
            <Text style={styles.modalTitle}>Delete account?</Text>
            <Text style={styles.modalBody}>
              This starts permanent deletion of your account and associated data. This cannot be undone.
            </Text>
            <View style={[styles.billingNotice, hasActiveSubscription && styles.billingNoticeActive]}>
              {billingLoading ? (
                <View style={styles.billingLoadingRow}>
                  <ActivityIndicator color="#18181B" size="small" />
                  <Text style={styles.billingNoticeText}>Checking billing status</Text>
                </View>
              ) : billingError ? (
                <>
                  <Text style={styles.billingNoticeText}>{billingError}</Text>
                  <Pressable style={styles.billingRetry} onPress={() => void loadBillingStatus()}>
                    <Text style={styles.billingRetryText}>Retry</Text>
                  </Pressable>
                </>
              ) : hasActiveSubscription ? (
                <>
                  <Text style={styles.billingNoticeTitle}>Subscription on account</Text>
                  <Text style={styles.billingNoticeText}>
                    {planName} is {billingState.subscription.state === 'canceled_paid_through' ? 'canceled' : String(rawSubscriptionStatus || 'active').replace(/_/g, ' ')}
                    {paidThrough ? ` through ${paidThrough}` : ''}. Deleting your Anorha account does not cancel provider billing or stop charges. Manage billing first if needed.
                  </Text>
                  <Pressable
                    style={styles.billingRetry}
                    onPress={() => {
                      setDeleteOpen(false);
                      navigation.navigate('Billing');
                    }}
                  >
                    <Text style={styles.billingRetryText}>Review billing</Text>
                  </Pressable>
                </>
              ) : (
                <>
                  <Text style={styles.billingNoticeTitle}>Billing status</Text>
                  <Text style={styles.billingNoticeText}>No active subscription.</Text>
                </>
              )}
            </View>
            <Text style={styles.modalLabel}>
              Type <Text style={styles.modalStrong}>{confirmationText}</Text> to confirm
            </Text>
            <TextInput
              style={styles.input}
              value={confirmName}
              onChangeText={setConfirmName}
              placeholder={confirmationText}
              placeholderTextColor="#C7C7CC"
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Text style={styles.modalLabel}>Reason (optional)</Text>
            <TextInput
              style={[styles.input, { minHeight: 64 }]}
              value={reason}
              onChangeText={setReason}
              placeholder="A sentence is plenty"
              placeholderTextColor="#C7C7CC"
              multiline
            />
            <View style={styles.modalActions}>
              <Pressable style={styles.cancelBtn} onPress={closeDeleteFlow}>
                <Text style={styles.cancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.deleteBtn, (!billingVerified || !confirmationMatches || deleting) && styles.disabledBtn]}
                onPress={confirmDelete}
                disabled={!billingVerified || !confirmationMatches || deleting}
              >
                {deleting ? <ActivityIndicator color="#FFFFFF" size="small" /> : <Text style={styles.deleteText}>Delete account</Text>}
              </Pressable>
            </View>
        </ScrollView>
      </BaseModal>
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F6F7F4' },
  section: { fontSize: 13, color: '#71717A', fontFamily: 'Inter_600SemiBold', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10, marginLeft: 4 },
  card: { backgroundColor: '#FFFFFF', borderRadius: 20, paddingHorizontal: 16, borderWidth: 1, borderColor: '#ECEBE6' },
  dangerCard: { borderColor: 'rgba(220,38,38,0.25)' },

  infoRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 14, paddingVertical: 16 },
  infoText: { flex: 1, fontSize: 14, color: '#71717A', fontFamily: 'Inter_400Regular', lineHeight: 21 },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14 },
  rowBorder: { borderTopWidth: 1, borderTopColor: '#F1F1EE' },
  linkText: { flex: 1, fontSize: 16, color: '#18181B', fontFamily: 'Inter_600SemiBold' },
  iconWrap: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },

  dangerTitle: { fontSize: 16, color: '#DC2626', fontFamily: 'Inter_600SemiBold' },
  dangerSub: { fontSize: 13, color: '#9CA3AF', fontFamily: 'Inter_400Regular', marginTop: 2 },

  modalCard: { maxHeight: '90%', alignItems: 'stretch', padding: 20 },
  modalScroll: { width: '100%' },
  modalTitle: { fontSize: 20, color: '#18181B', fontFamily: 'Inter_700Bold', marginBottom: 8 },
  modalBody: { fontSize: 14, color: '#71717A', fontFamily: 'Inter_400Regular', lineHeight: 21, marginBottom: 14 },
  billingNotice: { backgroundColor: '#F1F1EE', borderRadius: 14, padding: 12, marginBottom: 10 },
  billingNoticeActive: { backgroundColor: '#FFF4E5', borderWidth: 1, borderColor: '#F4C27A' },
  billingLoadingRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  billingNoticeTitle: { fontSize: 14, color: '#18181B', fontFamily: 'Inter_700Bold', marginBottom: 4 },
  billingNoticeText: { fontSize: 13, color: '#52525B', fontFamily: 'Inter_400Regular', lineHeight: 19 },
  billingRetry: { alignSelf: 'flex-start', paddingVertical: 8, paddingRight: 12, marginTop: 2 },
  billingRetryText: { fontSize: 14, color: '#18181B', fontFamily: 'Inter_700Bold' },
  modalLabel: { fontSize: 13, color: '#18181B', fontFamily: 'Inter_600SemiBold', marginBottom: 6, marginTop: 6 },
  modalStrong: { fontFamily: 'Inter_700Bold' },
  input: {
    borderWidth: 1, borderColor: '#ECEBE6', borderRadius: 14, paddingHorizontal: 14, paddingVertical: 11,
    fontSize: 15, color: '#18181B', fontFamily: 'Inter_400Regular', backgroundColor: '#FAFAF8', marginBottom: 8,
  },
  modalActions: { flexDirection: 'row', gap: 10, marginTop: 12 },
  cancelBtn: { flex: 1, borderRadius: 16, paddingVertical: 14, alignItems: 'center', backgroundColor: '#F1F1EE' },
  cancelText: { fontSize: 15, color: '#18181B', fontFamily: 'Inter_600SemiBold' },
  deleteBtn: { flex: 1, borderRadius: 16, paddingVertical: 14, alignItems: 'center', backgroundColor: '#DC2626' },
  disabledBtn: { opacity: 0.45 },
  deleteText: { fontSize: 15, color: '#FFFFFF', fontFamily: 'Inter_700Bold' },
});

export default PrivacySecurityScreen;
