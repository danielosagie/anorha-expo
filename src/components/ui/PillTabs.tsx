import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, AccessibilityRole } from 'react-native';
import { tokens, BRAND_PRIMARY} from '../../design/tokens';

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
    paddingVertical: 10,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F9FAFB',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  tabActive: {
    backgroundColor: '#EEFCE0',
    borderColor: BRAND_PRIMARY,
  },
  tabActiveSuccess: { backgroundColor: '#EEFCE0', borderColor: BRAND_PRIMARY },
  tabActiveWarning: { backgroundColor: '#FFFBEB', borderColor: '#FCD34D' },
  tabActiveDanger: { backgroundColor: '#FEF2F2', borderColor: '#FECACA' },
  tabDisabled: {
    opacity: 0.5,
  },
  tabText: {
    fontSize: tokens.fontSizes.sm,
    color: '#6B7280',
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  tabTextActive: {
    color: '#4A7C00',
  },
  textSuccess: { color: '#4A7C00' },
  textWarning: { color: '#92400E' },
  textDanger: { color: '#B91C1C' },
});


