import React, { ReactNode } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { ChevronRight } from 'lucide-react-native';
import { CHAT_COLORS, CHAT_FONT } from '../../design/chatGlass';

/**
 * FieldRow — a tappable summary of one listing field. Tapping opens that field's
 * FieldSheet (the editor lives there, not inline). This is the "confirm, not fill"
 * surface: the seller scans values and only opens what needs changing.
 *
 *  inline  : [ Label .............. value  › ]
 *  stacked : [ Label                        ]
 *            [ value (can wrap) ........... › ]
 *
 * Group several FieldRows inside a white card; rows self-divide with a hairline.
 */
export interface FieldRowProps {
  label: string;
  /** Preview text for the current value. */
  value?: string | null;
  /** Custom value content (chips, category path, etc.) — overrides `value`. */
  valueNode?: ReactNode;
  /** Shown muted when there is no value (e.g. "Add"). */
  placeholder?: string;
  layout?: 'inline' | 'stacked';
  onPress: () => void;
  required?: boolean;
  /** Required-but-empty → red label + "Needed" hint. */
  error?: boolean;
  /** Calm "Updated" chip for a value changed by an external sync (no alarm). */
  externalUpdate?: boolean;
  /** "Refilled" chip after an AI regenerate. */
  refilled?: boolean;
  showChevron?: boolean;
  /** Hide the bottom divider (last row in a card). */
  last?: boolean;
  /** Optional trailing control rendered before the chevron (e.g. a scan button). */
  trailing?: ReactNode;
  testID?: string;
}

export default function FieldRow({
  label,
  value,
  valueNode,
  placeholder,
  layout = 'inline',
  onPress,
  required = false,
  error = false,
  externalUpdate = false,
  refilled = false,
  showChevron = true,
  last = false,
  trailing,
  testID,
}: FieldRowProps) {
  const hasValue = valueNode != null || (value != null && String(value).trim().length > 0);
  const valueText = hasValue ? value : placeholder;

  const ValueContent =
    valueNode != null ? (
      valueNode
    ) : (
      <Text
        style={[
          styles.value,
          layout === 'inline' && styles.valueInline,
          !hasValue && styles.valuePlaceholder,
        ]}
        numberOfLines={layout === 'stacked' ? 3 : 2}
      >
        {valueText}
      </Text>
    );

  const LabelChips = (
    <View style={styles.labelRow}>
      <Text style={[styles.label, error && styles.labelError]} numberOfLines={1}>
        {label}
        {required ? <Text style={styles.req}> *</Text> : null}
      </Text>
      {externalUpdate ? (
        <View style={styles.updatedChip}>
          <Text style={styles.updatedChipText}>Updated</Text>
        </View>
      ) : refilled ? (
        <View style={styles.refilledChip}>
          <Text style={styles.refilledChipText}>Refilled</Text>
        </View>
      ) : error ? (
        <Text style={styles.neededHint}>Needed</Text>
      ) : null}
    </View>
  );

  return (
    <TouchableOpacity
      style={[styles.row, !last && styles.rowDivider]}
      onPress={onPress}
      activeOpacity={0.6}
      testID={testID}
    >
      {layout === 'stacked' ? (
        <View style={{ flex: 1 }}>
          {LabelChips}
          <View style={styles.stackedValueRow}>
            <View style={{ flex: 1 }}>{ValueContent}</View>
            {trailing}
            {showChevron && <ChevronRight size={18} color={CHAT_COLORS.faint} style={{ marginLeft: 8 }} />}
          </View>
        </View>
      ) : (
        <>
          <View style={styles.inlineLabelCol}>{LabelChips}</View>
          <View style={styles.inlineValueCol}>{ValueContent}</View>
          {trailing}
          {showChevron && <ChevronRight size={18} color={CHAT_COLORS.faint} style={{ marginLeft: 8 }} />}
        </>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 13,
    paddingHorizontal: 16,
    minHeight: 54,
  },
  rowDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: CHAT_COLORS.divider,
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  label: {
    fontSize: 13,
    fontFamily: CHAT_FONT.medium,
    fontWeight: '500',
    color: CHAT_COLORS.dim,
  },
  labelError: {
    color: CHAT_COLORS.error,
  },
  req: {
    color: CHAT_COLORS.error,
  },
  neededHint: {
    fontSize: 11,
    fontFamily: CHAT_FONT.semibold,
    fontWeight: '600',
    color: CHAT_COLORS.error,
  },
  inlineLabelCol: {
    flexShrink: 0,
    marginRight: 12,
  },
  inlineValueCol: {
    flex: 1,
    alignItems: 'flex-end',
  },
  stackedValueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  value: {
    fontSize: 15,
    fontFamily: CHAT_FONT.medium,
    fontWeight: '500',
    color: CHAT_COLORS.ink,
  },
  valueInline: {
    textAlign: 'right',
  },
  valuePlaceholder: {
    color: CHAT_COLORS.faint,
    fontFamily: CHAT_FONT.regular,
    fontWeight: '400',
  },
  updatedChip: {
    backgroundColor: CHAT_COLORS.brandSoft,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  updatedChipText: {
    color: CHAT_COLORS.brandDeep,
    fontSize: 10,
    fontFamily: CHAT_FONT.semibold,
    fontWeight: '600',
  },
  refilledChip: {
    backgroundColor: CHAT_COLORS.brandSoft,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  refilledChipText: {
    color: '#3f6212',
    fontSize: 10,
    fontFamily: CHAT_FONT.semibold,
    fontWeight: '600',
  },
});
