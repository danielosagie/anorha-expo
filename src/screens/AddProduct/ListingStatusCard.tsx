import React from 'react';
import { Modal, View, Text, StyleSheet, TouchableOpacity, Pressable } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { UnicodeSpinner } from './UnicodeSpinner';
import spinners from 'unicode-animations';
import type { UnicodeSpinnerDefinition } from './types';
import { CHAT_COLORS, CHAT_FONT } from '../../design/chatGlass';

/**
 * Listing creation status, as a slim centred card.
 *
 * Replaces the two full-width celebration sheets (a 168px confetti illustration + 22px
 * headline + 54px CTA each) that took over the screen for a background job. Creation is
 * async and the seller keeps working, so the status reads like the "Saved" chip in the
 * product detail blur header: one line, one action, tap-anywhere to dismiss.
 */
export default function ListingStatusCard({
  state,
  count = 1,
  onReview,
  onDismiss,
}: {
  state: 'creating' | 'ready' | null;
  count?: number;
  onReview: () => void;
  onDismiss: () => void;
}) {
  if (!state) return null;
  const plural = count > 1;
  const creating = state === 'creating';

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onDismiss} statusBarTranslucent>
      <Pressable style={styles.overlay} onPress={onDismiss}>
        <Pressable style={styles.card} onPress={() => undefined}>
          {creating ? (
            <UnicodeSpinner
              spinner={(spinners.helix || spinners.dots) as UnicodeSpinnerDefinition}
              color={CHAT_COLORS.brand}
              size={13}
            />
          ) : (
            <Icon name="check-circle" size={16} color={CHAT_COLORS.brand} />
          )}
          <Text style={styles.label} numberOfLines={1}>
            {creating
              ? plural ? 'Creating listings' : 'Creating listing'
              : plural ? `${count} listings ready` : 'Listing ready'}
          </Text>
          {creating ? null : (
            <TouchableOpacity style={styles.action} onPress={onReview} activeOpacity={0.7}>
              <Text style={styles.actionText}>Review</Text>
            </TouchableOpacity>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    maxWidth: 320,
    paddingLeft: 14,
    paddingRight: 6,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: CHAT_COLORS.white,
    borderWidth: 1,
    borderColor: '#EEF0F2',
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  label: {
    fontSize: 13,
    fontFamily: CHAT_FONT.semibold,
    fontWeight: '600',
    color: CHAT_COLORS.ink,
  },
  action: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(147,200,34,0.14)',
  },
  actionText: {
    fontSize: 13,
    fontFamily: CHAT_FONT.bold,
    fontWeight: '700',
    color: '#5D7E16',
  },
});
