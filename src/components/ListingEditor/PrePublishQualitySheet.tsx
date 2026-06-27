import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { AlertTriangle, Check } from 'lucide-react-native';
import FieldSheet from './FieldSheet';
import { CHAT_COLORS, CHAT_FONT } from '../../design/chatGlass';
import type { QualityRow } from '../../utils/listingQuality';

const OK_GREEN = '#4A7C00';

export interface PrePublishQualitySheetProps {
  visible: boolean;
  rows: QualityRow[];
  onClose: () => void;
  onPublishAnyway: () => void;
}

/**
 * PrePublishQualitySheet — the calm "Before you publish" advisory gate.
 *
 * Shown only when the listing is weak. It's encouraging, not alarming: weak
 * signals float to the top with a soft amber hint, strong ones sit below with a
 * green check. "Publish anyway" always proceeds; "Improve these first" just
 * closes the sheet so the seller can fix things. Never a hard block.
 */
export default function PrePublishQualitySheet({
  visible,
  rows,
  onClose,
  onPublishAnyway,
}: PrePublishQualitySheetProps) {
  // Weak-first: !ok before ok, otherwise keep the source order.
  const sortedRows = useMemo(
    () => [...rows].sort((a, b) => Number(a.ok) - Number(b.ok)),
    [rows],
  );

  return (
    <FieldSheet
      visible={visible}
      title="Before you publish"
      onClose={onClose}
      onSave={onPublishAnyway}
      saveLabel="Publish anyway"
      minHeightPct={52}
      footerExtra={
        <TouchableOpacity
          onPress={onClose}
          activeOpacity={0.85}
          style={styles.improveBtn}
        >
          <Text style={styles.improveLabel}>Improve these first</Text>
        </TouchableOpacity>
      }
    >
      <Text style={styles.lede}>
        You're set up well in most spots — a couple of quick wins could help it
        sell faster.
      </Text>

      <View style={styles.rows}>
        {sortedRows.map((row) => (
          <View key={row.key} style={styles.row}>
            <View style={styles.iconWrap}>
              {row.ok ? (
                <Check size={18} color={OK_GREEN} />
              ) : (
                <AlertTriangle size={18} color={CHAT_COLORS.amber} />
              )}
            </View>
            <View style={styles.rowText}>
              <Text style={[styles.rowLabel, !row.ok && styles.rowLabelWeak]}>
                {row.label}
              </Text>
              {!row.ok && !!row.hint && (
                <Text style={styles.rowHint}>{row.hint}</Text>
              )}
            </View>
          </View>
        ))}
      </View>
    </FieldSheet>
  );
}

const styles = StyleSheet.create({
  lede: {
    fontSize: 14.5,
    lineHeight: 21,
    fontFamily: CHAT_FONT.regular,
    color: CHAT_COLORS.inkSoft,
    marginBottom: 18,
  },
  rows: {
    gap: 14,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  iconWrap: {
    width: 22,
    alignItems: 'center',
    paddingTop: 1,
  },
  rowText: {
    flex: 1,
    gap: 3,
  },
  rowLabel: {
    fontSize: 15.5,
    fontFamily: CHAT_FONT.semibold,
    fontWeight: '600',
    color: CHAT_COLORS.ink,
  },
  rowLabelWeak: {
    color: CHAT_COLORS.ink,
  },
  rowHint: {
    fontSize: 13.5,
    lineHeight: 19,
    fontFamily: CHAT_FONT.regular,
    color: CHAT_COLORS.amber,
  },
  improveBtn: {
    height: 50,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: CHAT_COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  improveLabel: {
    fontSize: 15.5,
    fontFamily: CHAT_FONT.semibold,
    fontWeight: '600',
    color: CHAT_COLORS.inkSoft,
  },
});
