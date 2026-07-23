import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import BaseModal from './BaseModal';
import { BillingGateResponse } from '../types/billingGate';
import { BRAND_PRIMARY } from '../design/tokens';

interface BillingGateSheetProps {
  visible: boolean;
  gate: BillingGateResponse | null;
  onClose: () => void;
  onSeePlans?: () => void;
  onAddCredits?: () => void;
  /** Backward-compatible alias used by design-export fixtures. */
  onOpenBilling?: () => void;
  onContinue?: () => void;
}

export default function BillingGateSheet({
  visible,
  gate,
  onClose,
  onSeePlans,
  onAddCredits,
  onOpenBilling,
  onContinue,
}: BillingGateSheetProps) {
  if (!gate) {
    return null;
  }

  const invoiceable = gate.code === 'credits_exhausted_but_invoiceable';
  const unavailable = gate.code === 'billing_status_unavailable';
  const title = unavailable
    ? 'Could not check your scans'
    : invoiceable
      ? 'This scan can continue'
      : "You're out of free scans";
  const body = unavailable
    ? 'Check your connection, then try the scan again.'
    : invoiceable
      ? 'You can finish this scan now or review billing first.'
      : typeof gate.freeUsageCount === 'number' && typeof gate.freeLimit === 'number'
        ? `${gate.freeUsageCount} of ${gate.freeLimit} free scans used.`
        : 'Choose a plan or add credits to keep scanning.';
  const seePlans = onSeePlans || onOpenBilling || onClose;

  return (
    <BaseModal visible={visible} onClose={onClose} position="bottom" containerStyle={styles.container}>
      <View style={styles.handle} />
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.subtitle}>{body}</Text>

      <TouchableOpacity
        onPress={invoiceable ? (onContinue || onClose) : unavailable ? onClose : seePlans}
        style={styles.primaryButton}
        activeOpacity={0.86}
      >
        <Text style={styles.primaryButtonText}>
          {invoiceable ? 'Continue scan' : unavailable ? 'Try again' : 'See plans'}
        </Text>
      </TouchableOpacity>

      {!unavailable && !invoiceable && onAddCredits ? (
        <TouchableOpacity
          onPress={onAddCredits}
          style={styles.secondaryButton}
          activeOpacity={0.75}
        >
          <Text style={styles.secondaryButtonText}>Add credits</Text>
        </TouchableOpacity>
      ) : null}

      {!unavailable && invoiceable ? (
        <TouchableOpacity onPress={seePlans} style={styles.secondaryButton} activeOpacity={0.75}>
          <Text style={styles.secondaryButtonText}>See plans</Text>
        </TouchableOpacity>
      ) : null}

      <TouchableOpacity onPress={onClose} style={styles.cancelButton} activeOpacity={0.7}>
        <Text style={styles.cancelButtonText}>Cancel</Text>
      </TouchableOpacity>
    </BaseModal>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingTop: 14,
    paddingBottom: 28,
    backgroundColor: '#FFFDF9',
    alignItems: 'stretch',
  },
  handle: {
    width: 42,
    height: 5,
    borderRadius: 999,
    backgroundColor: '#E6DDD2',
    alignSelf: 'center',
    marginBottom: 18,
  },
  title: {
    fontSize: 22,
    fontFamily: 'Inter_700Bold',
    color: '#18181B',
    marginBottom: 8,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    lineHeight: 20,
    fontFamily: 'Inter_400Regular',
    color: '#71717A',
    textAlign: 'center',
    marginBottom: 22,
  },
  primaryButton: {
    width: '100%',
    backgroundColor: BRAND_PRIMARY,
    borderRadius: 16,
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontFamily: 'Inter_700Bold',
    fontSize: 15,
  },
  secondaryButton: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
    marginTop: 4,
  },
  secondaryButtonText: {
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
    color: '#3F6212',
  },
  cancelButton: {
    alignSelf: 'center',
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  cancelButtonText: {
    fontSize: 14,
    fontFamily: 'Inter_500Medium',
    color: '#71717A',
  },
});
