import React, { memo } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { CHAT_COLORS, CHAT_FONT } from '../design/chatGlass';
import { partnerInitials } from '../lib/partnerInventory';

type PartnerBadgeProps = {
  name: string;
  initials?: string;
  logoUrl?: string;
  size?: number;
};

const PartnerBadge = memo(({
  name,
  initials,
  logoUrl,
  size = 28,
}: PartnerBadgeProps) => (
  <View
    accessibilityLabel={`${name} partner`}
    style={[
      styles.badge,
      {
        width: size,
        height: size,
        borderRadius: size / 2,
      },
    ]}
  >
    <Text style={[styles.initials, { fontSize: Math.max(9, Math.round(size * 0.32)) }]}>
      {initials || partnerInitials(name)}
    </Text>
    {logoUrl ? (
      <Image
        source={{ uri: logoUrl }}
        resizeMode="cover"
        style={[StyleSheet.absoluteFill, { borderRadius: size / 2 }]}
      />
    ) : null}
  </View>
));
PartnerBadge.displayName = 'PartnerBadge';

const styles = StyleSheet.create({
  badge: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    backgroundColor: CHAT_COLORS.surfaceAlt,
  },
  initials: {
    color: CHAT_COLORS.dim,
    fontFamily: CHAT_FONT.bold,
    letterSpacing: 0.2,
  },
});

export default PartnerBadge;
