import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, StyleSheet, Text, View } from 'react-native';
import { Check } from 'lucide-react-native';
import { useSaveStatus } from '../context/saveStatusStore';
import { sproutDarkTheme } from '../design/sproutTheme';

const GREEN = '#93C822';
const INK = '#18181B';

/**
 * The nav's save tag. One word, centered, and absent unless a save is happening or just did.
 *
 * It reads the shared save store rather than any one screen, so autosave running anywhere
 * shows up in the same place. Idle renders nothing: an always-on "Saved" is furniture, and
 * furniture is what people stop seeing.
 */
export function SaveStatusTag({ dark = false }: { dark?: boolean }) {
  const { status } = useSaveStatus();
  const opacity = useRef(new Animated.Value(0)).current;
  const [mounted, setMounted] = useState(status !== 'idle');
  // Held so the tag can fade out still reading "Saved" instead of blanking mid-fade.
  const lastLabel = useRef<'Saving' | 'Saved'>('Saving');
  if (status !== 'idle') lastLabel.current = status === 'saving' ? 'Saving' : 'Saved';

  useEffect(() => {
    if (status !== 'idle') {
      setMounted(true);
      Animated.timing(opacity, {
        toValue: 1,
        duration: 160,
        useNativeDriver: true,
      }).start();
      return;
    }
    Animated.timing(opacity, {
      toValue: 0,
      duration: 280,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) setMounted(false);
    });
  }, [opacity, status]);

  if (!mounted) return null;

  const saving = lastLabel.current === 'Saving';
  const tint = saving ? (dark ? sproutDarkTheme.colors.textSecondary : '#6B7280') : GREEN;

  return (
    <Animated.View
      accessibilityLiveRegion="polite"
      pointerEvents="none"
      style={[styles.tag, dark && styles.tagNight, { opacity }]}
    >
      <View style={styles.glyph}>
        {saving ? (
          <ActivityIndicator size="small" color={tint} />
        ) : (
          <Check size={13} color={GREEN} strokeWidth={2.6} />
        )}
      </View>
      <Text style={[styles.label, { color: saving ? (dark ? sproutDarkTheme.colors.text : INK) : GREEN }]}>
        {lastLabel.current}
      </Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  tag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderCurve: 'continuous',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: 'rgba(0, 0, 0, 0.07)',
    boxShadow: '0 4px 12px rgba(15, 17, 22, 0.08)',
  },
  tagNight: {
    backgroundColor: sproutDarkTheme.colors.surface,
    borderColor: sproutDarkTheme.colors.border,
  },
  glyph: {
    width: 13,
    height: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
    lineHeight: 15,
  },
});

export default SaveStatusTag;
