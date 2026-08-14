import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { X } from 'lucide-react-native';
import BaseModal from './BaseModal';
import { BillingGateResponse } from '../types/billingGate';
import { BRAND_PRIMARY } from '../design/tokens';

interface BillingGateSheetProps {
  visible: boolean;
  gate: BillingGateResponse | null;
  onClose: () => void;
  onDismiss?: () => void;
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
  onDismiss,
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

  // Usage bar: free-tier gates show scans used; paid gates show AI usage cents.
  const usesFreeTier = typeof gate.freeUsageCount === 'number' && typeof gate.freeLimit === 'number' && gate.freeLimit > 0;
  const barUsed = usesFreeTier ? gate.freeUsageCount! : gate.currentUsageCents;
  const barLimit = usesFreeTier ? gate.freeLimit! : gate.allowanceCents;
  // Fill clamps at 100; the label tells the truth past it (149%, not "100%").
  const truePct = barLimit > 0 ? Math.round((barUsed / barLimit) * 100) : 0;
  const barPct = Math.min(100, truePct);
  const barLabel = usesFreeTier
    ? `${gate.freeUsageCount} of ${gate.freeLimit} free scans`
    : `${truePct}% of monthly AI usage`;

  // Overage: Add credits is the primary action; continuing the scan is the
  // quiet path. Free tier: See plans stays primary. X (top right) dismisses.
  const primaryLabel = unavailable
    ? 'Try again'
    : invoiceable
      ? (onAddCredits ? 'Add credits' : 'Continue scan')
      : 'See plans';
  const primaryAction = unavailable
    ? onClose
    : invoiceable
      ? (onAddCredits || onContinue || onClose)
      : seePlans;
  const secondaryLabel = !unavailable && invoiceable && onAddCredits ? 'Continue scan' : !unavailable && !invoiceable && onAddCredits ? 'Add credits' : null;
  const secondaryAction = invoiceable ? (onContinue || onClose) : onAddCredits;

  return (
    <BaseModal visible={visible} onClose={onClose} onDismiss={onDismiss} position="bottom" containerStyle={styles.container}>
      <View style={styles.handle} />
      <TouchableOpacity style={styles.closeButton} onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
        <View style={styles.closeButtonInner}>
          <X size={18} color="#71717A" />
        </View>
      </TouchableOpacity>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.subtitle}>{body}</Text>

      {!unavailable && barLimit > 0 ? (
        <View style={styles.usageWrap}>
          <View style={styles.usageTrack}>
            <View style={[styles.usageFill, { width: `${barPct}%` }]} />
          </View>
          <Text style={styles.usageLabel}>{barLabel}</Text>
        </View>
      ) : null}

      <TouchableOpacity onPress={primaryAction} style={styles.primaryButton} activeOpacity={0.86}>
        <Text style={styles.primaryButtonText}>{primaryLabel}</Text>
      </TouchableOpacity>

      {secondaryLabel && secondaryAction ? (
        <TouchableOpacity onPress={secondaryAction} style={styles.secondaryButton} activeOpacity={0.75}>
          <Text style={styles.secondaryButtonText}>{secondaryLabel}</Text>
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
  closeButton: {
    position: 'absolute',
    top: 16,
    right: 16,
    zIndex: 10,
  },
  closeButtonInner: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#F1F1EE',
    alignItems: 'center',
    justifyContent: 'center',
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
  usageWrap: {
    width: '100%',
    marginBottom: 20,
    gap: 8,
  },
  usageTrack: {
    height: 8,
    borderRadius: 4,
    backgroundColor: '#EFE9DF',
    overflow: 'hidden',
  },
  usageFill: {
    height: '100%',
    borderRadius: 4,
    backgroundColor: BRAND_PRIMARY,
  },
  usageLabel: {
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
    color: '#71717A',
    textAlign: 'center',
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
    color: '#93C822',
  },
});
