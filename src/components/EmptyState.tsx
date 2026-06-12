import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, StyleProp, ViewStyle } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

type IconName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

// One shared empty state — icon chip + title + subtitle + optional CTA.
// Mirrors the app scale (17/600 title · 14/500 sub · green primary). Use this
// instead of bare "No items" text so every list reads the same when empty.
export default function EmptyState({
  icon = 'inbox-outline',
  title,
  subtitle,
  ctaLabel,
  onPressCta,
  tone = 'neutral',
  style,
}: {
  icon?: IconName;
  title: string;
  subtitle?: string;
  ctaLabel?: string;
  onPressCta?: () => void;
  tone?: 'neutral' | 'success';
  style?: StyleProp<ViewStyle>;
}) {
  const accent = tone === 'success' ? '#4A7C00' : '#9CA3AF';
  const iconBg = tone === 'success' ? '#EEFCE0' : '#F3F4F6';
  return (
    <View style={[styles.wrap, style]}>
      <View style={[styles.iconWrap, { backgroundColor: iconBg }]}>
        <MaterialCommunityIcons name={icon} size={30} color={accent} />
      </View>
      <Text style={styles.title}>{title}</Text>
      {!!subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
      {!!ctaLabel && !!onPressCta && (
        <TouchableOpacity onPress={onPressCta} activeOpacity={0.9} style={styles.cta}>
          <Text style={styles.ctaText}>{ctaLabel}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center', paddingVertical: 48, paddingHorizontal: 32 },
  iconWrap: { width: 64, height: 64, borderRadius: 20, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  title: { fontSize: 17, fontWeight: '600', color: '#18181B', textAlign: 'center' },
  subtitle: { fontSize: 14, fontWeight: '500', color: '#71717A', textAlign: 'center', marginTop: 6, lineHeight: 20, maxWidth: 280 },
  cta: { marginTop: 18, backgroundColor: '#93C822', borderRadius: 12, paddingVertical: 12, paddingHorizontal: 22 },
  ctaText: { fontSize: 15, fontWeight: '600', color: '#fff' },
});
