import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import BaseModal from './BaseModal';
import Button from './Button';
import { BillingGateResponse } from '../types/billingGate';

interface BillingGateSheetProps {
  visible: boolean;
  gate: BillingGateResponse | null;
  onClose: () => void;
  onOpenBilling: () => void;
  onContinue?: () => void;
}

function formatCurrency(cents: number) {
  return `$${(Math.max(0, cents) / 100).toFixed(2)}`;
}

export default function BillingGateSheet({
  visible,
  gate,
  onClose,
  onOpenBilling,
  onContinue,
}: BillingGateSheetProps) {
  if (!gate) {
    return null;
  }

  const invoiceable = gate.code === 'credits_exhausted_but_invoiceable';
  const unavailable = gate.code === 'billing_status_unavailable';
  const blocked = !gate.canProceed;
  const title = unavailable
    ? 'Billing check unavailable'
    : invoiceable
      ? 'This scan can still run'
      : 'Billing needed to continue';
  const primaryTitle = unavailable ? 'Try Again' : invoiceable ? 'Continue' : 'Open Billing';

  return (
    <BaseModal visible={visible} onClose={onClose} position="bottom" containerStyle={styles.container}>
      <View style={styles.handle} />
      <View style={styles.headerRow}>
        <View style={styles.headerIcon}>
          <Icon
            name={invoiceable ? 'credit-card-outline' : unavailable ? 'wifi-alert' : 'shield-alert-outline'}
            size={18}
            color="#7C4A21"
          />
        </View>
        <View style={styles.headerTextWrap}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.subtitle}>{gate.message}</Text>
        </View>
      </View>

      <View style={styles.statGroup}>
        <View style={styles.statRow}>
          <Text style={styles.statLabel}>Estimated</Text>
          <Text style={styles.statValue}>{formatCurrency(gate.estimatedCostCents)}</Text>
        </View>
        <View style={styles.separator} />
        <View style={styles.statRow}>
          <Text style={styles.statLabel}>Used</Text>
          <Text style={styles.statValue}>{formatCurrency(gate.currentUsageCents)}</Text>
        </View>
        <View style={styles.separator} />
        <View style={styles.statRow}>
          <Text style={styles.statLabel}>Included</Text>
          <Text style={styles.statValue}>{formatCurrency(gate.allowanceCents)}</Text>
        </View>
        {typeof gate.freeUsageCount === 'number' && typeof gate.freeLimit === 'number' ? (
          <>
            <View style={styles.separator} />
            <View style={styles.statRow}>
              <Text style={styles.statLabel}>Free usage</Text>
              <Text style={styles.statValue}>Limit reached</Text>
            </View>
          </>
        ) : null}
      </View>

      <Text style={styles.footnote}>
        {invoiceable
          ? 'This work can finish now. New AI work will pause later if billing still needs attention.'
          : blocked
            ? 'Your current draft stays here and can resume after billing is updated.'
            : 'Retry once your session reconnects.'}
      </Text>

      <Button
        title={primaryTitle}
        onPress={invoiceable ? (onContinue || onClose) : unavailable ? onClose : onOpenBilling}
        style={styles.primaryButton}
        textStyle={styles.primaryButtonText}
      />

      {!unavailable ? (
        <TouchableOpacity
          onPress={invoiceable ? onOpenBilling : onClose}
          style={styles.secondaryButton}
        >
          <Text style={styles.secondaryButtonText}>
            {invoiceable ? 'Open Billing' : 'Not now'}
          </Text>
        </TouchableOpacity>
      ) : null}
    </BaseModal>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingTop: 14,
    paddingBottom: 28,
    backgroundColor: '#FFFDF9',
  },
  handle: {
    width: 42,
    height: 5,
    borderRadius: 999,
    backgroundColor: '#E6DDD2',
    alignSelf: 'center',
    marginBottom: 18,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 18,
  },
  headerIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#F8E8D4',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  headerTextWrap: {
    flex: 1,
  },
  title: {
    fontSize: 19,
    fontWeight: '700',
    color: '#1F2937',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    lineHeight: 20,
    color: '#6B7280',
  },
  statGroup: {
    borderRadius: 18,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    minWidth: "100%",
    borderColor: '#EEE6DA',
    overflow: 'hidden',
    marginBottom: 14,
  },
  statRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    minWidth: "100%",
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  statLabel: {
    fontSize: 14,
    color: '#6B7280',
  },
  statValue: {
    fontSize: 14,
    fontWeight: '600',
    color: '#111827',
  },
  separator: {
    height: 1,
    backgroundColor: '#F3EEE7',
  },
  footnote: {
    fontSize: 13,
    lineHeight: 18,
    color: '#6B7280',
    marginBottom: 16,
  },
  primaryButton: {
    minWidth: "100%",
    backgroundColor: '#8A5A2B',
    borderRadius: 14,
    paddingVertical: 21,
  },
  primaryButtonText: {
    color: '#FFFDF9',
    fontWeight: '700',
  },
  secondaryButton: {
    minWidth: "100%",
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 21,
  },
  secondaryButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#7C4A21',
  },
});
