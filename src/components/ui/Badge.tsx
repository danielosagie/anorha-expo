import React from 'react';
import { Text, View, StyleSheet } from 'react-native';
import { tokens } from '../../design/tokens';

type Variant = 'default' | 'success' | 'warning' | 'danger' | 'outline';

type Props = {
  children: React.ReactNode;
  variant?: Variant;
};

const colorsByVariant: Record<Variant, { bg: string; fg: string; border?: string }> = {
  default: { bg: '#F3F4F6', fg: '#111827' },
  success: { bg: '#DCFCE7', fg: '#065F46' },
  warning: { bg: '#FEF3C7', fg: '#92400E' },
  danger: { bg: '#FEE2E2', fg: '#991B1B' },
  outline: { bg: 'transparent', fg: '#111827', border: '#D1D5DB' },
};

const Badge: React.FC<Props> = ({ children, variant = 'default' }) => {
  const c = colorsByVariant[variant];
  return (
    <View style={[styles.badge, { backgroundColor: c.bg }, c.border ? { borderWidth: 1, borderColor: c.border } : null]}
      accessibilityRole="text"
      accessibilityLabel={typeof children === 'string' ? children : undefined}
    >
      <Text style={[styles.text, { color: c.fg }]}>{children}</Text>
    </View>
  );
};

export default React.memo(Badge);

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: tokens.spacing.sm,
    paddingVertical: 2,
    borderRadius: tokens.radii.full,
  },
  text: {
    fontSize: tokens.fontSizes.sm,
    fontWeight: '700',
  },
});


