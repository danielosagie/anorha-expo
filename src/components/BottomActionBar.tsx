import React from 'react';
import { BRAND_PRIMARY } from '../design/tokens';
import { View, TouchableOpacity, Text, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CloudUpload, Save, ChevronLeft, ChevronRight } from 'lucide-react-native';

type Props = {
  primaryLabel: string;
  primaryDisabled?: boolean;
  onPrimary: () => void;
  primaryIcon?: React.ReactNode;
  secondaryLabel?: string;
  secondaryDisabled?: boolean;
  onSecondary?: () => void;
  secondaryIcon?: React.ReactNode;
  /** Optional content rendered above the action buttons (e.g., SmartCommandInput) */
  tertiaryContent?: React.ReactNode;
  style?: any;
  primaryButtonStyle?: any;
  secondaryButtonStyle?: any;
  primaryTextStyle?: any;
  secondaryTextStyle?: any;
  /** When set, the primary button shows step-through navigation arrows */
  stepNav?: {
    /** e.g. "SKU" — the current missing field label */
    currentLabel: string;
    /** e.g. 1 — current index (1-based) */
    currentIndex: number;
    /** e.g. 5 — total missing fields */
    totalCount: number;
    onPrev: () => void;
    onNext: () => void;
    /** Called when the center label area is tapped (e.g., to scroll to that field) */
    onTapField?: () => void;
  };
};

export default function BottomActionBar({
  primaryLabel,
  primaryDisabled,
  onPrimary,
  primaryIcon,
  secondaryLabel,
  secondaryDisabled,
  onSecondary,
  secondaryIcon,
  tertiaryContent,
  style,
  primaryButtonStyle,
  secondaryButtonStyle,
  primaryTextStyle,
  secondaryTextStyle,
  stepNav,
}: Props) {
  const showStepNav = stepNav && primaryDisabled;
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.container, { bottom: 24 + insets.bottom }, style]}>
      {tertiaryContent}

      {showStepNav ? (
        /* Step-through navigation mode — disabled publish with field navigation */
        <View style={styles.stepNavRow}>
          <TouchableOpacity
            onPress={stepNav!.onPrev}
            style={styles.stepArrowBtn}
            activeOpacity={0.7}
          >
            <ChevronLeft size={22} color="#fff" />
          </TouchableOpacity>

          <TouchableOpacity
            onPress={stepNav!.onTapField}
            style={styles.stepCenterBtn}
            activeOpacity={0.8}
          >
            <CloudUpload size={18} color="rgba(255,255,255,0.7)" />
            <Text style={styles.stepCenterText} numberOfLines={1}>
              {primaryLabel} ( {stepNav!.currentLabel} — {stepNav!.currentIndex}/{stepNav!.totalCount} )
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={stepNav!.onNext}
            style={styles.stepArrowBtn}
            activeOpacity={0.7}
          >
            <ChevronRight size={22} color="#fff" />
          </TouchableOpacity>
        </View>
      ) : (
        /* Normal publish button */
        <TouchableOpacity
          disabled={!!primaryDisabled}
          onPress={onPrimary}
          style={[styles.primaryBtn, primaryButtonStyle, primaryDisabled && styles.disabled]}
        >
          {primaryIcon ?? <CloudUpload size={20} color="white" />}
          <Text style={[styles.primaryText, primaryTextStyle]}>{primaryLabel}</Text>
        </TouchableOpacity>
      )}

      {secondaryLabel ? (
        <TouchableOpacity
          disabled={!!secondaryDisabled}
          onPress={onSecondary}
          style={[styles.secondaryBtn, secondaryButtonStyle, secondaryDisabled && styles.disabled]}
        >
          {secondaryIcon ?? <Save size={20} color="#71717A" />}
          <Text style={[styles.secondaryText, secondaryTextStyle]}>{secondaryLabel}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 16,
    right: 16,
    gap: 10,
  },
  primaryBtn: {
    flexDirection: 'row',
    gap: 8,
    backgroundColor: BRAND_PRIMARY,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryText: { color: '#fff', fontWeight: '600', fontSize: 16 },
  secondaryBtn: {
    flexDirection: 'row',
    gap: 8,
    backgroundColor: '#E5E5E5',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryText: { color: '#71717A', fontWeight: '600', fontSize: 16 },
  disabled: { opacity: 0.6 },
  /* Step navigation styles */
  stepNavRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  stepArrowBtn: {
    backgroundColor: BRAND_PRIMARY,
    borderRadius: 10,
    padding: 12,
    alignItems: 'center',
    justifyContent: 'center',
    opacity: 0.7,
  },
  stepCenterBtn: {
    flex: 1,
    flexDirection: 'row',
    gap: 8,
    backgroundColor: BRAND_PRIMARY,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    opacity: 0.7,
  },
  stepCenterText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 14,
  },
});
