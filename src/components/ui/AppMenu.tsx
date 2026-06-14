import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

// Reusable Linear-like dropdown menu. A transparent Modal dims the background and a rounded
// card springs/fades in from its anchor (top-left). Items are grouped into sections separated
// by hairline dividers; the active item gets a soft pill highlight (Shopify-style).
// Use this for ALL app dropdowns so they look and animate consistently.

export type AppMenuItem = {
  key: string;
  label: string;
  /** MaterialCommunityIcons name. */
  icon?: string;
  active?: boolean;
  destructive?: boolean;
  onPress: () => void;
};

type Props = {
  visible: boolean;
  onClose: () => void;
  /** Each inner array is a section; sections are separated by a divider. */
  sections: AppMenuItem[][];
  /** Top-left anchor of the card, in window coordinates. */
  anchor: { top: number; left: number };
  width?: number;
};

const INK = '#18181B';
const FONT = { medium: 'Inter_500Medium', semibold: 'Inter_600SemiBold' };

export const AppMenu: React.FC<Props> = ({ visible, onClose, sections, anchor, width = 300 }) => {
  // Mount the Modal across the open→close animation so the exit can play out.
  const [mounted, setMounted] = React.useState(visible);
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      setMounted(true);
      Animated.spring(anim, { toValue: 1, useNativeDriver: true, bounciness: 6, speed: 16 }).start();
    } else if (mounted) {
      Animated.timing(anim, { toValue: 0, duration: 130, easing: Easing.in(Easing.cubic), useNativeDriver: true }).start(
        ({ finished }) => { if (finished) setMounted(false); },
      );
    }
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!mounted) return null;

  // Scale from the top-left corner (anchor): RN scales about center, so translate the card to
  // keep its top-left pinned while it grows.
  const scale = anim.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1] });
  const offset = anim.interpolate({ inputRange: [0, 1], outputRange: [-(width * 0.05), 0] });

  return (
    <Modal transparent visible animationType="none" onRequestClose={onClose}>
      <Animated.View style={[styles.backdrop, { opacity: anim }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      </Animated.View>
      <Animated.View
        style={[
          styles.card,
          {
            top: anchor.top,
            left: anchor.left,
            width,
            opacity: anim,
            transform: [{ translateX: offset }, { translateY: offset }, { scale }],
          },
        ]}
      >
        {sections.map((section, si) => (
          <View key={`s-${si}`}>
            {si > 0 ? <View style={styles.divider} /> : null}
            {section.map((item) => (
              <Pressable
                key={item.key}
                onPress={item.onPress}
                style={({ pressed }) => [
                  styles.row,
                  item.active && styles.rowActive,
                  pressed && !item.active && styles.rowPressed,
                ]}
              >
                {item.icon ? (
                  <Icon name={item.icon} size={21} color={item.destructive ? '#EF4444' : INK} style={styles.rowIcon} />
                ) : (
                  <View style={styles.rowIcon} />
                )}
                <Text style={[styles.rowLabel, item.destructive && { color: '#EF4444' }]} numberOfLines={1}>
                  {item.label}
                </Text>
              </Pressable>
            ))}
          </View>
        ))}
      </Animated.View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.28)' },
  card: {
    position: 'absolute',
    backgroundColor: '#FFFFFF',
    borderRadius: 22,
    paddingVertical: 8,
    paddingHorizontal: 8,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 16,
  },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: '#E5E5EA', marginVertical: 6, marginHorizontal: 6 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 13,
    paddingHorizontal: 12,
    borderRadius: 14,
  },
  rowActive: { backgroundColor: '#F2F2F2' },
  rowPressed: { backgroundColor: '#F7F7F7' },
  rowIcon: { width: 24, marginRight: 12, textAlign: 'center' },
  rowLabel: { flex: 1, fontSize: 17, fontFamily: FONT.semibold, color: INK },
});

export default AppMenu;
