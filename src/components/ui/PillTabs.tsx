import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, AccessibilityRole } from 'react-native';
import { tokens } from '../../design/tokens';

export type TabKey = string | number;

export type PillTab = {
  key: TabKey;
  label: string;
  count?: number;
  disabled?: boolean;
  tone?: 'default' | 'success' | 'warning' | 'danger';
};

type Props = {
  tabs: PillTab[];
  value: TabKey;
  onChange: (key: TabKey) => void;
};

const PillTabs: React.FC<Props> = ({ tabs, value, onChange }) => {
  return (
    <View style={styles.container} accessibilityRole={"tablist" as AccessibilityRole}>
      {tabs.map((t) => {
        const isActive = t.key === value;
        const tone = t.tone || 'default';
        const activeStyle = tone === 'success' ? styles.tabActiveSuccess : tone === 'warning' ? styles.tabActiveWarning : tone === 'danger' ? styles.tabActiveDanger : styles.tabActive;
        const activeText = tone === 'success' ? styles.textSuccess : tone === 'warning' ? styles.textWarning : tone === 'danger' ? styles.textDanger : styles.tabTextActive;
        return (
          <TouchableOpacity
            key={String(t.key)}
            accessibilityRole={"tab" as AccessibilityRole}
            accessibilityState={{ selected: isActive, disabled: !!t.disabled }}
            accessibilityLabel={`${t.label}${t.count != null ? `, ${t.count}` : ''}`}
            onPress={() => !t.disabled && onChange(t.key)}
            style={[styles.tab, isActive && activeStyle, t.disabled && styles.tabDisabled]}
            disabled={!!t.disabled}
          >
            <Text style={[styles.tabText, isActive && activeText]}>
              {t.label} {t.count != null ? `(${t.count})` : ''}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
};

export default React.memo(PillTabs);

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: tokens.spacing.lg,
    paddingTop: tokens.spacing.md,
    paddingBottom: tokens.spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
    backgroundColor: 'white',
  },
  tab: {
    flex: 1,
    marginHorizontal: tokens.spacing.xs,
    paddingVertical: tokens.spacing.sm,
    borderRadius: tokens.radii.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F3F4F6',
  },
  tabActive: {
    backgroundColor: '#E6F3D0',
  },
  tabActiveSuccess: { backgroundColor: '#E6F3D0' },
  tabActiveWarning: { backgroundColor: '#FEF3C7' },
  tabActiveDanger: { backgroundColor: '#FEE2E2' },
  tabDisabled: {
    opacity: 0.5,
  },
  tabText: {
    fontSize: tokens.fontSizes.md,
    color: '#6B7280',
    fontWeight: '600',
  },
  tabTextActive: {
    color: '#5C9B00',
  },
  textSuccess: { color: '#5C9B00' },
  textWarning: { color: '#92400E' },
  textDanger: { color: '#B91C1C' },
});


